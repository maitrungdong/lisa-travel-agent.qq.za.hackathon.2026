import { timingSafeEqual } from "node:crypto";
import { Body, Controller, Get, Headers, HttpCode, Logger, Post } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { JobsService } from "../jobs/jobs.service";
import { MediaService } from "../media/media.service";
import { PipelineService } from "../pipeline/pipeline.service";
import { envInt, pipelineEnabled } from "../pipeline/pipeline.types";
import { V7Service } from "../pipeline/v7.service";
import { v7Enabled } from "../pipeline/v7.types";
import { ConversationService } from "./conversation.service";
import { ZaloClient } from "./zalo.client";
import { normalizeUpdate, stripBotMention, type ZaloUpdate } from "./zalo.types";

/**
 * Cổng vào duy nhất từ Zalo.
 *
 * NGUYÊN TẮC: trả 200 NHANH rồi mới xử lý.
 * Zalo retry khi webhook timeout → xử lý đồng bộ = agent chạy 2 lần cho 1 tin.
 * Ở đây chỉ làm 4 việc rẻ: verify chữ ký · chuẩn hoá · tải ảnh · đẩy vào hàng đợi.
 */
/**
 * Cửa sổ gộp tin. Đủ dài để hứng một loạt người cùng nhắn, đủ ngắn để chat
 * không có cảm giác ì. 1,2s là điểm cân bằng — người dùng vẫn thấy "typing"
 * xuất hiện tức thì nên không nhận ra độ trễ này.
 */
const BATCH_WINDOW_MS = envInt("ZINO_BATCH_WINDOW_MS", 1200);

@Controller("zalo")
export class ZaloController {
  private readonly log = new Logger(ZaloController.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly media: MediaService,
    private readonly conversations: ConversationService,
    private readonly zalo: ZaloClient,
    private readonly pipeline: PipelineService,
    private readonly v7: V7Service,
    private readonly auth: AuthService
  ) {}

  @Post("webhook")
  @HttpCode(200)
  async webhook(
    @Body() body: ZaloUpdate,
    @Headers("x-bot-api-secret-token") secret?: string
  ): Promise<{ ok: boolean }> {
    if (!verifySecret(secret)) {
      this.log.warn("Webhook bị từ chối: sai X-Bot-Api-Secret-Token");
      return { ok: true }; // vẫn 200 để Zalo khỏi retry vô ích
    }

    const msg = normalizeUpdate(body);
    if (!msg) return { ok: true };

    // Xử lý nền — KHÔNG await, để response về ngay
    void this.ingest(msg).catch((err) =>
      this.log.error(`Lỗi ingest: ${(err as Error).message}`, (err as Error).stack)
    );

    return { ok: true };
  }

  private async ingest(msg: ReturnType<typeof normalizeUpdate> & object): Promise<void> {
    // Phản hồi thị giác ngay — che 2-5s latency của agent
    void this.zalo.sendTyping(msg.chatId);

    const conv = await this.conversations.resolve(msg);

    // Tải ảnh NGAY: photo_url của Zalo là URL tạm, để lâu có thể 404
    let imageUrl: string | null = null;
    let imagePath: string | null = null;
    let imageMime: string | null = null;
    if (msg.photoUrl) {
      const stored = await this.media.download(msg.photoUrl);
      if (stored) {
        imageUrl = stored.url;
        imagePath = stored.path;
        imageMime = stored.mimeType;
      }
    }

    // Idempotency: Zalo gửi trùng thì dừng ở đây
    const isNew = await this.conversations.recordInbound(conv.id, msg, imageUrl);
    if (!isNew) {
      this.log.debug(`Bỏ tin trùng ${msg.zaloMessageId}`);
      return;
    }

    // Mã ghép đôi Mini App — chặn TRƯỚC khi vào agent.
    //
    // Đặt ở đây vì hai lý do: (1) không tốn một lượt model cho một chuỗi 6 số,
    // (2) danh tính phải đến từ webhook chứ không qua tay LLM. `msg.senderZaloId`
    // là do Zalo khẳng định — đó là toàn bộ chỗ dựa của cơ chế liên kết.
    if (await this.tryRedeemLinkCode(conv.id, msg)) return;

    // Sticker đơn thuần: trả lời rẻ tiền, không gọi model
    if (msg.eventName === "message.sticker.received" && !msg.text) {
      await this.zalo.sendRaw(msg.chatId, "😄");
      return;
    }

    // Định dạng Zalo Bot không hỗ trợ (file, voice, video, location)
    if (msg.eventName === "message.unsupported.received") {
      await this.zalo.sendRaw(
        msg.chatId,
        "Mình chưa đọc được định dạng này 😅 Bạn gửi giúp mình dạng ảnh hoặc nhắn chữ nhé!"
      );
      return;
    }

    // Tin này có phải câu trả lời cho pipeline đang chạy không?
    // (mã ghép đôi đã được xử lý ở trên)
    if (await this.routeToPipeline(conv.id, msg)) return;

    /**
     * GỘP theo cửa sổ thời gian thay vì tạo job cho từng tin.
     *
     * Trong nhóm, nhiều người mention bot gần như cùng lúc là chuyện thường.
     * Mỗi tin một lượt agent thì: người cuối chờ rất lâu, tốn N lần token, và
     * mỗi lượt Zino chỉ thấy một mẩu nên trả lời rời rạc.
     *
     * Gộp lại: một lượt duy nhất đọc cả loạt tin, rồi CHÍNH AGENT quyết định
     * gộp hay tách câu trả lời (tool `reply`) — vì đó là quyết định ngữ nghĩa.
     *
     * dedupeKey = chatId cũng đảm bảo mỗi nhóm chỉ có 1 lượt chạy tại một thời
     * điểm, không ghi đè state của nhau.
     */
    await this.jobs.enqueueCoalesced(
      "agent_turn",
      {
        conversationId: conv.id,
        zaloChatId: msg.chatId,
        senderZaloId: msg.senderZaloId,
        senderName: msg.senderName,
        text: msg.text,
        imageUrl,
        imagePath,
        imageMime,
        isReturning: conv.isReturning,
        isNew: conv.isNew,
        seenCount: conv.seenCount
      },
      msg.chatId,
      BATCH_WINDOW_MS
    );
  }

  /**
   * Bắt mã ghép đôi Mini App trong tin nhắn. Trả true = đã xử lý, dừng ở đây.
   *
   * Khớp rất hẹp — chỉ tin CHỈ CÓ 6 chữ số, cho phép có tiền tố "@Zino" hoặc
   * vài từ ngắn kiểu "ma 482913". Hẹp là cố ý: "6 người 3 triệu" hay "12/08"
   * không được phép bị nuốt mất khỏi luồng hội thoại bình thường.
   */
  private async tryRedeemLinkCode(
    conversationId: number,
    msg: { chatId: string; text?: string | null; senderZaloId: string; senderName: string }
  ): Promise<boolean> {
    const text = msg.text?.trim();
    if (!text || text.length > 64) return false;

    /**
     * Trước đây gỡ mention bằng `^@\S+\s*` — chỉ ăn được MỘT token, nên
     * `"@Bot ZINO - Trợ lý nhu cầu 482913"` còn lại `"ZINO - Trợ lý nhu cầu
     * 482913"` và không bao giờ khớp 6 chữ số. Mã ghép đôi vì thế chưa từng
     * hoạt động trong nhóm. `stripBotMention` biết tên bot nên gỡ đúng.
     */
    const stripped = stripBotMention(text)
      .replace(/^(m[ãa]|code|link)\s*:?\s*/i, "") // bỏ "mã:" / "code"
      .trim();
    // Đường lui khi chưa đặt ZALO_BOT_NAME: lấy cụm 6 số ở CUỐI tin có mention
    const tail = text.startsWith("@") ? (text.match(/(\d{6})\s*$/)?.[1] ?? null) : null;
    const code = /^\d{6}$/.test(stripped) ? stripped : tail;
    if (!code) return false;

    const result = await this.auth.redeemCode(
      code,
      msg.senderZaloId,
      msg.senderName,
      conversationId
    );

    const reply = result.ok
      ? `Đã liên kết xong rồi nhé ${msg.senderName} 🎉 Mở lại Mini App là thấy chuyến của mình.`
      : `Mã này không dùng được: ${result.reason}. Mở Mini App lấy mã mới giúp mình nhé.`;

    await this.zalo.sendRaw(msg.chatId, reply);
    await this.conversations.recordOutbound(conversationId, reply);
    this.log.log(
      `link-code ${code} · ${msg.senderName} · ${result.ok ? "OK" : `FAIL: ${result.reason}`}`
    );
    return true;
  }

  /**
   * Đẩy tin nhắn vào pipeline nếu nó rõ ràng là câu trả lời cho pipeline.
   * Trả true nghĩa là đã xử lý xong, KHÔNG tạo agent_turn nữa.
   *
   * MẶC ĐỊNH LUÔN LÀ AgentService. Pipeline chỉ chen ngang khi tin nhắn khớp
   * hẳn với thứ nó đang chờ. Lý do: trong lúc Đông lên plan Đà Lạt, Hà vẫn
   * phải hỏi được "ai trả tiền cà phê hôm qua" — bắt cả nhóm chờ vì một người
   * đang lên kế hoạch là hệ thống tệ.
   *
   * Trường hợp mập mờ ("4 đứa thôi, mà nhớ nhắc tao đặt vé nhé") cố tình rơi
   * về AgentService: nó đã là bộ định tuyến LLM sẵn có, dùng lại rẻ hơn viết
   * bộ phân loại thứ hai.
   */
  private async routeToPipeline(
    conversationId: number,
    msg: { chatId: string; text?: string | null; senderZaloId: string; senderName: string }
  ): Promise<boolean> {
    /**
     * v7 §2.2 — "Every new user message enters through Intake", và §3.1 cấm
     * backend tự phân loại ngữ nghĩa.
     *
     * Nên khi một flow v7 đang chạy, MỌI tin nhắn của hội thoại đó đi thẳng
     * vào Intake, không qua AgentService, không qua bất kỳ heuristic nào ở
     * đây. Backend chỉ kiểm một điều duy nhất: có flow đang mở hay không.
     *
     * Ngoài flow thì AgentService vẫn là cửa trước — đó là chỗ duy nhất lệch
     * doc, và là cái giá để giữ 19 tool đang chạy (ghi chi phí, nhắc lịch,
     * đọc bill từ ảnh, Partner Network).
     */
    if (v7Enabled()) {
      const run = await this.v7.findActive(conversationId);
      if (!run) return false;

      const raw = (msg.text ?? "").trim();
      if (!raw) return false; // ảnh/sticker đơn thuần → để AgentService lo

      /**
       * Gỡ `"@Tên Bot "` TRƯỚC khi làm bất cứ việc gì với tin nhắn.
       *
       * Trong nhóm, Zalo chèn tiền tố này vào mọi tin gửi bot. Không gỡ thì
       * cửa thoát dưới đây không bao giờ khớp (regex neo `^...$`), và Intake
       * nhận được `"@Bot ZINO - Trợ lý nhu cầu BẮT ĐẦU RESEARCH"` — theo §2.5
       * đó KHÔNG phải trigger hợp lệ, nên Brain không bao giờ được gọi. Đo
       * thật 29/07: ba lượt liên tiếp `target=deliver`, bot hứa "đang research"
       * mà không có gì chạy.
       */
      const text = stripBotMention(raw);

      /**
       * CỬA THOÁT CỨNG.
       *
       * Lệch §3.1 ("backend must not classify semantically") một cách có chủ
       * đích, và đây KHÔNG phải phân loại ý định — nó khớp đúng một chuỗi cố
       * định, giống hệt cách §2.5 khớp `BẮT ĐẦU RESEARCH`.
       *
       * Vì sao bắt buộc: `cancel_planning_flow` nằm trong tool list của
       * AgentService, mà AgentService không bao giờ chạy khi flow đang mở —
       * cửa thoát nằm sau đúng cánh cửa nó phải mở. Không có lối này thì một
       * flow kẹt là nhóm mất luôn ghi chi phí, nhắc lịch, ảnh, Partner Network.
       */
      if (isEscapeCommand(text, raw)) {
        await this.v7.abandon(run.id, "cancelled");
        await this.zalo.sendRaw(
          msg.chatId,
          "Đã đóng luồng lên kế hoạch. Giờ mình quay lại bình thường nhé 👍"
        );
        this.log.log(`run#${run.id} bị đóng bằng cửa thoát cứng`);
        return true;
      }

      await this.jobs.enqueue(
        "v7_turn",
        {
          runId: run.id,
          userMessage: text,
          actorId: msg.senderZaloId,
          actorName: msg.senderName
        },
        { dedupeKey: msg.chatId } // §3.3: không chạy hai lượt Brain song song
      );
      return true;
    }

    if (!pipelineEnabled()) return false;

    const run = await this.pipeline.findActive(conversationId);
    if (!run) return false;

    const text = (msg.text ?? "").trim();
    if (!text) return false;

    // Chờ owner chọn phương án — CHỈ owner, và chỉ khi tin khớp hẳn một lựa chọn
    if (run.status === "awaiting_selection") {
      if (msg.senderZaloId !== run.ownerZaloId) return false;
      const candidateId = parseCandidate(text);
      if (!candidateId) return false;

      await this.jobs.enqueue(
        "pipeline_step",
        { runId: run.id, stage: "D", candidateId, actorId: msg.senderZaloId },
        { dedupeKey: msg.chatId }
      );
      this.log.log(`run#${run.id} owner chọn ${candidateId}`);
      return true;
    }

    // Chờ trả lời câu hỏi của A — ai trong nhóm trả lời cũng được
    if (run.status === "awaiting_user") {
      await this.jobs.enqueue(
        "pipeline_step",
        {
          runId: run.id,
          stage: "A",
          userMessage: text,
          actorId: msg.senderZaloId,
          actorName: msg.senderName
        },
        { dedupeKey: msg.chatId }
      );
      return true;
    }

    // Đang chạy stage nào đó → không chen ngang, để AgentService trả lời bình thường
    return false;
  }

  /** Tiện ích vận hành: xem bot đang nối webhook nào. */
  @Get("info")
  async info() {
    const [me, hook] = await Promise.all([this.zalo.getMe(), this.zalo.getWebhookInfo()]);
    return { me, webhook: hook };
  }
}

/**
 * Bóc lựa chọn của owner từ tin nhắn.
 *
 * Zalo Bot API không có nút bấm (xem ràng buộc trong prompt.ts), nên C đánh số
 * "1️⃣ 2️⃣ 3️⃣" và owner nhắn số. Chỉ nhận dạng CHẶT — "2" hoặc "chọn 2" thì được,
 * còn "2 đứa nữa đi cùng nhé" thì không, để nó rơi về AgentService.
 *
 * Trả candidate_id chuẩn hoá, hoặc null nếu không phải một lựa chọn.
 */
/**
 * Cửa thoát flow v7 — khớp chuỗi cố định, KHÔNG phân loại ý định.
 *
 * Hai nấc, vì cùng lý do với `looksLikeResearchTrigger`: khi chưa đặt
 * `ZALO_BOT_NAME` thì `stripBotMention` không gỡ hết được tên bot nhiều chữ,
 * và cửa thoát — thứ tồn tại để cứu nhóm khỏi một flow kẹt — sẽ chính nó bị
 * kẹt sau cái tiền tố mention. Nấc hai chỉ mở khi tin bắt đầu bằng mention.
 *
 * Nhận nhầm ở đây rẻ: hậu quả tệ nhất là đóng flow, mà mở lại chỉ mất một câu.
 */
export function isEscapeCommand(clean: string, raw: string): boolean {
  const EXACT = /^(tho[áa]t|hu[ỷy] flow|d[ừu]ng flow|\/exit)\.?$/iu;
  if (EXACT.test(clean)) return true;
  const TAIL = /(^|\s)(tho[áa]t|hu[ỷy] flow|d[ừu]ng flow|\/exit)\.?$/iu;
  return raw.trim().startsWith("@") && TAIL.test(clean);
}

export function parseCandidate(text: string): string | null {
  const t = text.trim().toLowerCase();

  // Dạng id đầy đủ: candidate_02 / cand_A
  const explicit = t.match(/\b((?:candidate|cand)[_-]?[a-z0-9]+)\b/);
  if (explicit) return explicit[1];

  // Chỉ mỗi con số, hoặc số kèm động từ chọn. Emoji keycap 1️⃣ cũng tính.
  const num = t
    .replace(/[\u{FE0F}\u{20E3}]/gu, "")
    .match(/^(?:chọn|chon|lấy|lay|đi|di|ok)?\s*([1-9])\s*(?:nhé|nha|nhe|đi|di|!|\.)?$/u);
  return num ? `candidate_${num[1].padStart(2, "0")}` : null;
}

function verifySecret(received?: string): boolean {
  const expected = process.env.ZALO_WEBHOOK_SECRET;
  if (!expected) return true; // chưa cấu hình → không chặn (dev local)
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

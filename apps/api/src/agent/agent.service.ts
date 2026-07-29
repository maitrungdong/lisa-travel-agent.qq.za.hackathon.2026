import Anthropic from "@anthropic-ai/sdk";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { DB, type Database } from "../db/database.module";
import { JobsService } from "../jobs/jobs.service";
import { MediaService, visionMime } from "../media/media.service";
import { OutcomeService } from "../pipeline/outcome.service";
import { envInt, envStr } from "../pipeline/pipeline.types";
import { ConversationService } from "../zalo/conversation.service";
import { STATIC_SYSTEM, buildDynamicContext } from "./prompt";
import { loadTripState, toolMap, toolsForApi, type FollowUp, type ToolContext } from "./tools";

const MODEL = envStr("ZINO_MODEL", "claude-sonnet-5");
const MAX_TOOL_ROUNDS = 8;
/**
 * Đo thật 29/07 18:22: lượt "đưa 3 options villa đây" trả về **0 ký tự** rồi
 * rơi vào tin lỗi mặc định — 2000 token không đủ để model liệt kê ba phương án
 * kèm giá và lý do. Nâng lên 4000.
 *
 * Không nâng nữa: `max_tokens` là trần, không phải mục tiêu, nhưng nó cũng là
 * thứ giữ cho câu trả lời không tràn quá 2000 ký tự của Zalo.
 */
const MAX_TOKENS = 4000;

/**
 * Trần độ dài MỘT kết quả tool trước khi đưa lại vào ngữ cảnh.
 *
 * Vì sao cần: mỗi vòng tool gửi lại TOÀN BỘ hội thoại cộng mọi kết quả trước
 * đó. Lượt job#192 ngày 29/07 có 10 lời gọi tool và đọc **109.872 token** —
 * gấp 7 lần mức thường — rồi chạy mất 196 giây.
 *
 * 4000 ký tự đủ cho mọi kết quả hữu ích (danh sách OA, trạng thái chuyến,
 * bảng chia tiền) mà chặn được trường hợp một tool trả về cả nghìn dòng.
 */
const MAX_TOOL_RESULT_CHARS = 4000;
/**
 * Trần thời gian cho MỘT lượt. Chạm trần thì trả lời tạm còn hơn để user
 * nhìn "đang soạn tin" mãi rồi im — im lặng là kiểu hỏng tệ nhất trong chat.
 */
const TURN_TIMEOUT_MS = envInt("ZINO_TURN_TIMEOUT_MS", 75_000);
/**
 * Trần số ảnh đính vào một lượt. Mỗi ảnh tốn ~1.500 token — cả nhóm cùng gửi
 * ảnh mà không chặn thì một lượt phình lên chục nghìn token.
 */
const MAX_IMAGES_PER_TURN = 3;

export interface AgentTurnInput {
  conversationId: number;
  zaloChatId: string;
  senderZaloId: string;
  senderName: string;
  text: string | null;
  imageUrl: string | null;
  imagePath: string | null;
  imageMime: string | null;
  /**
   * Báo tiến trình GIỮA lượt — worker truyền vào để bắn thẳng về nhóm.
   *
   * Vì sao là callback chứ không inject ZaloClient: AgentService cố ý không
   * biết gì về kênh gửi (nó chỉ trả `replies`), và giữ nguyên điều đó giúp
   * test không cần mock Zalo. Bên gọi quyết định tiến trình đi đâu.
   */
  onProgress?: (text: string) => void;
}

/**
 * Câu báo tiến trình theo tool — gửi NGAY khi model quyết định gọi tool đó,
 * tức là đầu quãng chờ dài nhất (web_search + soạn thẻ còn 10-20s phía sau).
 *
 * Chỉ những tool mở ra quãng chờ dài mới có mặt. Tool vài ms (add_expense,
 * remember...) không nằm đây — báo tiến trình cho việc 5ms là spam.
 * Mỗi lượt chỉ bắn MỘT câu (câu đầu tiên khớp), xem vòng tool bên dưới.
 */
const PROGRESS_LINES: Record<string, string> = {
  search_partner_oa: "🔎 Mình đang lục danh bạ đối tác Zalo và so giá, đợi mình xíu nha…",
  planning_agent: "🧠 Mình đang nghiên cứu kỹ phần này, chờ mình chút nha…",
  settle_expenses: "🧮 Mình đang chốt sổ và tính chia tiền…"
};

export interface QueuedReply {
  text: string;
  /** Tên người mà tin này nhắm tới — chỉ có khi agent chủ động tách */
  to?: string;
}

export interface AgentTurnResult {
  /** Danh sách tin cần gửi, theo đúng thứ tự. Thường 1 tin; nhiều khi agent tách. */
  replies: QueuedReply[];
  /**
   * Tin do BACKEND quyết định gửi thêm, luôn nằm SAU `replies`.
   *
   * Không đi chung với `replies` vì hai thứ khác nguồn gốc: `replies` là lời
   * của model, còn đây là tin hệ thống bắt buộc phải có — ví dụ link Mini App
   * sau khi tạo chuyến. Trộn chung thì logic "agent tách tin" sẽ nuốt mất chúng.
   */
  followUps: FollowUp[];
  toolsUsed: string[];
  rounds: number;
}

type Msg = Anthropic.MessageParam;

/**
 * Một lượt hội thoại của Zino.
 *
 * Thiết kế:
 *  • Hot path dùng Messages API (không phải Managed Agents) vì cần <3s và cần
 *    strict tool schema. Việc dài chạy nền qua job queue.
 *  • Vòng lặp tool có TRẦN CỨNG — model lú không làm treo hệ thống.
 *  • Tool lỗi trả ok:false cho model tự xoay, KHÔNG ném exception ra user.
 */
@Injectable()
export class AgentService {
  private readonly log = new Logger(AgentService.name);
  /**
   * `timeout` phải nhỏ hơn `TURN_TIMEOUT_MS`.
   *
   * `TURN_TIMEOUT_MS` chỉ được kiểm GIỮA các vòng tool (xem vòng lặp dưới), nên
   * nếu một lời gọi API treo thì trần lượt không bao giờ có cơ hội chạm tới —
   * job cứ nằm đó giữ khoá `dedupe_key` của hội thoại cho tới `STALE_LOCK_MS`
   * 15 phút. 60s cho mỗi lời gọi để cả 8 vòng vẫn nằm trong tầm kiểm soát.
   */
  private readonly client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    timeout: 60_000,
    maxRetries: 2
  });

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly conversations: ConversationService,
    private readonly media: MediaService,
    private readonly jobs: JobsService,
    private readonly outcome: OutcomeService
  ) {}

  async runTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    const conv = await this.db.query.conversations.findFirst({
      where: (c, { eq }) => eq(c.id, input.conversationId)
    });
    if (!conv) throw new Error(`Không tìm thấy conversation ${input.conversationId}`);

    const memory = await this.db.query.groupMemory.findFirst({
      where: (m, { eq }) => eq(m.conversationId, input.conversationId)
    });

    // Tool có thể đổi trip active giữa chừng (create_trip) → giữ ở biến ngoài
    let activeTripId = conv.activeTripId;
    let progressSent = false;
    const queued: QueuedReply[] = [];
    const followUps: FollowUp[] = [];

    const ctx: ToolContext = {
      db: this.db,
      conversationId: input.conversationId,
      get tripId() {
        return activeTripId;
      },
      zaloChatId: input.zaloChatId,
      senderZaloId: input.senderZaloId,
      senderName: input.senderName,
      publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, ""),
      setActiveTrip: (id) => {
        activeTripId = id;
        void this.conversations.setActiveTrip(input.conversationId, id);
      },
      enqueue: async (kind, payload, runAt, dedupeKey) => {
        await this.jobs.enqueue(kind as never, payload, { runAt, dedupeKey });
      },
      queueReply: (text, to) => {
        queued.push({ text, to });
      },
      pushFollowUp: (text) => {
        const t = text.trim();
        // Chống trùng: tool có thể chạy hai lần trong một lượt (model gọi lại)
        if (t && !followUps.some((f) => f.text === t)) followUps.push({ text: t });
      },
      pushCard: (photoUrl, caption) => {
        const t = caption.trim();
        const u = photoUrl.trim();
        if (!t || !u) return;
        // Chống trùng theo cặp ảnh+caption — model gọi lại present_option là chuyện thường
        if (!followUps.some((f) => f.text === t && f.photoUrl === u)) {
          followUps.push({ text: t, photoUrl: u });
        }
      },
      ensurePlanningRun: async () =>
        this.outcome.ensureRun({
          conversationId: input.conversationId,
          zaloChatId: input.zaloChatId,
          actorId: input.senderZaloId,
          actorName: input.senderName
        }),
      closePlanningRun: async () => {
        const run = await this.outcome.findActive(input.conversationId);
        if (!run) return false;
        await this.outcome.close(run.id, "cancelled");
        return true;
      }
    } as ToolContext;

    const tripState = await loadTripState(ctx);
    // Hành trình v4 đang mở hay không — model phải BIẾT, không được đoán
    const planningRun = await this.outcome.findActive(input.conversationId);

    /**
     * System prompt tách hai khối để bật prompt caching:
     *   khối 1 (tĩnh)  → cache_control ephemeral, dùng lại ở mọi lượt/mọi nhóm
     *   khối 2 (động)  → bối cảnh lượt này, không cache
     *
     * Cùng với tools (cũng được cache), mỗi lượt tiết kiệm ~2.700 token đọc lại.
     * Cache hit tính giá 0.1x → giảm khoảng 90% chi phí phần cố định, và giảm
     * latency đáng kể vì model không phải xử lý lại tiền tố.
     */
    const system: Anthropic.TextBlockParam[] = [
      {
        type: "text",
        text: STATIC_SYSTEM,
        cache_control: { type: "ephemeral" }
      },
      {
        type: "text",
        text: buildDynamicContext({
          chatType: conv.chatType,
          senderName: input.senderName,
          seenCount: conv.seenCount,
          isReturning: conv.seenCount > 1,
          memory: memory?.content ?? "",
          tripState: tripState ? JSON.stringify(tripState, null, 2) : null,
          nowIso: new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }),
          planningOpen: Boolean(planningRun)
        })
      }
    ];

    const messages = await this.buildHistory(input);

    const toolsUsed: string[] = [];
    let rounds = 0;
    let finalText = "";
    const turnStarted = Date.now();

    // Tường thuật để `docker compose logs -f api` đọc được như một dòng thời gian.
    // Quan sát được agent đang làm gì là điều kiện tối thiểu để debug nó.
    const tag = `[${input.zaloChatId.slice(-6)}]`;
    this.log.log(
      `${tag} ▶ ${input.senderName}: ${preview(input.text) || "(ảnh)"}` +
        `${input.imagePath ? " 📎ảnh" : ""}` +
        ` · trip=${activeTripId ?? "chưa có"} · nhớ=${memory?.content ? "có" : "trống"}` +
        `${planningRun ? ` · 🧭 hành trình run#${planningRun.id}` : ""}`
    );

    let cacheRead = 0;
    let cacheWrite = 0;

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;

      // Hết giờ thì dừng vòng lặp, trả lời bằng những gì đã có
      if (Date.now() - turnStarted > TURN_TIMEOUT_MS) {
        this.log.warn(`${tag} ⏱ chạm trần ${TURN_TIMEOUT_MS / 1000}s sau ${rounds - 1} vòng`);
        break;
      }

      /**
       * Trần thời gian theo NGÂN SÁCH CÒN LẠI của lượt, không phải một số cố định.
       *
       * Đo thật 29/07 17:46 — job#192 chạy 196 giây cho một lượt lẽ ra 2–9 giây.
       * Nguyên nhân: 5 vòng tool làm context phình lên 110K token, mỗi lời gọi
       * API chậm quá `timeout: 60s` của client, và SDK tự thử lại 2 lần nữa:
       * 60 + 60 + 76 ≈ 196.
       *
       * Trần `TURN_TIMEOUT_MS` bên dưới vô dụng trong tình huống đó vì nó chỉ
       * được kiểm GIỮA các vòng — không cắt được một lời gọi đang treo.
       *
       * Chia cho `maxRetries + 1` để cả cụm thử lại vẫn nằm trong ngân sách.
       * Nhờ vậy một lượt KHÔNG BAO GIỜ vượt quá `TURN_TIMEOUT_MS`, dù model
       * chậm cỡ nào.
       */
      const remaining = TURN_TIMEOUT_MS - (Date.now() - turnStarted);
      const perRequestTimeout = Math.max(10_000, Math.floor(remaining / 3));

      const res = await this.client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages,
        tools: [
          ...toolsForApi(),
          // Server tool của Anthropic — dùng để tra giá/địa điểm thật, chống bịa số
          { type: "web_search_20260318", name: "web_search", max_uses: 4 } as never,
          /**
           * `web_fetch` — MỞ ĐƯỢC trang, không chỉ đọc đoạn tóm tắt.
           *
           * Thiếu nó thì `web_search` chỉ trả về snippet của công cụ tìm kiếm,
           * và agent phải suy ra giá từ vài dòng mô tả — đúng chỗ số liệu bắt
           * đầu sai. Có nó thì nó mở thẳng trang khách sạn đọc giá thật.
           *
           * Trần 3 lượt: mỗi lần fetch là vài giây mạng cộng thời gian đọc, mà
           * lượt hội thoại có trần 75s.
           *
           * Cả hai server tool đều chạy trên hạ tầng Anthropic nên KHÔNG vướng
           * allowlist host của environment — thứ đã treo lượt research của v4
           * suốt 240 giây sáng nay.
           */
          { type: "web_fetch_20250910", name: "web_fetch", max_uses: 3 } as never
        ]
      }, { timeout: perRequestTimeout });

      const u = res.usage as Anthropic.Usage & {
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
      };
      cacheRead += u.cache_read_input_tokens ?? 0;
      cacheWrite += u.cache_creation_input_tokens ?? 0;

      const textParts = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text);
      if (textParts.length) finalText = textParts.join("\n\n");

      const toolCalls = res.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      if (res.stop_reason !== "tool_use" || toolCalls.length === 0) break;

      messages.push({ role: "assistant", content: res.content });

      // Một câu báo tiến trình mỗi lượt, bắn khi model vừa chọn tool "chậm".
      // Đặt TRƯỚC khi thực thi: người dùng thấy phản hồi ở đầu quãng chờ,
      // không phải cuối. Fire-and-forget — tiến trình không được phép làm
      // hỏng lượt.
      if (input.onProgress && !progressSent) {
        const line = toolCalls.map((c) => PROGRESS_LINES[c.name]).find(Boolean);
        if (line) {
          progressSent = true;
          try {
            input.onProgress(line);
          } catch {
            /* nuốt — tiến trình chỉ là trang trí */
          }
        }
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of toolCalls) {
        toolsUsed.push(call.name);
        const started = Date.now();
        const result = await this.execute(call.name, call.input as Record<string, unknown>, ctx);
        const ms = Date.now() - started;

        const args = summarizeArgs(call.input as Record<string, unknown>);
        if (result.ok) {
          this.log.log(`${tag}   🔧 ${call.name}(${args}) ✓ ${ms}ms`);
        } else {
          this.log.warn(`${tag}   🔧 ${call.name}(${args}) ✗ ${ms}ms — ${String(result.error)}`);
        }

        // Cắt trước khi đưa lại vào ngữ cảnh — xem MAX_TOOL_RESULT_CHARS
        let payload = JSON.stringify(result);
        if (payload.length > MAX_TOOL_RESULT_CHARS) {
          const cut = payload.length - MAX_TOOL_RESULT_CHARS;
          payload = `${payload.slice(0, MAX_TOOL_RESULT_CHARS)}…[đã cắt ${cut} ký tự]`;
          this.log.warn(`${tag}   ⚠ kết quả ${call.name} dài ${cut + MAX_TOOL_RESULT_CHARS} ký tự — đã cắt`);
        }

        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: payload,
          is_error: result.ok === false
        });
      }
      messages.push({ role: "user", content: results });
    }

    this.log.log(
      `${tag} ◀ ${queued.length > 0 ? `${queued.length} tin (agent tách)` : `1 tin ${finalText.length} ký tự`} · ` +
        `${rounds} vòng · ${toolsUsed.length ? toolsUsed.join(", ") : "không dùng tool"} · ` +
        `${((Date.now() - turnStarted) / 1000).toFixed(1)}s · ` +
        `cache đọc ${cacheRead} / ghi ${cacheWrite}`
    );

    /**
     * Ưu tiên các tin agent chủ động xếp hàng qua tool `reply` (khi nó quyết
     * định tách câu trả lời). Không có thì dùng văn bản cuối — đây là đường
     * mặc định an toàn: agent quên gọi tool cũng không im lặng.
     */
    const replies: QueuedReply[] =
      queued.length > 0
        ? queued
        : finalText.trim()
          ? [{ text: finalText.trim() }]
          : [];

    if (replies.length === 0) {
      this.log.warn(`${tag} không sinh ra câu trả lời nào sau ${rounds} vòng`);
      replies.push({ text: "Mình đang xử lý hơi lâu 😅 Bạn nhắn lại giúp mình rõ hơn nhé?" });
    }

    return { replies, followUps, toolsUsed, rounds };
  }

  /** Chạy tool, bọc lỗi thành ToolResult để model tự xoay xở. */
  private async execute(
    name: string,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<{ ok: boolean; [k: string]: unknown }> {
    const tool = toolMap.get(name);
    if (!tool) return { ok: false, error: `Tool không tồn tại: ${name}` };

    try {
      return await tool.handler(input, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`tool ${name} nổ: ${message}`);
      return {
        ok: false,
        error: message,
        hint: "Tool gặp lỗi kỹ thuật. Nói với user là chưa lưu được, đừng giả vờ thành công."
      };
    }
  }

  /**
   * Dựng lịch sử + GOM cả loạt tin chưa được trả lời thành một lượt.
   *
   * Backend gộp job theo cửa sổ thời gian, nên khi tới đây có thể đã có nhiều
   * tin từ nhiều người. Tất cả tin nằm SAU câu trả lời gần nhất của Zino đều
   * là "chưa xử lý" → gộp vào một khối user duy nhất, ghi rõ ai nói gì.
   *
   * Nhờ vậy Zino nhìn được cả cuộc trao đổi thay vì từng mẩu rời, và tự quyết
   * định nên gộp hay tách câu trả lời.
   */
  private async buildHistory(input: AgentTurnInput): Promise<Msg[]> {
    const rows = await this.conversations.recentMessages(input.conversationId, 20);

    // Cắt tại câu trả lời cuối cùng của Zino
    let lastAssistant = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].role === "assistant") {
        lastAssistant = i;
        break;
      }
    }
    const history = rows.slice(0, lastAssistant + 1);
    const pending = rows.slice(lastAssistant + 1).filter((r) => r.role === "user");

    const messages: Msg[] = [];
    for (const row of history) {
      const text = row.text?.trim();
      if (!text) continue;
      messages.push({
        role: row.role === "assistant" ? "assistant" : "user",
        content: row.role === "assistant" ? text : `${row.senderName ?? "Bạn"}: ${text}`
      });
    }

    const content: Anthropic.ContentBlockParam[] = [];
    const senders = new Set<string>();

    // Đính ảnh của loạt tin này — trần 3 ảnh để không thổi phồng context
    let attached = 0;
    for (const row of pending) {
      if (!row.imageUrl || attached >= MAX_IMAGES_PER_TURN) continue;
      const path = this.media.pathFromUrl(row.imageUrl);
      const base64 = path ? await this.media.toBase64(path) : null;
      if (!base64) continue;

      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: visionMime(guessMimeFromUrl(row.imageUrl)),
          data: base64
        }
      });
      content.push({
        type: "text",
        text:
          `[Ảnh trên do ${row.senderName ?? "ai đó"} gửi — URL đã lưu: ${row.imageUrl}]\n` +
          "Tự nhận diện là hoá đơn, vé/booking, hay ảnh kỷ niệm rồi hành động tương ứng. " +
          "Hoá đơn → add_expense kèm receipt_photo_url là URL trên. " +
          "Ảnh kỷ niệm → add_photo với url là URL trên."
      });
      attached++;
    }

    // Gom text của cả loạt, ghi rõ ai nói gì
    const lines = pending
      .map((r) => {
        const t = r.text?.trim();
        if (!t) return null;
        senders.add(r.senderName ?? "Bạn");
        return `${r.senderName ?? "Bạn"}: ${t}`;
      })
      .filter(Boolean) as string[];

    if (lines.length > 0) {
      const header =
        senders.size > 1
          ? `[${lines.length} tin từ ${senders.size} người, gửi gần như cùng lúc — ` +
            `xem có liên quan nhau không rồi quyết định gộp hay tách câu trả lời bằng tool \`reply\`]\n\n`
          : "";
      content.push({ type: "text", text: header + lines.join("\n") });
    }

    if (content.length === 0) {
      content.push({ type: "text", text: `${input.senderName} gửi một tin nhắn.` });
    }

    messages.push({ role: "user", content });

    // Messages API bắt buộc lượt đầu là user
    while (messages.length && messages[0].role !== "user") messages.shift();
    return messages;
  }
}

function guessMimeFromUrl(url: string): string {
  const ext = url.split(".").pop()?.toLowerCase() ?? "";
  return { png: "image/png", gif: "image/gif", webp: "image/webp" }[ext] ?? "image/jpeg";
}

/** Cắt ngắn để log không tràn màn hình. */
function preview(text: string | null, max = 60): string {
  if (!text) return "";
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/**
 * Tóm tắt input của tool cho dễ đọc trên log.
 * Che các trường dài (URL ảnh, nội dung tin nhắn) — chỉ cần biết agent đang
 * làm gì, không cần đọc nguyên payload.
 */
function summarizeArgs(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null || v === "") continue;
    let s: string;
    if (typeof v === "string") s = v.length > 28 ? `"${v.slice(0, 28)}…"` : `"${v}"`;
    else if (Array.isArray(v)) s = `[${v.length}]`;
    else if (typeof v === "object") s = "{…}";
    else s = String(v);
    parts.push(`${k}=${s}`);
    if (parts.length >= 4) {
      parts.push("…");
      break;
    }
  }
  return parts.join(" ");
}

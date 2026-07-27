import { timingSafeEqual } from "node:crypto";
import { Body, Controller, Get, Headers, HttpCode, Logger, Post } from "@nestjs/common";
import { JobsService } from "../jobs/jobs.service";
import { MediaService } from "../media/media.service";
import { ConversationService } from "./conversation.service";
import { ZaloClient } from "./zalo.client";
import { normalizeUpdate, type ZaloUpdate } from "./zalo.types";

/**
 * Cổng vào duy nhất từ Zalo.
 *
 * NGUYÊN TẮC: trả 200 NHANH rồi mới xử lý.
 * Zalo retry khi webhook timeout → xử lý đồng bộ = agent chạy 2 lần cho 1 tin.
 * Ở đây chỉ làm 4 việc rẻ: verify chữ ký · chuẩn hoá · tải ảnh · đẩy vào hàng đợi.
 */
@Controller("zalo")
export class ZaloController {
  private readonly log = new Logger(ZaloController.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly media: MediaService,
    private readonly conversations: ConversationService,
    private readonly zalo: ZaloClient
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

    // dedupeKey = chatId → mọi tin trong cùng nhóm chạy TUẦN TỰ, không ghi đè state
    await this.jobs.enqueue(
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
      { dedupeKey: msg.chatId }
    );
  }

  /** Tiện ích vận hành: xem bot đang nối webhook nào. */
  @Get("info")
  async info() {
    const [me, hook] = await Promise.all([this.zalo.getMe(), this.zalo.getWebhookInfo()]);
    return { me, webhook: hook };
  }
}

function verifySecret(received?: string): boolean {
  const expected = process.env.ZALO_WEBHOOK_SECRET;
  if (!expected) return true; // chưa cấu hình → không chặn (dev local)
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

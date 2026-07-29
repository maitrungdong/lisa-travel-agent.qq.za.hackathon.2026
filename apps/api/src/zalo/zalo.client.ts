import { Injectable, Logger } from "@nestjs/common";
import { toZaloMessages } from "./render";
import type { ZaloApiResponse, ZaloBotInfo } from "./zalo.types";

const BASE = process.env.ZALO_BOT_API_BASE ?? "https://bot-api.zaloplatforms.com";

/**
 * Client Zalo Bot API.
 *
 * Ràng buộc đã verify, đừng "tối ưu" đi mất:
 *  • Token nằm trong PATH, không phải header Authorization
 *  • Chỉ plain text, tối đa 2000 ký tự/tin  → luôn đi qua toZaloMessages()
 *  • sendPhoto nhận URL CÔNG KHAI, không phải multipart upload
 *  • Không có album — gửi nhiều ảnh = gọi lặp
 *  • sendChatAction chỉ có action "typing"
 */
@Injectable()
export class ZaloClient {
  private readonly log = new Logger(ZaloClient.name);
  private readonly token = process.env.ZALO_BOT_TOKEN ?? "";

  private url(method: string): string {
    return `${BASE}/bot${this.token}/${method}`;
  }

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
    if (!this.token) {
      this.log.warn(`Bỏ qua ${method}: chưa cấu hình ZALO_BOT_TOKEN`);
      return null;
    }
    try {
      const res = await fetch(this.url(method), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000)
      });
      const json = (await res.json()) as ZaloApiResponse<T>;
      if (!json.ok) {
        this.log.error(`${method} lỗi ${json.error_code}: ${json.description}`);
        return null;
      }
      return json.result ?? null;
    } catch (err) {
      this.log.error(`${method} thất bại: ${(err as Error).message}`);
      return null;
    }
  }

  getMe(): Promise<ZaloBotInfo | null> {
    return this.call<ZaloBotInfo>("getMe", {});
  }

  /** Hiện "đang soạn tin" — bắn ngay khi nhận webhook để che latency của agent. */
  async sendTyping(chatId: string): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action: "typing" });
  }

  /**
   * Gửi text thô, KHÔNG tự cắt. Chỉ dùng khi đã tự chunk.
   *
   * Trả `true` khi Zalo nhận. Phần lớn caller bỏ qua giá trị này — đúng, vì
   * không gửi được một tin trả lời thì cũng chẳng làm gì hơn được. Nhưng nhắc
   * hẹn thì KHÁC: nó đánh dấu `sent = true` sau khi gửi, nên phải biết thật sự
   * gửi được hay chưa, nếu không một lần Zalo trục trặc là mất luôn lời nhắc
   * mà không để lại dấu vết.
   */
  async sendRaw(chatId: string, text: string): Promise<boolean> {
    return (await this.call("sendMessage", { chat_id: chatId, text })) !== null;
  }

  /**
   * Gửi tin có ĐỊNH DẠNG THẬT — đậm, màu, danh sách — bằng `parse_mode`.
   *
   * Bot API mới hỗ trợ `parse_mode: markdown|html` và `text_styles`
   * (docs.zaloplatforms.com/docs/BOT/apis/sendMessage). `render.ts` được viết
   * từ thời "Zalo chỉ nhận plain text" nên đang dịch markdown sang ký tự
   * Unicode — cách đó vẫn chạy, nhưng giờ có đường chính thống đẹp hơn.
   *
   * Vẫn KHÔNG có nút bấm: toàn bộ API của Bot chỉ có sendMessage / sendPhoto /
   * sendSticker / sendChatAction / sendVoice. Trang giới thiệu có nhắc
   * "carousel, quick reply" nhưng không endpoint nào đứng sau. Nên "card" của
   * Zino = text định dạng đẹp + một link mở Mini App.
   *
   * Rơi về plain text khi Zalo từ chối: định dạng hỏng thì mất đẹp, còn không
   * gửi được tin thì mất cả nội dung.
   */
  async sendRich(chatId: string, markdown: string): Promise<boolean> {
    const text = markdown.slice(0, 2000);
    const ok = await this.call("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "markdown"
    });
    if (ok !== null) return true;

    this.log.warn("parse_mode markdown bị từ chối — gửi lại dạng plain text");
    await this.sendMarkdown(chatId, markdown);
    return false;
  }

  /**
   * Gửi nội dung markdown: tự render sang plain text, tự cắt ≤2000, gửi tuần tự.
   *
   * Trả về số tin GỬI ĐƯỢC, không phải số tin định gửi — hai con số đó khác nhau
   * khi Zalo từ chối, và caller cần biết sự khác biệt đó (xem `sendRaw`).
   */
  async sendMarkdown(chatId: string, markdown: string): Promise<number> {
    const parts = toZaloMessages(markdown);
    let sent = 0;
    for (const [i, part] of parts.entries()) {
      if (await this.sendRaw(chatId, part)) sent++;
      // Giãn nhẹ để Zalo giữ đúng thứ tự và tránh chạm rate limit
      if (i < parts.length - 1) await sleep(350);
    }
    return sent;
  }

  /**
   * Gửi sticker theo ID.
   *
   * ID hợp lệ KHÔNG có trong tài liệu Zalo — cách duy nhất để có là bắt từ
   * webhook: người dùng gửi sticker cho bot, `message.sticker` chính là ID
   * dùng lại được (controller in ra log dòng "Sticker nhận được: ...").
   * Gửi ID không tồn tại thì Zalo lặng lẽ từ chối — vô hại nhưng không có gì
   * hiện ra, nên đừng dựa vào sticker cho nội dung quan trọng.
   */
  async sendSticker(chatId: string, stickerId: string): Promise<void> {
    await this.call("sendSticker", { chat_id: chatId, sticker: stickerId });
  }

  /** photoUrl PHẢI là URL https công khai — Zalo tự đi fetch. */
  async sendPhoto(chatId: string, photoUrl: string, caption?: string): Promise<void> {
    await this.call("sendPhoto", {
      chat_id: chatId,
      photo: photoUrl,
      ...(caption ? { caption: caption.slice(0, 1000) } : {})
    });
  }

  /** Không có API album → gửi lần lượt, đánh số caption. */
  async sendPhotos(chatId: string, photos: { url: string; caption?: string }[]): Promise<void> {
    for (const [i, p] of photos.entries()) {
      const cap = photos.length > 1 ? `[${i + 1}/${photos.length}] ${p.caption ?? ""}`.trim() : p.caption;
      await this.sendPhoto(chatId, p.url, cap);
      await sleep(400);
    }
  }

  async setWebhook(url: string, secretToken: string): Promise<boolean> {
    const r = await this.call<unknown>("setWebhook", {
      url,
      secret_token: secretToken,
      drop_pending_updates: true
    });
    return r !== null;
  }

  getWebhookInfo(): Promise<{ url?: string; updated_at?: number } | null> {
    return this.call("getWebhookInfo", {});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

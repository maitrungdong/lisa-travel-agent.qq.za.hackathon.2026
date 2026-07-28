import { Injectable, Logger } from "@nestjs/common";

const OPEN_API = "https://openapi.zalo.me/v3.0/oa";

/**
 * Zalo OA Open API v3.0 — gửi tin thay mặt OA đã uỷ quyền.
 *
 * Chỉ dùng "tin tư vấn" (`/message/cs`): miễn phí, không cần duyệt template,
 * điều kiện là user đã tương tác với OA trong 7 ngày. Lead của ta luôn thoả
 * vì user vừa nhắn cho OA xong.
 *
 * KHÔNG dùng ZNS/ZBS template — cần duyệt 2-3 ngày làm việc và phải nạp tiền,
 * không kịp hackathon.
 */
@Injectable()
export class OaClient {
  private readonly log = new Logger(OaClient.name);

  /** Gửi tin văn bản tới user của OA. `userId` là UID scope theo chính OA đó. */
  async sendText(accessToken: string, userId: string, text: string): Promise<boolean> {
    return this.send(accessToken, {
      recipient: { user_id: userId },
      message: { text: text.slice(0, 2000) }
    });
  }

  /**
   * Gửi tin kèm nút. OA chỉ hỗ trợ 5 loại button và tối đa 5 nút —
   * `oa.open.url` là loại duy nhất hữu ích để chuyển user sang nơi khác.
   */
  async sendTextWithButtons(
    accessToken: string,
    userId: string,
    text: string,
    buttons: { title: string; url: string }[]
  ): Promise<boolean> {
    return this.send(accessToken, {
      recipient: { user_id: userId },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "request_user_info",
            elements: [
              {
                title: text.slice(0, 100),
                subtitle: text.slice(0, 500),
                image_url: ""
              }
            ]
          }
        },
        text: text.slice(0, 2000),
        buttons: buttons.slice(0, 5).map((b) => ({
          title: b.title.slice(0, 100),
          type: "oa.open.url",
          payload: { url: b.url }
        }))
      }
    });
  }

  private async send(accessToken: string, body: unknown): Promise<boolean> {
    try {
      const res = await fetch(`${OPEN_API}/message/cs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", access_token: accessToken },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
      });
      const json = (await res.json()) as { error?: number; message?: string };

      if (json.error !== 0) {
        this.log.error(`Gửi tin OA lỗi ${json.error}: ${json.message}`);
        return false;
      }
      return true;
    } catch (err) {
      this.log.error(`Lỗi gửi tin OA: ${(err as Error).message}`);
      return false;
    }
  }
}

/* ------------------------------------------------------------------------- */

/** Sự kiện webhook OA mà ta quan tâm. */
export interface OaWebhookEvent {
  app_id?: string;
  /** oa_id — dùng để biết tin này thuộc OA đối tác nào */
  recipient?: { id?: string };
  /** user gửi tin — id chính là UID scope theo OA */
  sender?: { id?: string };
  event_name?: string;
  message?: { msg_id?: string; text?: string };
  timestamp?: string | number;
  user_id_by_app?: string;
}

export interface NormalizedOaEvent {
  oaId: string;
  userId: string;
  text: string;
  messageId: string;
  eventName: string;
  at: Date;
}

/**
 * Chuẩn hoá webhook OA. Trả null nếu không phải sự kiện user gửi tin.
 *
 * ⚠ Chiều của `sender`/`recipient` ngược với trực giác: với sự kiện
 * `user_send_text` thì sender = USER, recipient = OA.
 */
export function normalizeOaEvent(raw: OaWebhookEvent): NormalizedOaEvent | null {
  const eventName = raw.event_name ?? "";
  if (!eventName.startsWith("user_send")) return null;

  const oaId = raw.recipient?.id;
  const userId = raw.sender?.id;
  if (!oaId || !userId) return null;

  const ts = Number(raw.timestamp);
  return {
    oaId,
    userId,
    text: raw.message?.text?.trim() ?? "",
    messageId: raw.message?.msg_id ?? "",
    eventName,
    at: Number.isFinite(ts) && ts > 0 ? new Date(ts > 1e11 ? ts : ts * 1000) : new Date()
  };
}

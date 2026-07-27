/**
 * Kiểu dữ liệu Zalo Bot API.
 *
 * Nguồn: bot-api.zaloplatforms.com — đối chiếu chéo từ SDK cộng đồng
 * (go-zalo-bot-api, zalo-bot-js) vì portal render bằng JS không đọc tự động được.
 *
 * ⚠ Khác Telegram ở 2 chỗ dễ sai:
 *   1. Trường phân biệt group/1-1 là `chat_type`, KHÔNG phải `type`
 *   2. Ảnh vào là `photo_url` (URL trần) — không có vòng file_id → getFile
 */

/** Toàn bộ event inbound Zalo Bot hỗ trợ. Mọi thứ khác rơi vào `unsupported`. */
export type ZaloEventName =
  | "message.text.received"
  | "message.image.received"
  | "message.sticker.received"
  | "message.unsupported.received";

export interface ZaloChat {
  id: string;
  /** "direct" | "group" */
  chat_type?: string;
}

export interface ZaloUser {
  id: string;
  is_bot?: boolean;
  display_name?: string;
}

export interface ZaloMessage {
  message_id: string;
  date?: number;
  message_type?: string;
  chat: ZaloChat;
  from?: ZaloUser;
  text?: string;
  /** URL ảnh user gửi — tải về NGAY, có thể hết hạn */
  photo_url?: string;
  sticker?: string;
}

export interface ZaloUpdate {
  update_id?: number;
  event_name?: ZaloEventName | string;
  message?: ZaloMessage;
}

/** Envelope chuẩn của mọi response Bot API */
export interface ZaloApiResponse<T> {
  ok: boolean;
  description?: string;
  error_code?: number;
  result?: T;
}

export interface ZaloBotInfo {
  id: string;
  account_name: string;
  account_type: string;
  can_join_groups: boolean;
  display_name: string;
}

/* ------------------------------------------------------------------ */

/** Message đã chuẩn hoá — phần còn lại của hệ thống chỉ biết kiểu này. */
export interface InboundMessage {
  zaloMessageId: string;
  chatId: string;
  /** "direct" | "group" */
  chatType: string;
  senderZaloId: string;
  senderName: string;
  text: string | null;
  /** URL gốc từ Zalo (tạm) */
  photoUrl: string | null;
  stickerId: string | null;
  eventName: string;
  sentAt: Date;
  raw: unknown;
}

/**
 * Zalo trả `chat_type` VIẾT HOA: "PRIVATE" | "GROUP" (không phải "direct"/"group"
 * như tài liệu cộng đồng ghi). So sánh phải case-insensitive, nếu không chat nhóm
 * bị nhận nhầm thành 1-1 — lỗi im lặng, không có exception nào báo.
 */
function normalizeChatType(raw: string | undefined): "group" | "direct" {
  return (raw ?? "").toUpperCase().includes("GROUP") ? "group" : "direct";
}

/**
 * `message.date` của Zalo là MILI-GIÂY (vd 1785176102088), khác Telegram (giây).
 * Nhân 1000 sẽ ra năm 05xxxx và Postgres từ chối insert.
 * Dùng ngưỡng 1e11 để nhận diện đơn vị thay vì tin vào tài liệu.
 */
function normalizeTimestamp(raw: number | undefined): Date {
  if (!raw || !Number.isFinite(raw)) return new Date();
  const ms = raw > 1e11 ? raw : raw * 1000;
  const d = new Date(ms);
  // Chặn giá trị vô lý (lệch >1 năm so với hiện tại) — thà dùng giờ máy còn hơn hỏng DB
  const drift = Math.abs(d.getTime() - Date.now());
  return Number.isNaN(d.getTime()) || drift > 365 * 86_400_000 ? new Date() : d;
}

/** Chuẩn hoá payload webhook → InboundMessage. Trả null nếu không dùng được. */
export function normalizeUpdate(update: ZaloUpdate): InboundMessage | null {
  const m = update.message;
  if (!m?.message_id || !m.chat?.id) return null;

  // Bỏ tin do chính bot gửi — tránh vòng lặp vô hạn
  if (m.from?.is_bot) return null;

  return {
    zaloMessageId: m.message_id,
    chatId: m.chat.id,
    chatType: normalizeChatType(m.chat.chat_type),
    senderZaloId: m.from?.id ?? m.chat.id,
    senderName: m.from?.display_name?.trim() || "Bạn",
    text: m.text?.trim() || null,
    photoUrl: m.photo_url || null,
    stickerId: m.sticker || null,
    eventName: update.event_name ?? "message.text.received",
    sentAt: normalizeTimestamp(m.date),
    raw: update
  };
}

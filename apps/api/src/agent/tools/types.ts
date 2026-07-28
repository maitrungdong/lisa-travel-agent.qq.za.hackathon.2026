import type { Database } from "../../db/database.module";

/** Ngữ cảnh được bơm vào mọi tool. Tool KHÔNG tự đọc process.env hay global state. */
export interface ToolContext {
  db: Database;
  /** conversations.id */
  conversationId: number;
  /** trips.id đang active — null nếu nhóm chưa tạo chuyến nào */
  tripId: number | null;
  /** chat.id của Zalo (để push tin / tạo reminder) */
  zaloChatId: string;
  /** from.id của người vừa nhắn */
  senderZaloId: string;
  senderName: string;
  /** vd https://zah19-team35.123c.vn — dùng dựng link media / mini app */
  publicBaseUrl: string;
  /** Tool có thể đổi trip đang active (vd create_trip) — worker đọc lại sau turn */
  setActiveTrip: (tripId: number) => void;
  /**
   * Đưa job vào hàng đợi (deep_plan, recap, v7_turn...).
   *
   * `dedupeKey` KHÔNG phải tuỳ chọn trang trí. `JobsService.claim()` bỏ qua
   * chốt serialize với mọi job có `dedupe_key IS NULL`, nên job nào cần chạy
   * TUẦN TỰ theo hội thoại thì bắt buộc truyền `ctx.zaloChatId`. Bỏ trống là
   * đúng cho việc độc lập (recap, deep_plan) — chúng chạy song song vô hại.
   */
  enqueue: (
    kind: string,
    payload: Record<string, unknown>,
    runAt?: Date,
    dedupeKey?: string
  ) => Promise<void>;
  /**
   * Xếp một tin trả lời vào hàng chờ gửi.
   *
   * Backend gộp nhiều tin đến gần nhau thành MỘT lượt agent. Agent là bên
   * quyết định gộp hay tách câu trả lời — việc này cần hiểu ngữ nghĩa nên
   * không thể để backend làm.
   */
  queueReply: (text: string, to?: string) => void;
}

/**
 * Mọi tool trả về shape này. LỖI KHÔNG NÉM EXCEPTION — trả ok:false + hint
 * để model tự sửa và nói lại với user cho tử tế.
 */
export type ToolResult =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; error: string; hint?: string };

export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
  /** Strict tool use bắt buộc đóng schema — thiếu dòng này model được phép bịa field */
  additionalProperties: false;
  /** Index signature để khớp kiểu Tool.InputSchema của Anthropic SDK */
  [k: string]: unknown;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: JsonSchema;
  /** true = cần user xác nhận trước khi chạy (thao tác khó hoàn tác) */
  confirmRequired?: boolean;
  handler: (input: Record<string, any>, ctx: ToolContext) => Promise<ToolResult>;
}

/** Helper dựng schema gọn, luôn đóng additionalProperties (bắt buộc cho strict tool use). */
export function schema(
  properties: Record<string, unknown>,
  required: string[] = []
): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

export const S = {
  str: (description: string) => ({ type: "string", description }),
  int: (description: string) => ({ type: "integer", description }),
  num: (description: string) => ({ type: "number", description }),
  bool: (description: string) => ({ type: "boolean", description }),
  enum: (values: string[], description: string) => ({ type: "string", enum: values, description }),
  /** ISO 8601. Model luôn nhận giờ hiện tại theo Asia/Ho_Chi_Minh trong system prompt. */
  date: (description: string) => ({
    type: "string",
    description: `${description} (ISO 8601, vd 2026-08-12T14:00:00+07:00)`
  }),
  arr: (items: unknown, description: string) => ({ type: "array", items, description })
};

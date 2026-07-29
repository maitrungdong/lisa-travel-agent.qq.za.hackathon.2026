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
  /**
   * Gửi thêm MỘT TIN RIÊNG sau câu trả lời của agent.
   *
   * Khác `queueReply` ở chỗ căn bản: `queueReply` THAY THẾ câu trả lời của
   * model (agent chủ động tách tin theo từng người), còn cái này CỘNG THÊM vào
   * sau. Dùng cho những tin do backend quyết định phải có — ví dụ link Mini App
   * sau khi tạo chuyến — mà không được phép nuốt mất lời agent vừa nói.
   *
   * Tách thành tin riêng là có chủ đích: link nằm lẫn trong đoạn văn thì trôi
   * mất giữa cuộc trò chuyện nhóm, còn đứng riêng thì ai cũng thấy và bấm được.
   */
  pushFollowUp: (text: string) => void;
  /**
   * Mở (hoặc lấy) hành trình lên kế hoạch v4 của hội thoại này.
   *
   * Nằm ở `ToolContext` chứ không để tool tự truy vấn DB: vòng đời run là việc
   * của backend — một hành trình mỗi hội thoại, ép bằng partial unique index —
   * còn tool chỉ nên biết "cho tôi hành trình hiện tại".
   */
  ensurePlanningRun: () => Promise<{ id: number }>;
  /** Đóng hành trình đang mở. Trả false nếu không có cái nào. */
  closePlanningRun: () => Promise<boolean>;
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

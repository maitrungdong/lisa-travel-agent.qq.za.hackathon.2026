import { Controller, Get, Inject } from "@nestjs/common";
import { desc, eq, sql } from "drizzle-orm";
import { DB, type Database } from "./db/database.module";
import { conversations, members, trips } from "./db/schema";

/**
 * Endpoint TẠM cho màn debug của Mini App.
 *
 * Mục đích duy nhất: trả lời một câu hỏi kiến trúc chưa ai biết đáp án —
 * `getContextAsync()` của zmp-sdk trả về id nhóm theo hệ Mini App, còn bot lưu
 * nhóm dưới `chat.id` của Bot API (`zgr-...`). HAI CHUỖI ĐÓ CÓ PHẢI MỘT KHÔNG?
 *
 * Không có câu trả lời thì mọi thiết kế đăng nhập/phân quyền đều là phỏng đoán.
 * Có rồi thì hoặc mapping nhóm tự động (chính thống, không cần thao tác tay),
 * hoặc phải nối một lần cho mỗi nhóm.
 *
 * ⚠️ XOÁ FILE NÀY sau khi đã đo xong. Nó phơi id nhóm và tên thành viên ra
 * public. Chấp nhận được trong vài giờ đo đạc, không chấp nhận được lâu hơn.
 * Xoá luôn dòng khai báo trong app.module.ts và màn /debug bên Mini App.
 */
@Controller("debug")
export class DebugController {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Các nhóm bot đã gặp, kèm thành viên — để so trực tiếp với getContextAsync(). */
  @Get("conversations")
  async list() {
    const convs = await this.db
      .select({
        id: conversations.id,
        zaloChatId: conversations.zaloChatId,
        chatType: conversations.chatType,
        title: conversations.title,
        activeTripId: conversations.activeTripId,
        lastSeenAt: conversations.lastSeenAt
      })
      .from(conversations)
      .orderBy(desc(conversations.lastSeenAt))
      .limit(10);

    const tripRows = await this.db
      .select({
        id: trips.id,
        name: trips.name,
        conversationId: trips.conversationId,
        zaloGroupId: trips.zaloGroupId
      })
      .from(trips)
      .orderBy(desc(trips.createdAt))
      .limit(10);

    const memberRows = await this.db
      .select({
        tripId: members.tripId,
        zaloUserId: members.zaloUserId,
        displayName: members.displayName
      })
      .from(members)
      .where(sql`true`)
      .limit(50);

    return {
      conversations: convs,
      trips: tripRows.map((t) => ({
        ...t,
        members: memberRows.filter((m) => m.tripId === t.id)
      })),
      note: "So zaloChatId ở đây với ContextInfo.id mà zmp-sdk trả về trên điện thoại."
    };
  }

  /** Tra ngược: id do Mini App đưa lên có khớp nhóm nào trong DB không. */
  @Get("match")
  async match() {
    const rows = await this.db
      .select({ zaloChatId: conversations.zaloChatId })
      .from(conversations)
      .where(eq(conversations.chatType, "group"));
    return { groupChatIds: rows.map((r) => r.zaloChatId) };
  }
}

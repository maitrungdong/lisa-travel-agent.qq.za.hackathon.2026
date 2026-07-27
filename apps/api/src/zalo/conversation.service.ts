import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DB, type Database } from "../db/database.module";
import { conversations, groupMemory, messages } from "../db/schema";
import type { InboundMessage } from "./zalo.types";

/** Khoảng lặng để coi là một "phiên" mới — dùng cho lời chào và cho reflection. */
const SESSION_GAP_MS = 30 * 60 * 1000;

export interface ResolvedConversation {
  id: number;
  zaloChatId: string;
  chatType: string;
  activeTripId: number | null;
  seenCount: number;
  /** true nếu đây là lần đầu tiên hệ thống thấy nhóm này */
  isNew: boolean;
  /** true nếu nhóm quay lại sau khoảng lặng dài → Lisa nên chào theo kiểu người quen */
  isReturning: boolean;
  memory: string;
}

@Injectable()
export class ConversationService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Tìm hoặc tạo hội thoại + nạp bộ nhớ dài hạn.
   * Đây là chỗ trả lời "đã từng tương tác với nhóm này chưa".
   */
  async resolve(msg: InboundMessage): Promise<ResolvedConversation> {
    const existing = await this.db.query.conversations.findFirst({
      where: eq(conversations.zaloChatId, msg.chatId)
    });

    if (!existing) {
      const [created] = await this.db
        .insert(conversations)
        .values({
          zaloChatId: msg.chatId,
          chatType: msg.chatType,
          seenCount: 1
        })
        .returning();
      await this.db.insert(groupMemory).values({ conversationId: created.id, content: "" });
      return {
        id: created.id,
        zaloChatId: created.zaloChatId,
        chatType: created.chatType,
        activeTripId: null,
        seenCount: 1,
        isNew: true,
        isReturning: false,
        memory: ""
      };
    }

    const gap = Date.now() - existing.lastSeenAt.getTime();
    const isReturning = gap > SESSION_GAP_MS;

    await this.db
      .update(conversations)
      .set({
        lastSeenAt: new Date(),
        ...(isReturning ? { seenCount: sql`${conversations.seenCount} + 1` } : {})
      })
      .where(eq(conversations.id, existing.id));

    const mem = await this.db.query.groupMemory.findFirst({
      where: eq(groupMemory.conversationId, existing.id)
    });

    return {
      id: existing.id,
      zaloChatId: existing.zaloChatId,
      chatType: existing.chatType,
      activeTripId: existing.activeTripId,
      seenCount: existing.seenCount + (isReturning ? 1 : 0),
      isNew: false,
      isReturning,
      memory: mem?.content ?? ""
    };
  }

  /**
   * Ghi tin của user. Trả false nếu message_id đã tồn tại (Zalo gửi trùng).
   * Đây là chốt chặn idempotency — Zalo retry khi webhook timeout.
   */
  async recordInbound(conversationId: number, msg: InboundMessage, imageUrl: string | null): Promise<boolean> {
    const res = await this.db
      .insert(messages)
      .values({
        conversationId,
        zaloMessageId: msg.zaloMessageId,
        role: "user",
        senderZaloId: msg.senderZaloId,
        senderName: msg.senderName,
        text: msg.text,
        imageUrl,
        rawEvent: msg.raw as object,
        createdAt: msg.sentAt
      })
      .onConflictDoNothing({ target: messages.zaloMessageId })
      .returning({ id: messages.id });
    return res.length > 0;
  }

  async recordOutbound(conversationId: number, text: string): Promise<void> {
    await this.db.insert(messages).values({
      conversationId,
      role: "assistant",
      senderName: "Lisa",
      text
    });
  }

  /** L1 — N lượt gần nhất, thứ tự cũ → mới. */
  async recentMessages(conversationId: number, limit = 14) {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    return rows.reverse();
  }

  async setActiveTrip(conversationId: number, tripId: number): Promise<void> {
    await this.db
      .update(conversations)
      .set({ activeTripId: tripId })
      .where(eq(conversations.id, conversationId));
  }

  async saveMemory(conversationId: number, content: string): Promise<void> {
    await this.db
      .insert(groupMemory)
      .values({ conversationId, content, version: 1 })
      .onConflictDoUpdate({
        target: groupMemory.conversationId,
        set: { content, version: sql`${groupMemory.version} + 1`, updatedAt: new Date() }
      });
  }

  /** Tin cuối cùng của hội thoại — dùng để biết phiên đã "nguội" chưa. */
  async lastMessageAt(conversationId: number): Promise<Date | null> {
    const [row] = await this.db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId)))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    return row?.createdAt ?? null;
  }
}

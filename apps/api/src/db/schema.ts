import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";

/* ============================================================================
 * TẦNG HỘI THOẠI — trả lời câu hỏi "đã từng gặp nhóm này chưa?"
 * ========================================================================== */

/** Một cuộc hội thoại Zalo (group hoặc 1-1). Đơn vị định danh của trí nhớ. */
export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    /** chat.id từ Zalo Bot API — khoá tự nhiên */
    zaloChatId: varchar("zalo_chat_id", { length: 64 }).notNull(),
    /** chat.chat_type — "direct" | "group" (⚠ Zalo dùng `chat_type`, không phải `type`) */
    chatType: varchar("chat_type", { length: 16 }).notNull().default("direct"),
    title: text("title"),
    /** Chuyến đi đang hoạt động của nhóm này */
    activeTripId: bigint("active_trip_id", { mode: "number" }),
    /** Số phiên đã gặp — >0 nghĩa là "người quen" */
    seenCount: integer("seen_count").notNull().default(0),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("conversations_chat_uq").on(t.zaloChatId)]
);

/** L1 — transcript thô. `zaloMessageId` unique là chốt chặn idempotency. */
export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: bigint("conversation_id", { mode: "number" })
      .notNull()
      .references(() => conversations.id),
    /** message_id của Zalo — NULL với tin do Lisa chủ động gửi */
    zaloMessageId: varchar("zalo_message_id", { length: 128 }),
    role: varchar("role", { length: 16 }).notNull(), // user | assistant | system
    senderZaloId: varchar("sender_zalo_id", { length: 64 }),
    senderName: text("sender_name"),
    text: text("text"),
    /** URL ảnh đã tải về host của mình (photo_url gốc có thể hết hạn) */
    imageUrl: text("image_url"),
    /** Payload gốc để truy vết khi debug */
    rawEvent: jsonb("raw_event"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("messages_conv_idx").on(t.conversationId, t.createdAt),
    uniqueIndex("messages_zalo_id_uq").on(t.zaloMessageId)
  ]
);

/** L3 — bộ nhớ ngữ nghĩa bền, xuyên chuyến đi. Đây là chỗ hệ thống "tiến hoá". */
export const groupMemory = pgTable(
  "group_memory",
  {
    id: serial("id").primaryKey(),
    conversationId: bigint("conversation_id", { mode: "number" })
      .notNull()
      .references(() => conversations.id),
    /** Markdown: sở thích, khẩu vị, ngân sách quen thuộc, dị ứng, thói quen đi lại */
    content: text("content").notNull().default(""),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("group_memory_conv_uq").on(t.conversationId)]
);

/* ============================================================================
 * TẦNG CHUYẾN ĐI (L2 — episodic) — sự thật có cấu trúc
 * ========================================================================== */

/** Chuyến đi — đơn vị dữ liệu trung tâm mà Lisa và mini app cùng thao tác. */
export const trips = pgTable(
  "trips",
  {
    id: serial("id").primaryKey(),
    /** Hội thoại Zalo sở hữu chuyến đi này */
    conversationId: bigint("conversation_id", { mode: "number" }),
    /** ID nhóm chat Zalo (giữ lại cho truy vấn nhanh / tương thích ngược) */
    zaloGroupId: varchar("zalo_group_id", { length: 64 }),
    name: text("name").notNull(),
    destination: text("destination").notNull(),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }).notNull(),
    /** planning | confirmed | ongoing | done */
    status: varchar("status", { length: 20 }).notNull().default("planning"),
    /** Ngân sách dự kiến mỗi người (VND) */
    budgetPerPerson: bigint("budget_per_person", { mode: "number" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("trips_conv_idx").on(t.conversationId)]
);

export const members = pgTable(
  "members",
  {
    id: serial("id").primaryKey(),
    tripId: bigint("trip_id", { mode: "number" })
      .notNull()
      .references(() => trips.id),
    zaloUserId: varchar("zalo_user_id", { length: 64 }).notNull(),
    displayName: text("display_name").notNull()
  },
  (t) => [
    index("members_trip_idx").on(t.tripId),
    uniqueIndex("members_trip_user_uq").on(t.tripId, t.zaloUserId)
  ]
);

/** Sự kiện lịch trình: chuyến bay, check-in khách sạn, ăn tối... */
export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    tripId: bigint("trip_id", { mode: "number" })
      .notNull()
      .references(() => trips.id),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    location: text("location"),
    /** flight | stay | food | activity | transport | other */
    kind: varchar("kind", { length: 24 }).notNull().default("activity"),
    note: text("note"),
    /** Chi phí ước tính (VND) — dùng để dựng ngân sách trước chuyến đi */
    estimatedCost: bigint("estimated_cost", { mode: "number" }),
    createdBy: varchar("created_by", { length: 64 }).notNull().default("lisa"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("events_trip_idx").on(t.tripId, t.startsAt)]
);

/** Hoá đơn / chi phí Lisa ghi nhận từ hội thoại, ảnh hoá đơn, hoặc user tự nhập. */
export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),
    tripId: bigint("trip_id", { mode: "number" })
      .notNull()
      .references(() => trips.id),
    title: text("title").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(), // VND, số nguyên
    /** food | stay | transport | ticket | shopping | other */
    category: varchar("category", { length: 24 }).notNull().default("other"),
    /** Zalo user id của người trả */
    paidBy: text("paid_by").notNull(),
    paidByName: text("paid_by_name"),
    /** equal = chia đều cho splits; custom = dùng shareAmount trong expense_splits */
    splitMode: varchar("split_mode", { length: 16 }).notNull().default("equal"),
    /** Ảnh hoá đơn đã lưu trên host mình */
    receiptPhotoUrl: text("receipt_photo_url"),
    spentAt: timestamp("spent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("expenses_trip_idx").on(t.tripId)]
);

/** Ai chịu phần nào của một khoản chi. Không có dòng nào = chia đều toàn nhóm. */
export const expenseSplits = pgTable(
  "expense_splits",
  {
    id: serial("id").primaryKey(),
    expenseId: bigint("expense_id", { mode: "number" })
      .notNull()
      .references(() => expenses.id),
    memberZaloId: varchar("member_zalo_id", { length: 64 }).notNull(),
    memberName: text("member_name"),
    /** VND — phần người này phải chịu */
    shareAmount: bigint("share_amount", { mode: "number" }).notNull()
  },
  (t) => [index("expense_splits_expense_idx").on(t.expenseId)]
);

/** Nhật ký hành trình — ghi chú, cảm nhận, tip dọc đường. */
export const notes = pgTable(
  "notes",
  {
    id: serial("id").primaryKey(),
    tripId: bigint("trip_id", { mode: "number" })
      .notNull()
      .references(() => trips.id),
    authorZaloId: varchar("author_zalo_id", { length: 64 }),
    authorName: text("author_name"),
    content: text("content").notNull(),
    /** note | diary | tip | highlight */
    kind: varchar("kind", { length: 16 }).notNull().default("note"),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("notes_trip_idx").on(t.tripId, t.takenAt)]
);

/** Ảnh kỷ niệm — hiển thị gallery trên mini app + dựng trang tổng kết. */
export const photos = pgTable(
  "photos",
  {
    id: serial("id").primaryKey(),
    tripId: bigint("trip_id", { mode: "number" })
      .notNull()
      .references(() => trips.id),
    url: text("url").notNull(),
    caption: text("caption"),
    uploaderZaloId: varchar("uploader_zalo_id", { length: 64 }),
    uploaderName: text("uploader_name"),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("photos_trip_idx").on(t.tripId, t.takenAt)]
);

/** Nhật ký hoạt động của Lisa — timeline "Lisa đã làm gì" trên mini app. */
export const activities = pgTable(
  "activities",
  {
    id: serial("id").primaryKey(),
    tripId: bigint("trip_id", { mode: "number" })
      .notNull()
      .references(() => trips.id),
    /** suggestion | booking | reminder | note | expense | plan | recap */
    kind: varchar("kind", { length: 32 }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("activities_trip_idx").on(t.tripId)]
);

/* ============================================================================
 * TẦNG VẬN HÀNH — hàng đợi, nhắc lịch, đối tác OA
 * ========================================================================== */

/**
 * Hàng đợi job chạy trên Postgres — không cần Redis.
 * Worker lấy việc bằng `FOR UPDATE SKIP LOCKED`.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    /** agent_turn | reflection | deep_plan | recap | reminder */
    kind: varchar("kind", { length: 32 }).notNull(),
    /** Khoá serialize: mọi job cùng dedupeKey chạy tuần tự (thường là zaloChatId) */
    dedupeKey: varchar("dedupe_key", { length: 128 }),
    payload: jsonb("payload").notNull(),
    /** pending | running | done | failed */
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    lockedBy: varchar("locked_by", { length: 64 }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("jobs_poll_idx").on(t.status, t.runAt)]
);

/** Nhắc lịch chủ động — Bot API không có cửa sổ 48h nên push được. */
export const reminders = pgTable(
  "reminders",
  {
    id: serial("id").primaryKey(),
    conversationId: bigint("conversation_id", { mode: "number" })
      .notNull()
      .references(() => conversations.id),
    tripId: bigint("trip_id", { mode: "number" }),
    fireAt: timestamp("fire_at", { withTimezone: true }).notNull(),
    message: text("message").notNull(),
    sent: boolean("sent").notNull().default(false),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("reminders_due_idx").on(t.sent, t.fireAt)]
);

/**
 * Danh bạ OA đối tác do team tự seed.
 * ⚠ Zalo KHÔNG có API tìm kiếm OA — đây là cách hợp lệ duy nhất để "discovery".
 */
export const partnerOas = pgTable(
  "partner_oas",
  {
    id: serial("id").primaryKey(),
    oaId: varchar("oa_id", { length: 64 }).notNull(),
    name: text("name").notNull(),
    /** HOTEL | TOUR | FNB | TRANSPORT | ACTIVITY */
    category: varchar("category", { length: 24 }).notNull(),
    city: text("city").notNull(),
    description: text("description"),
    /** Mô tả giá dạng người đọc, vd "1.2tr–2.5tr/đêm" */
    priceHint: text("price_hint"),
    lat: text("lat"),
    lng: text("lng"),
    avatarUrl: text("avatar_url"),
    /** https://zalo.me/<oaId> */
    deeplink: text("deeplink"),
    tags: text("tags"), // csv: "gần biển,có hồ bơi,cho trẻ em"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("partner_oas_oa_uq").on(t.oaId),
    index("partner_oas_search_idx").on(t.city, t.category)
  ]
);

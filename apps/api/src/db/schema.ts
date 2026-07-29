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
    /** message_id của Zalo — NULL với tin do Zino chủ động gửi */
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

/** Chuyến đi — đơn vị dữ liệu trung tâm mà Zino và mini app cùng thao tác. */
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
    displayName: text("display_name").notNull(),
    /** member | organizer — người gọi @Zino tạo chuyến là organizer */
    role: varchar("role", { length: 16 }).notNull().default("member")
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
    /** pending (Zino đang làm) | done | failed. Lỗi PHẢI hiện, không được ẩn */
    status: varchar("status", { length: 16 }).notNull().default("done"),
    failReason: text("fail_reason"),
    /** zino | user */
    source: varchar("source", { length: 16 }).notNull().default("user"),
    bookingRef: varchar("booking_ref", { length: 64 }),
    partnerOaId: varchar("partner_oa_id", { length: 64 }),
    createdBy: varchar("created_by", { length: 64 }).notNull().default("zino"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("events_trip_idx").on(t.tripId, t.startsAt)]
);

/** Hoá đơn / chi phí Zino ghi nhận từ hội thoại, ảnh hoá đơn, hoặc user tự nhập. */
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
    /** user | zino — khoản của Zino kèm txnCode thì khoá số tiền và người trả */
    source: varchar("source", { length: 16 }).notNull().default("user"),
    txnCode: varchar("txn_code", { length: 64 }),
    note: text("note"),
    createdBy: varchar("created_by", { length: 64 }),
    updatedBy: varchar("updated_by", { length: 64 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
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

/** Nhật ký hoạt động của Zino — timeline "Zino đã làm gì" trên mini app. */
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

    /* ---- Uỷ quyền OAuth (Partner Network) -------------------------------
     * OA đã bấm "Cho phép" cho app của Zino → ta nhận được webhook tin nhắn
     * user gửi tới OA đó, và trả lời thay họ. Xem docs/PARTNER-NETWORK.md.
     */
    connected: boolean("connected").notNull().default(false),
    accessToken: text("access_token"),
    /** 3 tháng, DÙNG MỘT LẦN — mỗi lần refresh trả về token mới */
    refreshToken: text("refresh_token"),
    /** Access token sống 25 GIỜ (không phải 1 giờ) */
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    /** Cho phép agent tự trả lời lead thay merchant */
    autoReply: boolean("auto_reply").notNull().default(true),
    /** Dữ liệu merchant tự khai: bảng giá, loại phòng, chính sách huỷ.
     *  Merchant agent CHỈ trả lời trong phạm vi này — không có thì không bịa. */
    inventoryNote: text("inventory_note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("partner_oas_oa_uq").on(t.oaId),
    index("partner_oas_search_idx").on(t.city, t.category)
  ]
);

/**
 * Lưu `code_verifier` của PKCE giữa /oa/connect và /oa/callback.
 * TTL 10 phút — đúng bằng hiệu lực của authorization_code.
 */
export const oauthStates = pgTable("oauth_states", {
  state: varchar("state", { length: 64 }).primaryKey(),
  /** Chuỗi ĐÚNG 43 ký tự, khác nhau mỗi request */
  codeVerifier: varchar("code_verifier", { length: 128 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

/**
 * Một "lead": user hỏi OA đối tác, bắt nguồn từ hội thoại với Zino.
 * Dùng để nối tin trả lời của merchant ngược về đúng nhóm chat.
 */
export const oaLeads = pgTable(
  "oa_leads",
  {
    id: serial("id").primaryKey(),
    partnerOaId: bigint("partner_oa_id", { mode: "number" })
      .notNull()
      .references(() => partnerOas.id),
    /** UID của user, scope theo TỪNG OA — khác nhau giữa các OA */
    oaUserId: varchar("oa_user_id", { length: 64 }).notNull(),
    oaUserName: text("oa_user_name"),
    /** Hội thoại Zino đã giới thiệu OA này (nếu truy được) */
    conversationId: bigint("conversation_id", { mode: "number" }),
    tripId: bigint("trip_id", { mode: "number" }),
    lastUserMessage: text("last_user_message"),
    lastReply: text("last_reply"),
    /** new | replied | closed */
    status: varchar("status", { length: 16 }).notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("oa_leads_partner_idx").on(t.partnerOaId, t.createdAt),
    uniqueIndex("oa_leads_partner_user_uq").on(t.partnerOaId, t.oaUserId)
  ]
);

/* ============================================================================
 * PIPELINE LÊN KẾ HOẠCH — 4 agent chạy tuần tự A → B → C → [chờ owner] → D
 *
 * Vì sao cần bảng riêng thay vì biến trong bộ nhớ: pipeline có HAI điểm dừng
 * đồng bộ với con người (A hỏi lại; C xong chờ owner chọn). Một run có thể
 * sống hàng giờ, qua nhiều tin nhắn, qua cả lần restart container.
 * ========================================================================== */

/**
 * Trạng thái của run — cũng chính là bộ định tuyến của webhook.
 *
 *   running_a/b/c/d   đang gọi agent, tin nhắn tới đi về AgentService như thường
 *   awaiting_user     A đã hỏi, đang chờ ai đó trong nhóm trả lời
 *   awaiting_selection C đã ra phương án, chờ ĐÚNG owner chọn
 *   done | blocked | failed | expired | cancelled   kết thúc, không chặn run mới
 */
export const pipelineRuns = pgTable(
  "pipeline_runs",
  {
    id: serial("id").primaryKey(),
    conversationId: bigint("conversation_id", { mode: "number" })
      .notNull()
      .references(() => conversations.id),
    zaloChatId: varchar("zalo_chat_id", { length: 64 }).notNull(),

    /** Người gọi start_trip_planning. Chỉ người này được chọn variant. */
    ownerZaloId: varchar("owner_zalo_id", { length: 64 }).notNull(),
    ownerName: text("owner_name"),

    /** A | B | C | D — stage vừa chạy hoặc đang chạy */
    stage: varchar("stage", { length: 1 }),
    status: varchar("status", { length: 24 }).notNull().default("running_a"),

    /**
     * Sợi chỉ xuyên suốt 4 lượt LLM. Khi C ra phương án lạ, đây là cách lần
     * ngược về đúng A và B đã sinh ra nó.
     */
    traceId: varchar("trace_id", { length: 36 }).notNull(),

    /** { "A": "sess_...", "B": "sess_..." } — session Managed Agents theo stage */
    agentSessions: jsonb("agent_sessions").notNull().default({}),

    /** Nguyên output từng stage, không bóc field (theo contract backend.md) */
    alignmentResult: jsonb("alignment_result"),
    sourcingResult: jsonb("sourcing_result"),
    planningResult: jsonb("planning_result"),
    packageResult: jsonb("package_result"),

    /**
     * Vá lỗ hổng vòng B → A: câu hỏi do B đặt ra nhưng user trả lời cho A.
     * Không có field này thì A nhận câu trả lời mà không biết câu hỏi là gì.
     */
    pendingQuestion: jsonb("pending_question"),

    /**
     * v7 — "thin state": CHỈ giữ thứ cần để hiểu tin nhắn KẾ TIẾP.
     *
     * Agent trả `state_patch` từng phần, backend deep-merge vào đây (v7 §3.4).
     * Không chứa transcript, không chain-of-thought, không PII (§5).
     */
    thinState: jsonb("thin_state").notNull().default({}),

    /**
     * v7 — hợp đồng trả lời do Finalizer sinh ra. Đây là thứ giúp Intake hiểu
     * "chọn 2" ở lượt sau ứng với option nào, thay vì đoán theo thứ tự transcript.
     */
    replyContract: jsonb("reply_contract"),

    /** needs_source_data chỉ được retry B đúng 1 lần (theo backend.md) */
    scoutRetries: integer("scout_retries").notNull().default(0),

    selectedCandidateId: varchar("selected_candidate_id", { length: 64 }),

    /** Run bị bỏ quên → worker dọn, để nhóm mở được run mới */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("pipeline_runs_conv_idx").on(t.conversationId, t.status)]
);

/* ==========================================================================
 * Danh tính Mini App ↔ thành viên nhóm.
 *
 * Bot API và Mini App nhìn cùng một con người dưới hai id khác namespace, và
 * Zalo không có API nối. Ba bảng dưới đây là cây cầu: app_users (ai đang mở
 * app) → link_codes (mã 6 số dùng một lần) → person_links (kết quả nối).
 * ========================================================================== */

/** Người dùng nhìn từ phía Mini App. id do SERVER lấy từ graph.zalo.me, không tin client. */
export const appUsers = pgTable(
  "app_users",
  {
    id: serial("id").primaryKey(),
    zaloAppUserId: varchar("zalo_app_user_id", { length: 64 }).notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("app_users_zalo_uq").on(t.zaloAppUserId)]
);

/** Mã ghép đôi. Gõ công khai trong nhóm nên hạn ngắn và chỉ dùng được một lần. */
export const linkCodes = pgTable(
  "link_codes",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 8 }).notNull(),
    appUserId: bigint("app_user_id", { mode: "number" })
      .notNull()
      .references(() => appUsers.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("link_codes_user_idx").on(t.appUserId, t.createdAt)]
);

/** Kết quả nối. Unique hai chiều để hai người không cùng nhận là một thành viên. */
export const personLinks = pgTable(
  "person_links",
  {
    id: serial("id").primaryKey(),
    appUserId: bigint("app_user_id", { mode: "number" })
      .notNull()
      .references(() => appUsers.id),
    /** `from.id` phía Bot API — khớp với members.zaloUserId */
    zaloBotUserId: varchar("zalo_bot_user_id", { length: 64 }).notNull(),
    displayName: text("display_name"),
    /** code | context | manual — để sau này thêm đường tắt getContextAsync */
    linkedVia: varchar("linked_via", { length: 16 }).notNull().default("code"),
    conversationId: bigint("conversation_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("person_links_app_uq").on(t.appUserId),
    uniqueIndex("person_links_bot_uq").on(t.zaloBotUserId)
  ]
);

/* ==========================================================================
 * J2 — Quyết định nhóm. Bàn ở chat, chốt ở app.
 *
 * Thứ đáng giá nhất ở đây không phải kết quả mà là NGỮ CẢNH quanh kết quả:
 * ai bầu gì, ai chưa bầu, Zino nghiêng cái nào và vì sao, ai chốt, có ngược
 * đa số không. Chat không giữ được mấy thứ đó — cuộn lên là mất.
 * ========================================================================== */

export const decisions = pgTable(
  "decisions",
  {
    id: serial("id").primaryKey(),
    tripId: bigint("trip_id", { mode: "number" })
      .notNull()
      .references(() => trips.id),
    conversationId: bigint("conversation_id", { mode: "number" }),
    /** stay | food | transport | activity | other */
    kind: varchar("kind", { length: 24 }).notNull().default("other"),
    title: text("title").notNull(),
    /** open | tie | decided | cancelled */
    status: varchar("status", { length: 16 }).notNull().default("open"),
    recommendedOptionId: bigint("recommended_option_id", { mode: "number" }),
    recommendationReason: text("recommendation_reason"),
    decidedOptionId: bigint("decided_option_id", { mode: "number" }),
    decidedBy: varchar("decided_by", { length: 64 }),
    decidedByName: text("decided_by_name"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    againstMajority: boolean("against_majority").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("decisions_trip_idx").on(t.tripId, t.status)]
);

export const decisionOptions = pgTable(
  "decision_options",
  {
    id: serial("id").primaryKey(),
    decisionId: bigint("decision_id", { mode: "number" })
      .notNull()
      .references(() => decisions.id),
    label: text("label").notNull(),
    detail: text("detail"),
    price: bigint("price", { mode: "number" }),
    partnerOaId: varchar("partner_oa_id", { length: 64 }),
    /** Ảnh minh hoạ. Rỗng = thẻ tự dựng tile chữ, KHÔNG dán ảnh stock giả. */
    imageUrl: text("image_url"),
    /** Link đặt/xem thêm, thường là deeplink OA đối tác */
    bookingUrl: text("booking_url"),
    sortOrder: integer("sort_order").notNull().default(0)
  },
  (t) => [index("decision_options_dec_idx").on(t.decisionId, t.sortOrder)]
);

export const decisionVotes = pgTable(
  "decision_votes",
  {
    id: serial("id").primaryKey(),
    decisionId: bigint("decision_id", { mode: "number" })
      .notNull()
      .references(() => decisions.id),
    optionId: bigint("option_id", { mode: "number" })
      .notNull()
      .references(() => decisionOptions.id),
    zaloUserId: varchar("zalo_user_id", { length: 64 }).notNull(),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("decision_votes_one_per_person_uq").on(t.decisionId, t.zaloUserId)]
);

/**
 * J4 — tick "đã trả" của một cặp chuyển tiền.
 *
 * Settlement được TÍNH LẠI mỗi lần mở từ expenses, nhưng "Linh đã chuyển tiền
 * cho Đông" là sự kiện ngoài đời, không phép tính nào suy ra được. Nên nó phải
 * có bảng riêng, nếu không tick xong mở lại là mất.
 */
export const settlementPayments = pgTable(
  "settlement_payments",
  {
    id: serial("id").primaryKey(),
    tripId: bigint("trip_id", { mode: "number" })
      .notNull()
      .references(() => trips.id),
    fromUserId: varchar("from_user_id", { length: 64 }).notNull(),
    toUserId: varchar("to_user_id", { length: 64 }).notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    tickedBy: varchar("ticked_by", { length: 64 }),
    tickedAt: timestamp("ticked_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("settlement_payments_pair_uq").on(t.tripId, t.fromUserId, t.toUserId)]
);

/**
 * Hành động Zino thực thi từ tab chat Mini App, sau khi người dùng bấm xác nhận.
 *
 * `token` do client sinh một lần cho mỗi thẻ. Mạng chập / bấm lại / webview gửi
 * lại đều rơi vào cùng một token, nên một ý định chỉ ra đúng một bản ghi.
 */
export const chatActions = pgTable(
  "chat_actions",
  {
    token: varchar("token", { length: 64 }).primaryKey(),
    tripId: bigint("trip_id", { mode: "number" })
      .notNull()
      .references(() => trips.id),
    /** expense | note | event */
    kind: varchar("kind", { length: 24 }).notNull(),
    actor: varchar("actor", { length: 64 }).notNull(),
    payload: jsonb("payload").notNull(),
    /** id bản ghi đã tạo, để tra ngược */
    resultId: bigint("result_id", { mode: "number" }),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("chat_actions_trip_idx").on(t.tripId, t.createdAt)]
);

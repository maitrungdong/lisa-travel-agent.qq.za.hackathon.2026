import { bigint, index, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

/** Chuyến đi — đơn vị dữ liệu trung tâm mà Lisa và mini app cùng thao tác. */
export const trips = pgTable("trips", {
  id: serial("id").primaryKey(),
  /** ID nhóm chat Zalo mà Lisa được add vào */
  zaloGroupId: varchar("zalo_group_id", { length: 64 }),
  name: text("name").notNull(),
  destination: text("destination").notNull(),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("planning"), // planning | confirmed | done
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const members = pgTable(
  "members",
  {
    id: serial("id").primaryKey(),
    tripId: bigint("trip_id", { mode: "number" }).notNull().references(() => trips.id),
    zaloUserId: varchar("zalo_user_id", { length: 64 }).notNull(),
    displayName: text("display_name").notNull()
  },
  (t) => [index("members_trip_idx").on(t.tripId)]
);

/** Sự kiện lịch trình: chuyến bay, check-in khách sạn, ăn tối... */
export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    tripId: bigint("trip_id", { mode: "number" }).notNull().references(() => trips.id),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    location: text("location"),
    createdBy: varchar("created_by", { length: 64 }).notNull().default("lisa"), // "lisa" | zalo user id
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("events_trip_idx").on(t.tripId)]
);

/** Hoá đơn / chi phí Lisa ghi nhận từ hội thoại hoặc user tự nhập. */
export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),
    tripId: bigint("trip_id", { mode: "number" }).notNull().references(() => trips.id),
    title: text("title").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(), // VND, số nguyên
    paidBy: text("paid_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("expenses_trip_idx").on(t.tripId)]
);

/** Nhật ký hoạt động của Lisa — hiển thị timeline "Lisa đã làm gì" trên mini app. */
export const activities = pgTable(
  "activities",
  {
    id: serial("id").primaryKey(),
    tripId: bigint("trip_id", { mode: "number" }).notNull().references(() => trips.id),
    kind: varchar("kind", { length: 32 }).notNull(), // suggestion | booking | reminder | note
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("activities_trip_idx").on(t.tripId)]
);

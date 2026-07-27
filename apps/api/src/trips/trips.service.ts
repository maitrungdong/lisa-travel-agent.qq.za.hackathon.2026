import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { DB, type Database } from "../db/database.module";
import { settleExpenses } from "../money/settle";
import {
  activities,
  events,
  expenseSplits,
  expenses,
  members,
  notes,
  partnerOas,
  photos,
  trips
} from "../db/schema";
import type { CreateActivity, CreateEvent, CreateExpense, CreateTrip } from "./trips.dto";

@Injectable()
export class TripsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  listTrips() {
    return this.db.select().from(trips).orderBy(desc(trips.createdAt));
  }

  async getTrip(id: number) {
    const [trip] = await this.db.select().from(trips).where(eq(trips.id, id));
    if (!trip) throw new NotFoundException(`Trip ${id} không tồn tại`);
    return trip;
  }

  async createTrip(input: CreateTrip) {
    const [row] = await this.db.insert(trips).values(input).returning();
    return row;
  }

  listEvents(tripId: number) {
    return this.db.select().from(events).where(eq(events.tripId, tripId)).orderBy(asc(events.startsAt));
  }

  async createEvent(tripId: number, input: CreateEvent) {
    await this.getTrip(tripId);
    const [row] = await this.db.insert(events).values({ ...input, tripId }).returning();
    return row;
  }

  listExpenses(tripId: number) {
    return this.db.select().from(expenses).where(eq(expenses.tripId, tripId)).orderBy(desc(expenses.createdAt));
  }

  async createExpense(tripId: number, input: CreateExpense) {
    await this.getTrip(tripId);
    const [row] = await this.db.insert(expenses).values({ ...input, tripId }).returning();
    return row;
  }

  listActivities(tripId: number) {
    return this.db.select().from(activities).where(eq(activities.tripId, tripId)).orderBy(desc(activities.createdAt));
  }

  async createActivity(tripId: number, input: CreateActivity) {
    await this.getTrip(tripId);
    const [row] = await this.db.insert(activities).values({ ...input, tripId }).returning();
    return row;
  }

  /* ===================== BFF cho Mini App ===================== */

  listPhotos(tripId: number) {
    return this.db
      .select()
      .from(photos)
      .where(eq(photos.tripId, tripId))
      .orderBy(desc(photos.takenAt));
  }

  listNotes(tripId: number) {
    return this.db
      .select()
      .from(notes)
      .where(eq(notes.tripId, tripId))
      .orderBy(desc(notes.takenAt));
  }

  listMembers(tripId: number) {
    return this.db.select().from(members).where(eq(members.tripId, tripId));
  }

  /**
   * Chia tiền cho Mini App — dùng CHUNG hàm settleExpenses với tool của agent.
   * Một nguồn sự thật duy nhất: nếu Lisa nói trong chat khác với màn hình Mini App
   * thì mất hết uy tín, mà đó là lỗi rất dễ mắc nếu viết hai bản tính toán.
   */
  async settle(tripId: number) {
    const [rows, mem] = await Promise.all([
      this.db.select().from(expenses).where(eq(expenses.tripId, tripId)),
      this.db.select().from(members).where(eq(members.tripId, tripId))
    ]);

    if (mem.length === 0) {
      return { totalSpent: 0, perMember: [], settlements: [], roundingAdjustment: 0, warnings: ["Chuyến đi chưa có thành viên"] };
    }

    const splits = rows.length
      ? await this.db
          .select()
          .from(expenseSplits)
          .where(inArray(expenseSplits.expenseId, rows.map((r) => r.id)))
      : [];

    return settleExpenses(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        amount: Number(r.amount),
        paidBy: r.paidBy,
        paidByName: r.paidByName ?? undefined,
        splits: splits
          .filter((s) => s.expenseId === r.id)
          .map((s) => ({
            memberZaloId: s.memberZaloId,
            memberName: s.memberName ?? undefined,
            shareAmount: Number(s.shareAmount)
          }))
      })),
      mem.map((m) => ({ zaloUserId: m.zaloUserId, displayName: m.displayName }))
    );
  }

  /** Danh bạ OA đối tác — Zalo không có API search OA nên đây là directory tự dựng. */
  listPartners(opts: { city?: string; category?: string; limit?: number }) {
    const filters = [];
    if (opts.city) filters.push(ilike(partnerOas.city, `%${opts.city}%`));
    if (opts.category) filters.push(eq(partnerOas.category, opts.category));

    return this.db
      .select()
      .from(partnerOas)
      .where(filters.length ? and(...filters) : sql`true`)
      .limit(Math.min(opts.limit ?? 20, 50));
  }

  /** Toàn bộ dữ liệu 1 chuyến đi trong MỘT request — Mini App khỏi gọi 5 lần. */
  async fullTrip(tripId: number) {
    const trip = await this.getTrip(tripId);
    const [ev, ex, ph, nt, mb, ac, st] = await Promise.all([
      this.listEvents(tripId),
      this.listExpenses(tripId),
      this.listPhotos(tripId),
      this.listNotes(tripId),
      this.listMembers(tripId),
      this.listActivities(tripId),
      this.settle(tripId)
    ]);
    return { trip, events: ev, expenses: ex, photos: ph, notes: nt, members: mb, activities: ac, settlement: st };
  }
}

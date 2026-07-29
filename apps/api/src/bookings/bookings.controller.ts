import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post
} from "@nestjs/common";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { DB, type Database } from "../db/database.module";
import { bookings, events, members } from "../db/schema";
import {
  BOOKING_STATUSES,
  bookingsFromEvents,
  canTransition,
  summarize,
  transitionError,
  type BookingStatus
} from "./booking-rules";

const actorSchema = z.object({
  actorZaloId: z.string().min(1),
  actorName: z.string().optional()
});

const statusSchema = actorSchema.extend({
  status: z.enum(BOOKING_STATUSES)
});

const patchSchema = actorSchema.extend({
  refCode: z.string().max(64).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  amount: z.number().int().nonnegative().nullable().optional(),
  holderZaloId: z.string().nullable().optional()
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues);
  return r.data;
}

/**
 * Quản lý đặt chỗ — phòng, vé xe, vé tham quan.
 *
 * Zino KHÔNG tự thanh toán được, và đó là chuyện đã biết trước chứ không phải
 * thiếu sót tạm thời: không có tích hợp cổng thanh toán nào trong hệ thống này.
 * Nên vai trò của màn này là làm sổ theo dõi trung thực — người đặt xong thì
 * bấm một nút, cả nhóm nhìn thấy. Thà một cái nút thật còn hơn một hoạt ảnh
 * "đang đặt phòng…" không dẫn tới đâu.
 *
 * `actorZaloId` do client gửi vì đăng nhập Zalo đang tắt. Server không coi đó
 * là bằng chứng danh tính nhưng vẫn bắt buộc phải là thành viên của chuyến.
 */
@Controller()
export class BookingsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private async actorOf(tripId: number, zaloUserId: string) {
    const [m] = await this.db
      .select({ zaloUserId: members.zaloUserId, displayName: members.displayName })
      .from(members)
      .where(and(eq(members.tripId, tripId), eq(members.zaloUserId, zaloUserId)));
    if (!m) throw new ForbiddenException("Bạn không thuộc chuyến đi này");
    return m;
  }

  /**
   * Danh sách đặt chỗ, TỰ ĐỒNG BỘ từ lịch trình trước khi trả về.
   *
   * Đồng bộ ở đây chứ không bắt người dùng bấm "làm mới": mục lịch trình mới do
   * Zino thêm từ chat nhóm phải tự xuất hiện, nếu không thì màn này luôn thiếu
   * và người ta mất niềm tin vào con số "còn N việc cần làm".
   */
  @Get("trips/:id/bookings")
  async list(@Param("id", ParseIntPipe) tripId: number) {
    await this.sync(tripId);
    const rows = await this.db
      .select()
      .from(bookings)
      .where(eq(bookings.tripId, tripId))
      .orderBy(asc(bookings.id));

    return {
      bookings: rows.map((r) => ({ ...r, amount: r.amount == null ? null : Number(r.amount) })),
      summary: summarize(rows.map((r) => r.status as BookingStatus))
    };
  }

  /** Sinh đặt chỗ cho các mục lịch trình cần đặt trước. Chạy lại bao nhiêu lần cũng được. */
  private async sync(tripId: number): Promise<void> {
    const [evs, existing] = await Promise.all([
      this.db.select().from(events).where(eq(events.tripId, tripId)).orderBy(asc(events.startsAt)),
      this.db
        .select({ eventId: bookings.eventId })
        .from(bookings)
        .where(eq(bookings.tripId, tripId))
    ]);

    const drafts = bookingsFromEvents(
      evs.map((e) => ({
        id: e.id,
        title: e.title,
        kind: e.kind,
        startsAt: e.startsAt.toISOString(),
        estimatedCost: e.estimatedCost == null ? null : Number(e.estimatedCost),
        location: e.location,
        partnerOaId: e.partnerOaId
      })),
      existing.map((x) => x.eventId).filter((x): x is number => x != null)
    );
    if (drafts.length === 0) return;

    // `onConflictDoNothing` là lớp thứ hai: hai request mở màn cùng lúc thì
    // `bookingsFromEvents` của cả hai đều thấy "chưa có", chỉ khoá duy nhất
    // trên event_id mới chặn được.
    await this.db
      .insert(bookings)
      .values(drafts.map((d) => ({ ...d, tripId, source: "zino" as const })))
      .onConflictDoNothing();
  }

  @Post("trips/:id/bookings/sync")
  async resync(@Param("id", ParseIntPipe) tripId: number) {
    await this.sync(tripId);
    return this.list(tripId);
  }

  @Patch("bookings/:id/status")
  async setStatus(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const input = parse(statusSchema, body);
    const [row] = await this.db.select().from(bookings).where(eq(bookings.id, id));
    if (!row) throw new NotFoundException("Không có mục đặt chỗ này");

    const actor = await this.actorOf(row.tripId, input.actorZaloId);
    const from = row.status as BookingStatus;
    if (!canTransition(from, input.status)) {
      throw new BadRequestException(transitionError(from, input.status));
    }

    // Ai đánh dấu "đã đặt" thì mặc định là người đang giữ chỗ — hỏi thêm một
    // câu nữa ở bước này chỉ làm chậm, mà đổi lại được ở màn chi tiết.
    const [updated] = await this.db
      .update(bookings)
      .set({
        status: input.status,
        updatedBy: actor.zaloUserId,
        updatedAt: new Date(),
        ...(input.status === "booked" && !row.holderZaloId
          ? { holderZaloId: actor.zaloUserId, holderName: actor.displayName }
          : {})
      })
      .where(and(eq(bookings.id, id), eq(bookings.status, from)))
      .returning();

    // Thua cuộc đua = người khác vừa đổi trạng thái. Trả về bản mới nhất thay
    // vì báo lỗi: kết quả cuối vẫn đúng, chỉ là không phải do mình bấm.
    if (!updated) {
      const [fresh] = await this.db.select().from(bookings).where(eq(bookings.id, id));
      return { booking: fresh, changed: false };
    }
    return { booking: updated, changed: true };
  }

  @Patch("bookings/:id")
  async patch(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const input = parse(patchSchema, body);
    const [row] = await this.db.select().from(bookings).where(eq(bookings.id, id));
    if (!row) throw new NotFoundException("Không có mục đặt chỗ này");
    const actor = await this.actorOf(row.tripId, input.actorZaloId);

    if (input.holderZaloId) await this.actorOf(row.tripId, input.holderZaloId);
    const holder = input.holderZaloId
      ? (await this.db
          .select({ n: members.displayName })
          .from(members)
          .where(and(eq(members.tripId, row.tripId), eq(members.zaloUserId, input.holderZaloId))))[0]
      : null;

    const [updated] = await this.db
      .update(bookings)
      .set({
        ...(input.refCode !== undefined ? { refCode: input.refCode } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.amount !== undefined ? { amount: input.amount } : {}),
        ...(input.holderZaloId
          ? { holderZaloId: input.holderZaloId, holderName: holder?.n ?? null }
          : {}),
        updatedBy: actor.zaloUserId,
        updatedAt: new Date()
      })
      .where(eq(bookings.id, id))
      .returning();
    return { booking: updated };
  }

  /** Dùng cho thẻ tóm tắt ở Trang chủ — khỏi tải cả danh sách. */
  @Get("trips/:id/bookings/summary")
  async summaryOf(@Param("id", ParseIntPipe) tripId: number) {
    const rows = await this.db
      .select({ status: bookings.status })
      .from(bookings)
      .where(and(eq(bookings.tripId, tripId), inArray(bookings.status, [...BOOKING_STATUSES])));
    return summarize(rows.map((r) => r.status as BookingStatus));
  }
}

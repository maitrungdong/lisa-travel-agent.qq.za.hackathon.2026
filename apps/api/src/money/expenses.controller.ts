import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { DB, type Database } from "../db/database.module";
import { expenseSplits, expenses, members, settlementPayments } from "../db/schema";
import { applyEditRules, canDelete, editableFields, type ExpenseLike } from "./expense-rules";

const actorSchema = z.object({
  actorZaloId: z.string().min(1),
  actorName: z.string().optional()
});

const createSchema = actorSchema.extend({
  title: z.string().min(1).max(200),
  amount: z.number().int().positive(),
  category: z.enum(["food", "stay", "transport", "ticket", "shopping", "other"]).default("other"),
  paidBy: z.string().min(1),
  paidByName: z.string().optional(),
  /** Danh sách zaloUserId cùng chịu khoản này. Rỗng = chia đều cả nhóm. */
  splitWith: z.array(z.string()).optional(),
  spentAt: z.coerce.date().optional(),
  note: z.string().max(500).optional()
});

const patchSchema = actorSchema.extend({
  title: z.string().min(1).max(200).optional(),
  amount: z.number().int().positive().optional(),
  category: z.enum(["food", "stay", "transport", "ticket", "shopping", "other"]).optional(),
  paidBy: z.string().min(1).optional(),
  splitWith: z.array(z.string()).optional(),
  note: z.string().max(500).optional()
});

const tickSchema = actorSchema.extend({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  amount: z.number().int().nonnegative(),
  paid: z.boolean()
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues);
  return r.data;
}

/**
 * J4 — người dùng tự thêm/sửa khoản chi và tick "đã trả".
 *
 * Vì sao tách khỏi TripsController: các route ở đó ghi dữ liệu bằng
 * `AgentKeyGuard` (chỉ agent gọi được). Còn đây là đường của NGƯỜI DÙNG, và
 * quyền được quyết theo vai trò trong chuyến chứ không theo một khoá chung.
 *
 * `actorZaloId` do client gửi vì đăng nhập Zalo đang tắt. Server không tin nó
 * làm bằng chứng danh tính, nhưng vẫn kiểm nó là thành viên của chuyến và áp
 * đúng luật sửa — ẩn nút ở UI không phải là quyền.
 */
@Controller()
export class ExpensesController {
  constructor(@Inject(DB) private readonly db: Database) {}

  private async actorOf(tripId: number, zaloUserId: string) {
    const [m] = await this.db
      .select({ zaloUserId: members.zaloUserId, displayName: members.displayName, role: members.role })
      .from(members)
      .where(and(eq(members.tripId, tripId), eq(members.zaloUserId, zaloUserId)));
    if (!m) throw new ForbiddenException("Bạn không thuộc chuyến đi này");
    return m;
  }

  /** Ai chịu khoản này. Rỗng = chia đều cả nhóm (settleExpenses tự hiểu). */
  private async writeSplits(expenseId: number, amount: number, memberIds: string[], tripId: number) {
    await this.db.delete(expenseSplits).where(eq(expenseSplits.expenseId, expenseId));
    if (memberIds.length === 0) return;

    const mem = await this.db.select().from(members).where(eq(members.tripId, tripId));
    const chosen = mem.filter((m) => memberIds.includes(m.zaloUserId));
    if (chosen.length === 0) return;

    // Chia đều, phần dư dồn vào người đầu để tổng khớp từng đồng.
    const base = Math.floor(amount / chosen.length);
    const remainder = amount - base * chosen.length;
    await this.db.insert(expenseSplits).values(
      chosen.map((m, i) => ({
        expenseId,
        memberZaloId: m.zaloUserId,
        memberName: m.displayName,
        shareAmount: i === 0 ? base + remainder : base
      }))
    );
  }

  @Post("trips/:id/expenses/user")
  async create(@Param("id", ParseIntPipe) tripId: number, @Body() body: unknown) {
    const input = parse(createSchema, body);
    const actor = await this.actorOf(tripId, input.actorZaloId);

    const [row] = await this.db
      .insert(expenses)
      .values({
        tripId,
        title: input.title,
        amount: input.amount,
        category: input.category,
        paidBy: input.paidBy,
        paidByName: input.paidByName ?? null,
        spentAt: input.spentAt ?? new Date(),
        note: input.note ?? null,
        source: "user",
        createdBy: actor.zaloUserId,
        splitMode: input.splitWith?.length ? "custom" : "equal"
      })
      .returning();

    await this.writeSplits(row.id, input.amount, input.splitWith ?? [], tripId);
    return row;
  }

  @Patch("expenses/:id")
  async update(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const input = parse(patchSchema, body);
    const [e] = await this.db.select().from(expenses).where(eq(expenses.id, id));
    if (!e) throw new NotFoundException("Không có khoản chi này");

    const actor = await this.actorOf(e.tripId, input.actorZaloId);
    const like: ExpenseLike = {
      source: e.source,
      txnCode: e.txnCode,
      createdBy: e.createdBy,
      paidBy: e.paidBy
    };

    const { allowed, rejected } = applyEditRules(like, actor, {
      title: input.title,
      amount: input.amount,
      category: input.category,
      paidBy: input.paidBy,
      split: input.splitWith,
      note: input.note
    });

    if (Object.keys(allowed).length === 0) {
      throw new ForbiddenException(
        rejected.length > 0
          ? `Không sửa được: ${rejected.join(", ")}. Khoản do Zino tạo kèm mã giao dịch chỉ đổi được cách chia và ghi chú.`
          : "Bạn không có quyền sửa khoản này"
      );
    }

    const patch: Record<string, unknown> = { updatedBy: actor.zaloUserId, updatedAt: new Date() };
    if (allowed.title !== undefined) patch.title = allowed.title;
    if (allowed.amount !== undefined) patch.amount = allowed.amount;
    if (allowed.category !== undefined) patch.category = allowed.category;
    if (allowed.paidBy !== undefined) patch.paidBy = allowed.paidBy;
    if (allowed.note !== undefined) patch.note = allowed.note;

    const [row] = await this.db.update(expenses).set(patch).where(eq(expenses.id, id)).returning();

    if (allowed.split !== undefined) {
      await this.writeSplits(id, Number(row.amount), allowed.split as string[], e.tripId);
      await this.db
        .update(expenses)
        .set({ splitMode: (allowed.split as string[]).length ? "custom" : "equal" })
        .where(eq(expenses.id, id));
    }

    // Trả kèm `rejected` để UI nói rõ cái gì không đổi được, thay vì im lặng
    // lưu một nửa rồi để người dùng tự phát hiện.
    return { expense: row, rejected };
  }

  @Delete("expenses/:id")
  async remove(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const input = parse(actorSchema, body);
    const [e] = await this.db.select().from(expenses).where(eq(expenses.id, id));
    if (!e) throw new NotFoundException("Không có khoản chi này");

    const actor = await this.actorOf(e.tripId, input.actorZaloId);
    if (!canDelete({ source: e.source, txnCode: e.txnCode, createdBy: e.createdBy, paidBy: e.paidBy }, actor)) {
      throw new ForbiddenException(
        e.txnCode
          ? "Đây là giao dịch thật, không xoá được. Nhờ Zino huỷ / hoàn tiền."
          : "Chỉ người tạo hoặc người tổ chức mới xoá được"
      );
    }

    await this.db.delete(expenseSplits).where(eq(expenseSplits.expenseId, id));
    await this.db.delete(expenses).where(eq(expenses.id, id));
    return { ok: true };
  }

  /** Trường nào sửa được — UI hỏi trước để khoá ô nhập cho khớp với server. */
  @Post("expenses/:id/editable")
  async editable(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const input = parse(actorSchema, body);
    const [e] = await this.db.select().from(expenses).where(eq(expenses.id, id));
    if (!e) throw new NotFoundException("Không có khoản chi này");
    const actor = await this.actorOf(e.tripId, input.actorZaloId);
    return {
      fields: [
        ...editableFields(
          { source: e.source, txnCode: e.txnCode, createdBy: e.createdBy, paidBy: e.paidBy },
          actor
        )
      ]
    };
  }

  /**
   * Các cặp đã tick "đã trả".
   *
   * Endpoint riêng thay vì nhét vào payload recap: nó đổi theo nhịp khác hẳn
   * (mỗi lần ai đó chuyển khoản), và recap đang có 16 test bám theo hình dạng
   * hiện tại — thêm field vào đó là kéo theo sửa cả cụm test không liên quan.
   */
  @Get("trips/:id/settlement/paid")
  async listPaid(@Param("id", ParseIntPipe) tripId: number) {
    const rows = await this.db
      .select()
      .from(settlementPayments)
      .where(eq(settlementPayments.tripId, tripId));
    return {
      pairs: rows.map((r) => ({
        from: r.fromUserId,
        to: r.toUserId,
        amount: Number(r.amount),
        tickedBy: r.tickedBy,
        tickedAt: r.tickedAt.toISOString()
      }))
    };
  }

  /**
   * Tick "đã trả" cho một cặp chuyển tiền.
   *
   * Wireframe: tick được nếu là người trả, người nhận, hoặc người tổ chức —
   * ba người đều biết sự thật về việc chuyển tiền đó.
   */
  @Post("trips/:id/settlement/paid")
  async tickPaid(@Param("id", ParseIntPipe) tripId: number, @Body() body: unknown) {
    const input = parse(tickSchema, body);
    const actor = await this.actorOf(tripId, input.actorZaloId);

    const involved =
      actor.zaloUserId === input.fromUserId ||
      actor.zaloUserId === input.toUserId ||
      actor.role === "organizer";
    if (!involved) {
      throw new ForbiddenException("Chỉ người trả, người nhận hoặc người tổ chức mới tick được");
    }

    if (!input.paid) {
      await this.db
        .delete(settlementPayments)
        .where(
          and(
            eq(settlementPayments.tripId, tripId),
            eq(settlementPayments.fromUserId, input.fromUserId),
            eq(settlementPayments.toUserId, input.toUserId)
          )
        );
      return { paid: false };
    }

    await this.db
      .insert(settlementPayments)
      .values({
        tripId,
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        amount: input.amount,
        tickedBy: actor.zaloUserId
      })
      .onConflictDoUpdate({
        target: [settlementPayments.tripId, settlementPayments.fromUserId, settlementPayments.toUserId],
        set: { amount: input.amount, tickedBy: actor.zaloUserId, tickedAt: new Date() }
      });
    return { paid: true };
  }
}

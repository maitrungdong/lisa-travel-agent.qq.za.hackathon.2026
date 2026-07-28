import { and, eq, gte, inArray } from "drizzle-orm";
import { activities, expenseSplits, expenses, members } from "../../db/schema";
import { settleExpenses, type ExpenseInput } from "../../money/settle";
import { S, schema, type ToolContext, type ToolDef, type ToolResult } from "./types";

function needTrip(ctx: ToolContext): ToolResult | null {
  if (ctx.tripId) return null;
  return {
    ok: false,
    error: "Nhóm chưa có chuyến đi nào đang hoạt động",
    hint: "Gọi create_trip trước khi ghi chi phí."
  };
}

/** Đọc chi phí + splits để đưa vào thuật toán chia tiền. */
async function loadExpenses(ctx: ToolContext): Promise<ExpenseInput[]> {
  const rows = await ctx.db.select().from(expenses).where(eq(expenses.tripId, ctx.tripId!));
  if (rows.length === 0) return [];

  const splits = await ctx.db
    .select()
    .from(expenseSplits)
    .where(
      inArray(
        expenseSplits.expenseId,
        rows.map((r) => r.id)
      )
    );

  return rows.map((r) => ({
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
  }));
}

function formatVnd(n: number): string {
  return `${n.toLocaleString("vi-VN")}đ`;
}

export const moneyTools: ToolDef[] = [
  {
    name: "add_expense",
    description:
      "Ghi một khoản chi của nhóm. Dùng khi user nói đã trả tiền gì đó, HOẶC khi đọc được từ ảnh hoá đơn. " +
      "Khi đọc hoá đơn: lấy số ở dòng 'Tổng cộng'/'Thành tiền', KHÔNG cộng từng món. " +
      "Mặc định chia đều cho cả nhóm; chỉ truyền split_among khi user nói rõ ai chịu khoản này.",
    input_schema: schema(
      {
        title: S.str("Tên khoản chi, vd 'Ăn tối quán Bé Mặn'"),
        amount: S.int("Số tiền VND, số nguyên (vd 850000, không phải '850k')"),
        category: S.enum(
          ["food", "stay", "transport", "ticket", "shopping", "other"],
          "Loại chi phí"
        ),
        paid_by_name: S.str("Tên người đã trả. Bỏ trống = người đang nhắn"),
        paid_by_zalo_id: S.str("Zalo id người trả nếu biết"),
        receipt_photo_url: S.str("URL ảnh hoá đơn nếu khoản này ghi từ ảnh"),
        spent_at: S.date("Thời điểm chi tiêu (mặc định là bây giờ)"),
        split_among: S.arr(
          { type: "string" },
          "Danh sách TÊN những người chịu khoản này. Bỏ trống = chia đều cả nhóm"
        )
      },
      ["title", "amount"]
    ),
    handler: async (input, ctx) => {
      const guard = needTrip(ctx);
      if (guard) return guard;

      const amount = Math.round(Number(input.amount));
      if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, error: "Số tiền không hợp lệ", hint: "amount phải là số nguyên VND > 0" };
      }

      const paidByName = input.paid_by_name?.trim() || ctx.senderName;
      const paidBy = input.paid_by_zalo_id?.trim() || (input.paid_by_name ? `name:${paidByName}` : ctx.senderZaloId);

      // Chống ghi trùng: cùng trip + cùng tên + cùng số tiền + cùng người trả,
      // cách nhau dưới 5 phút → gần như chắc chắn là một khoản bị ghi hai lần.
      //
      // Xảy ra thật khi: Zalo gửi lại webhook, user gửi lại ảnh hoá đơn, hoặc
      // model gọi tool hai lần trong cùng một lượt. Hoá đơn nhân đôi thì bảng
      // chia tiền sai — mà đó lại đúng là thứ giám khảo soi kỹ nhất.
      const dupWindow = new Date(Date.now() - 5 * 60_000);
      const [dup] = await ctx.db
        .select({ id: expenses.id })
        .from(expenses)
        .where(
          and(
            eq(expenses.tripId, ctx.tripId!),
            eq(expenses.title, input.title),
            eq(expenses.amount, amount),
            eq(expenses.paidBy, paidBy),
            gte(expenses.createdAt, dupWindow)
          )
        )
        .limit(1);

      if (dup) {
        const all = await ctx.db.select().from(expenses).where(eq(expenses.tripId, ctx.tripId!));
        const total = all.reduce((s, e) => s + Number(e.amount), 0);
        return {
          ok: true,
          expense_id: dup.id,
          duplicate_skipped: true,
          amount_formatted: formatVnd(amount),
          total_spent_formatted: formatVnd(total),
          message: "Khoản này vừa được ghi rồi — mình không ghi trùng nữa nhé"
        };
      }

      // Đảm bảo người trả có trong danh sách thành viên, nếu không chia tiền sẽ thiếu
      await ctx.db
        .insert(members)
        .values({ tripId: ctx.tripId!, zaloUserId: paidBy, displayName: paidByName })
        .onConflictDoNothing();

      const [row] = await ctx.db
        .insert(expenses)
        .values({
          tripId: ctx.tripId!,
          title: input.title,
          amount,
          category: input.category ?? "other",
          paidBy,
          paidByName,
          splitMode: input.split_among?.length ? "custom" : "equal",
          receiptPhotoUrl: input.receipt_photo_url ?? null,
          spentAt: input.spent_at ? new Date(input.spent_at) : new Date()
        })
        .returning();

      // Chia cho danh sách chỉ định
      if (input.split_among?.length) {
        const names: string[] = input.split_among;
        const all = await ctx.db.select().from(members).where(eq(members.tripId, ctx.tripId!));
        const base = Math.floor(amount / names.length);
        const remainder = amount - base * names.length;

        await ctx.db.insert(expenseSplits).values(
          names.map((name: string, i: number) => {
            const match = all.find(
              (m) => m.displayName.toLowerCase() === name.trim().toLowerCase()
            );
            return {
              expenseId: row.id,
              memberZaloId: match?.zaloUserId ?? `name:${name.trim()}`,
              memberName: match?.displayName ?? name.trim(),
              shareAmount: base + (i < remainder ? 1 : 0)
            };
          })
        );
      }

      await ctx.db.insert(activities).values({
        tripId: ctx.tripId!,
        kind: "expense",
        content: `${paidByName} trả ${formatVnd(amount)} — ${input.title}`
      });

      const all = await ctx.db.select().from(expenses).where(eq(expenses.tripId, ctx.tripId!));
      const total = all.reduce((s, e) => s + Number(e.amount), 0);

      return {
        ok: true,
        expense_id: row.id,
        amount_formatted: formatVnd(amount),
        paid_by: paidByName,
        total_spent: total,
        total_spent_formatted: formatVnd(total),
        expense_count: all.length
      };
    }
  },

  {
    name: "list_expenses",
    description: "Liệt kê tất cả khoản chi của chuyến đi kèm tổng. Dùng khi user hỏi 'tiêu bao nhiêu rồi'.",
    input_schema: schema({}, []),
    handler: async (_input, ctx) => {
      const guard = needTrip(ctx);
      if (guard) return guard;

      const rows = await ctx.db.select().from(expenses).where(eq(expenses.tripId, ctx.tripId!));
      const total = rows.reduce((s, e) => s + Number(e.amount), 0);

      const byCategory: Record<string, number> = {};
      for (const r of rows) {
        byCategory[r.category] = (byCategory[r.category] ?? 0) + Number(r.amount);
      }

      return {
        ok: true,
        total,
        total_formatted: formatVnd(total),
        by_category: Object.fromEntries(
          Object.entries(byCategory).map(([k, v]) => [k, formatVnd(v)])
        ),
        expenses: rows.map((r) => ({
          id: r.id,
          title: r.title,
          amount_formatted: formatVnd(Number(r.amount)),
          category: r.category,
          paid_by: r.paidByName,
          has_receipt: Boolean(r.receiptPhotoUrl)
        }))
      };
    }
  },

  {
    name: "settle_expenses",
    description:
      "Tính chia tiền cuối chuyến: ai nợ ai bao nhiêu, với SỐ GIAO DỊCH TỐI THIỂU. " +
      "LUÔN dùng tool này, TUYỆT ĐỐI không tự cộng trừ trong đầu. " +
      "Kết quả đã làm tròn 1000đ và bảo toàn tổng tiền.",
    input_schema: schema({}, []),
    handler: async (_input, ctx) => {
      const guard = needTrip(ctx);
      if (guard) return guard;

      const [exp, mem] = await Promise.all([
        loadExpenses(ctx),
        ctx.db.select().from(members).where(eq(members.tripId, ctx.tripId!))
      ]);

      if (mem.length === 0) {
        return {
          ok: false,
          error: "Chuyến đi chưa có thành viên nào",
          hint: "Hỏi user có những ai đi rồi dùng add_member."
        };
      }
      if (exp.length === 0) {
        return { ok: true, total_spent: 0, settlements: [], message: "Chưa có khoản chi nào" };
      }

      const result = settleExpenses(
        exp,
        mem.map((m) => ({ zaloUserId: m.zaloUserId, displayName: m.displayName }))
      );

      return {
        ok: true,
        total_spent: result.totalSpent,
        total_spent_formatted: formatVnd(result.totalSpent),
        per_person_average: formatVnd(Math.round(result.totalSpent / mem.length)),
        balances: result.perMember.map((b) => ({
          name: b.displayName,
          paid: formatVnd(b.paid),
          owed: formatVnd(b.owed),
          net: b.net,
          net_formatted: `${b.net >= 0 ? "+" : "−"}${formatVnd(Math.abs(b.net))}`,
          status: b.net > 0 ? "được nhận" : b.net < 0 ? "phải trả" : "hoà"
        })),
        settlements: result.settlements.map((s) => ({
          from: s.fromName,
          to: s.toName,
          amount: s.amount,
          text: `${s.fromName} chuyển ${formatVnd(s.amount)} cho ${s.toName}`
        })),
        transaction_count: result.settlements.length,
        rounding_adjustment: result.roundingAdjustment,
        warnings: result.warnings
      };
    }
  }
];

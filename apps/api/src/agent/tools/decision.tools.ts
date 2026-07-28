import { and, eq, inArray } from "drizzle-orm";
import { activities, decisionOptions, decisions, members } from "../../db/schema";
import { S, schema, type ToolDef } from "./types";

/**
 * Tool cho J2 — Zino đề xuất phương án, NHÓM chốt.
 *
 * Ranh giới quan trọng: Zino được phép *nghiêng* về một phương án và nói rõ vì
 * sao, nhưng KHÔNG được tự chốt. Chốt là hành động của người tổ chức, bấm trong
 * Mini App. Vì vậy ở đây chỉ có tool tạo đề xuất và tool đọc lại kết quả —
 * không có tool nào ghi `status = decided`.
 */
export const decisionTools: ToolDef[] = [
  {
    name: "propose_options",
    description:
      "Đưa ra 2-4 phương án cho nhóm bình chọn trong Mini App (chọn khách sạn, quán ăn, xe...). " +
      "Gọi SAU KHI đã research xong và có giá cụ thể. " +
      "LUÔN nêu lý do mình nghiêng phương án nào — nhóm cần biết mình nghĩ gì, không chỉ danh sách. " +
      "KHÔNG tự chốt: việc chốt là của người tổ chức, bấm trong app. " +
      "Mỗi chuyến chỉ có MỘT đề xuất đang mở — còn cái cũ chưa chốt thì nhắc nhóm chốt trước.",
    input_schema: schema(
      {
        title: S.str('Đang chọn cái gì, vd "Chọn khách sạn" hoặc "Quán ăn tối 29/07"'),
        kind: S.enum(
          ["stay", "food", "transport", "activity", "other"],
          "Loại quyết định"
        ),
        options: S.arr(
          {
            type: "object",
            properties: {
              label: { type: "string", description: 'Tên ngắn, vd "Khách sạn Malibu"' },
              detail: { type: "string", description: 'Điểm đáng chú ý, vd "cách Bãi Sau 400m"' },
              price: { type: "integer", description: "Giá VND cho cả nhóm, bỏ trống nếu chưa rõ" },
              partner_oa_id: { type: "string", description: "oa_id nếu là đối tác trong danh bạ" }
            },
            required: ["label"],
            additionalProperties: false
          },
          "2-4 phương án"
        ),
        recommended_index: S.int("Vị trí phương án mình nghiêng (0 = phương án đầu)"),
        reason: S.str("Vì sao nghiêng phương án đó — nêu cả điểm đánh đổi, đừng chỉ khen")
      },
      ["title", "options", "reason"]
    ),
    handler: async (input, ctx) => {
      if (!ctx.tripId) {
        return { ok: false, error: "Chưa có chuyến đi nào", hint: "Tạo chuyến trước bằng create_trip" };
      }

      const opts = (input.options ?? []) as {
        label?: string;
        detail?: string;
        price?: number;
        partner_oa_id?: string;
      }[];
      if (opts.length < 2) {
        return {
          ok: false,
          error: "Cần ít nhất 2 phương án",
          hint: "Một phương án thì không có gì để chọn — research thêm rồi gọi lại"
        };
      }

      // Một chuyến một đề xuất đang mở. Nhiều thẻ cam cùng lúc thì nhóm không
      // biết nhìn cái nào, và unique index dưới DB cũng sẽ chặn.
      const open = await ctx.db
        .select({ id: decisions.id, title: decisions.title })
        .from(decisions)
        .where(and(eq(decisions.tripId, ctx.tripId), inArray(decisions.status, ["open", "tie"])));
      if (open.length > 0) {
        return {
          ok: false,
          error: `Nhóm còn đề xuất "${open[0].title}" chưa chốt`,
          hint: "Nhắc nhóm chốt cái đang mở trước, rồi mới đề xuất tiếp"
        };
      }

      const [row] = await ctx.db
        .insert(decisions)
        .values({
          tripId: ctx.tripId,
          conversationId: ctx.conversationId,
          kind: String(input.kind ?? "other"),
          title: String(input.title),
          recommendationReason: String(input.reason)
        })
        .returning();

      const inserted = await ctx.db
        .insert(decisionOptions)
        .values(
          opts.map((o, i) => ({
            decisionId: row.id,
            label: String(o.label ?? `Phương án ${i + 1}`),
            detail: o.detail ?? null,
            price: o.price ?? null,
            partnerOaId: o.partner_oa_id ?? null,
            sortOrder: i
          }))
        )
        .returning();

      const idx = Number(input.recommended_index ?? 0);
      if (Number.isInteger(idx) && idx >= 0 && idx < inserted.length) {
        await ctx.db
          .update(decisions)
          .set({ recommendedOptionId: inserted[idx].id })
          .where(eq(decisions.id, row.id));
      }

      await ctx.db.insert(activities).values({
        tripId: ctx.tripId,
        kind: "suggestion",
        content: `Đề xuất ${inserted.length} phương án cho "${row.title}"`
      });

      return {
        ok: true,
        decision_id: row.id,
        options: inserted.map((o, i) => ({ index: i, id: o.id, label: o.label })),
        miniapp_url: `${ctx.publicBaseUrl}/trip/${ctx.tripId}/`,
        message:
          "Đã tạo đề xuất. Hãy nhắn cho nhóm danh sách phương án kèm lý do mình nghiêng cái nào, " +
          "và mời mọi người bình chọn trong Mini App."
      };
    }
  },

  {
    name: "check_decision",
    description:
      "Xem đề xuất đang mở: ai đã bình chọn gì, ai chưa, đã chốt chưa. " +
      "Dùng khi có người hỏi 'chốt chưa', 'ai chọn gì rồi', hoặc trước khi nhắc nhóm.",
    input_schema: schema({}, []),
    handler: async (_input, ctx) => {
      if (!ctx.tripId) return { ok: false, error: "Chưa có chuyến đi nào" };

      const [d] = await ctx.db
        .select()
        .from(decisions)
        .where(and(eq(decisions.tripId, ctx.tripId), inArray(decisions.status, ["open", "tie"])));
      if (!d) return { ok: true, has_open_decision: false, message: "Không có đề xuất nào đang chờ chốt" };

      const [opts, mem] = await Promise.all([
        ctx.db.select().from(decisionOptions).where(eq(decisionOptions.decisionId, d.id)),
        ctx.db.select().from(members).where(eq(members.tripId, ctx.tripId))
      ]);

      return {
        ok: true,
        has_open_decision: true,
        title: d.title,
        status: d.status,
        options: opts.map((o) => ({ id: o.id, label: o.label, price: o.price })),
        member_count: mem.length,
        hint: "Số phiếu chi tiết xem trong Mini App — ở đây chỉ trả về khung."
      };
    }
  }
];

import { and, eq, inArray } from "drizzle-orm";
import { activities, decisionOptions, decisions, members } from "../../db/schema";
import { S, schema, type ToolDef } from "./types";

/**
 * Tool cho J2 — Zino đề xuất phương án, NHÓM chốt.
 *
 * Ranh giới quan trọng: Zino được phép *nghiêng* về một phương án và nói rõ vì
 * sao, nhưng KHÔNG được tự chốt. Chốt là hành động của nhóm.
 *
 * ĐỔI 29/07 — CHỐT NGAY TRONG CHAT, KHÔNG QUA MINI APP NỮA.
 *
 * Trước đây bỏ phiếu và chốt đều phải bấm trong Mini App, nên ở đây cố ý không
 * có tool nào ghi `status = decided`. Hệ quả không lường trước: nếu nhóm chỉ
 * trao đổi trong chat thì quyết định nằm `open` vĩnh viễn, và lần
 * `propose_options` kế tiếp bị chặn bởi luật "một chuyến một đề xuất đang mở".
 * Cả luồng đứng im mà không có thông báo lỗi nào cho người dùng.
 *
 * Nay `record_decision` cho Zino đóng vòng ngay trong chat khi nhóm đã nói rõ
 * chọn gì. Postgres vẫn được ghi y như đường cũ, nên Mini App vẫn hiện đúng kết
 * quả — chỉ khác chỗ chữ ký người chốt là một tin nhắn thay vì một cú bấm.
 *
 * Đường bấm-trong-app vẫn còn nguyên (`DecisionsController`), hai lối vào cùng
 * ghi một bảng. Ai chốt trước thì thắng; lối còn lại thấy `decided` và dừng.
 */
export const decisionTools: ToolDef[] = [
  {
    name: "propose_options",
    description:
      "Đưa ra 2-4 phương án cho nhóm bình chọn NGAY TRONG CHAT (chọn khách sạn, quán ăn, xe...). " +
      "Gọi SAU KHI đã research xong và có giá cụ thể. " +
      "LUÔN nêu lý do mình nghiêng phương án nào — nhóm cần biết mình nghĩ gì, không chỉ danh sách. " +
      "Sau khi gọi, hãy đánh số phương án 1️⃣ 2️⃣ 3️⃣ trong tin nhắn và mời mọi người nhắn số hoặc tên phương án. " +
      "KHÔNG tự chốt: đợi nhóm nói rõ đã chọn gì rồi gọi record_decision. " +
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
        message:
          "Đã tạo đề xuất. Hãy nhắn cho nhóm danh sách phương án ĐÁNH SỐ kèm lý do mình nghiêng cái nào, " +
          "rồi mời mọi người nhắn số hoặc tên phương án ngay trong nhóm. " +
          "Khi đủ rõ nhóm chọn gì thì gọi record_decision. Đừng nhắc tới Mini App."
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
        hint:
          "Đây là khung phương án. Ai chọn gì thì đọc lại tin nhắn trong nhóm — " +
          "đủ rõ rồi thì gọi record_decision."
      };
    }
  },

  {
    name: "record_decision",
    /**
     * Đóng vòng quyết định từ chat.
     *
     * VÌ SAO CẦN: `propose_options` từ chối tạo đề xuất mới khi còn cái đang mở.
     * Không có tool này thì mỗi chuyến chỉ đề xuất được đúng một lần rồi kẹt —
     * mà người dùng không thấy lỗi gì, chỉ thấy Zino im.
     */
    description:
      "Chốt phương án cho đề xuất đang mở. " +
      "MỘT người nói rõ là đủ — 'chốt A', 'lấy cái 1', 'ok Malibu đi' — không cần đợi cả nhóm " +
      "và không cần đếm phiếu. Gọi ngay, đừng hỏi lại cho chắc. " +
      "Chỉ hỏi lại khi người ta nói mơ hồ tới mức không rõ đang chọn phương án nào. " +
      "Chốt xong thì đề xuất đóng lại và nhóm mới đề xuất tiếp được.",
    input_schema: schema(
      {
        option_index: S.int("Vị trí phương án được chọn (0 = phương án đầu tiên)"),
        option_label: S.str("Tên phương án được chọn — dùng khi không chắc vị trí"),
        vote_note: S.str('Tóm tắt phiếu để ghi nhật ký, vd "Lan và Tú chọn A, Minh không ý kiến"')
      },
      []
    ),
    handler: async (input, ctx) => {
      if (!ctx.tripId) return { ok: false, error: "Chưa có chuyến đi nào" };

      const [d] = await ctx.db
        .select()
        .from(decisions)
        .where(and(eq(decisions.tripId, ctx.tripId), inArray(decisions.status, ["open", "tie"])));
      if (!d) {
        return {
          ok: false,
          error: "Không có đề xuất nào đang mở",
          hint: "Tạo đề xuất bằng propose_options trước đã"
        };
      }

      const opts = await ctx.db
        .select()
        .from(decisionOptions)
        .where(eq(decisionOptions.decisionId, d.id));

      // Ưu tiên nhãn: model nhớ tên phương án chắc hơn nhớ thứ tự.
      const label = typeof input.option_label === "string" ? input.option_label.trim() : "";
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
      let chosen = label ? opts.find((o) => norm(o.label) === norm(label)) : undefined;
      if (!chosen && label) chosen = opts.find((o) => norm(o.label).includes(norm(label)));

      if (!chosen) {
        const i = Number(input.option_index);
        const sorted = [...opts].sort((a, b) => a.sortOrder - b.sortOrder);
        if (Number.isInteger(i) && i >= 0 && i < sorted.length) chosen = sorted[i];
      }

      if (!chosen) {
        return {
          ok: false,
          error: "Không khớp được phương án nào",
          options: opts.map((o) => ({ index: o.sortOrder, label: o.label })),
          hint: "Truyền option_label đúng tên trong danh sách trên, hoặc option_index"
        };
      }

      await ctx.db
        .update(decisions)
        .set({
          status: "decided",
          decidedOptionId: chosen.id,
          decidedBy: ctx.senderZaloId,
          decidedByName: ctx.senderName,
          decidedAt: new Date()
        })
        .where(eq(decisions.id, d.id));

      const note = typeof input.vote_note === "string" && input.vote_note.trim()
        ? ` — ${input.vote_note.trim()}`
        : "";
      await ctx.db.insert(activities).values({
        tripId: ctx.tripId,
        kind: "booking",
        content: `Chốt "${chosen.label}" cho ${d.title}${note} (chốt trong nhóm chat)`
      });

      return {
        ok: true,
        decision_id: d.id,
        decided: chosen.label,
        price: chosen.price,
        message:
          `Đã chốt "${chosen.label}". Hãy báo lại nhóm và nói bước tiếp theo ` +
          `(ví dụ gửi link đặt chỗ). Đừng nhắc tới Mini App.`
      };
    }
  }
];

import { eq } from "drizzle-orm";
import { groupMemory } from "../../db/schema";
import { moneyTools } from "./money.tools";
import { partnerTools } from "./partner.tools";
import { tripTools } from "./trip.tools";
import { S, schema, type ToolDef } from "./types";

/** Bộ nhớ dài hạn — Lisa chủ động ghi khi phát hiện điều đáng nhớ về nhóm. */
const memoryTools: ToolDef[] = [
  {
    name: "remember",
    description:
      "Ghi một điều BỀN VỮNG về nhóm này để nhớ cho những chuyến sau: sở thích du lịch, " +
      "khẩu vị, dị ứng, ngân sách quen thuộc, thói quen, vai trò từng người. " +
      "KHÔNG dùng cho chi tiết của một chuyến đi cụ thể (đã có DB lo). " +
      "Gọi ngay khi phát hiện, đừng đợi cuối hội thoại.",
    input_schema: schema(
      {
        fact: S.str('Điều cần nhớ, viết ngắn gọn ở ngôi thứ 3, vd "Nhóm thích biển hơn núi"')
      },
      ["fact"]
    ),
    handler: async (input, ctx) => {
      const current = await ctx.db.query.groupMemory.findFirst({
        where: eq(groupMemory.conversationId, ctx.conversationId)
      });
      const fact = String(input.fact).trim();
      if (!fact) return { ok: false, error: "fact rỗng" };

      const existing = current?.content ?? "";
      if (existing.toLowerCase().includes(fact.toLowerCase())) {
        return { ok: true, message: "Đã nhớ điều này rồi", skipped: true };
      }

      const updated = existing ? `${existing}\n- ${fact}` : `- ${fact}`;
      await ctx.db
        .insert(groupMemory)
        .values({ conversationId: ctx.conversationId, content: updated })
        .onConflictDoUpdate({
          target: groupMemory.conversationId,
          set: { content: updated, updatedAt: new Date() }
        });

      return { ok: true, message: "Đã ghi nhớ" };
    }
  },

  {
    name: "recall",
    description:
      "Đọc lại toàn bộ bộ nhớ dài hạn về nhóm này. Thường không cần gọi vì bộ nhớ đã " +
      "nằm sẵn trong system prompt — chỉ dùng khi cần kiểm tra lại sau khi vừa ghi.",
    input_schema: schema({}, []),
    handler: async (_input, ctx) => {
      const mem = await ctx.db.query.groupMemory.findFirst({
        where: eq(groupMemory.conversationId, ctx.conversationId)
      });
      return { ok: true, memory: mem?.content ?? "(chưa có gì)" };
    }
  }
];

/**
 * Việc chạy lâu (30-120s) → đẩy sang worker chạy nền, Lisa kết thúc lượt ngay.
 * Kết quả sẽ được PUSH CHỦ ĐỘNG về nhóm khi xong.
 *
 * Bot API không có cửa sổ 48h như OA nên push chủ động hoạt động.
 */
const asyncTools: ToolDef[] = [
  {
    name: "request_deep_plan",
    description:
      "Yêu cầu nghiên cứu sâu để dựng lịch trình chi tiết (có tra cứu web giá cả, địa điểm, thời tiết). " +
      "Mất khoảng 1 phút và chạy nền. " +
      "SAU KHI gọi tool này: nói với user 'để mình research chút nha, tí nữa mình gửi' rồi KẾT THÚC LƯỢT. " +
      "Đừng chờ, đừng bịa lịch trình.",
    input_schema: schema(
      {
        focus: S.str(
          'Yêu cầu cụ thể của user, vd "3 ngày Đà Nẵng thiên về ăn uống và biển, tránh dậy sớm"'
        )
      },
      ["focus"]
    ),
    handler: async (input, ctx) => {
      if (!ctx.tripId) {
        return {
          ok: false,
          error: "Chưa có chuyến đi",
          hint: "Tạo chuyến đi trước bằng create_trip."
        };
      }
      await ctx.enqueue("deep_plan", {
        conversationId: ctx.conversationId,
        zaloChatId: ctx.zaloChatId,
        tripId: ctx.tripId,
        focus: input.focus
      });
      return {
        ok: true,
        message: "Đã nhận việc, đang research nền",
        instruction_for_you:
          "Báo user là bạn đang tìm hiểu và sẽ gửi kết quả sau ~1 phút, rồi kết thúc lượt."
      };
    }
  },

  {
    name: "request_recap",
    description:
      "Dựng trang web tổng kết chuyến đi từ ảnh, ghi chú, lịch trình và chi phí đã lưu. " +
      "Dùng khi chuyến đi kết thúc và user muốn tổng kết / chia sẻ kỷ niệm. " +
      "Chạy nền ~1 phút, link sẽ được gửi vào nhóm khi xong.",
    input_schema: schema(
      { tone: S.enum(["vui", "hoài niệm", "gọn gàng"], "Giọng điệu của trang tổng kết") },
      []
    ),
    handler: async (input, ctx) => {
      if (!ctx.tripId) return { ok: false, error: "Chưa có chuyến đi" };
      await ctx.enqueue("recap", {
        conversationId: ctx.conversationId,
        zaloChatId: ctx.zaloChatId,
        tripId: ctx.tripId,
        tone: input.tone ?? "vui"
      });
      return {
        ok: true,
        message: "Đang dựng trang tổng kết",
        instruction_for_you: "Báo user chờ chút, link sẽ tự gửi vào nhóm. Rồi kết thúc lượt."
      };
    }
  }
];

/** Toàn bộ tool Lisa dùng được. */
export const allTools: ToolDef[] = [
  ...tripTools,
  ...moneyTools,
  ...partnerTools,
  ...memoryTools,
  ...asyncTools
];

export const toolMap = new Map(allTools.map((t) => [t.name, t]));

/**
 * Định dạng cho Messages API.
 *
 * ⚠ KHÔNG bật `strict: true`. Đã thử và API trả 400:
 *   "Schema is too complex for compilation. Try reducing the number of tools
 *    or simplifying tool schemas."
 * Strict mode dùng grammar-constrained sampling, chi phí biên dịch tăng theo
 * tổng độ phức tạp của TẤT CẢ schema — 16 tool là quá ngưỡng.
 *
 * Đánh đổi chấp nhận được: mất bảo đảm ở tầng sampling, nhưng schema vẫn được
 * gửi cho model và mọi tool đều tự validate input trong handler rồi trả
 * {ok:false, hint} khi sai — model đọc hint và gọi lại cho đúng.
 *
 * Nếu sau này thật sự cần strict cho một tool nào đó, bật riêng lẻ cho tool đó
 * chứ đừng bật cả loạt.
 */
export function toolsForApi() {
  return allTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema
  }));
}

export * from "./types";
export { loadTripState } from "./trip.tools";

import { eq } from "drizzle-orm";
import { groupMemory } from "../../db/schema";
import { outcomeEnabled } from "../../pipeline/outcome.types";
import { pipelineEnabled } from "../../pipeline/pipeline.types";
import { v7Enabled } from "../../pipeline/v7.types";
import { outcomeTools } from "./outcome.tools";
import { decisionTools } from "./decision.tools";
import { moneyTools } from "./money.tools";
import { partnerTools } from "./partner.tools";
import { planningTools } from "./planning.tools";
import { v7Tools } from "./v7.tools";
import { tripTools } from "./trip.tools";
import { S, schema, type ToolDef } from "./types";

/** Bộ nhớ dài hạn — Zino chủ động ghi khi phát hiện điều đáng nhớ về nhóm. */
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
 * Việc chạy lâu (30-120s) → đẩy sang worker chạy nền, Zino kết thúc lượt ngay.
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
      /**
       * `dedupeKey` riêng cho research — KHÔNG dùng `ctx.zaloChatId` trần.
       *
       * Không có khoá thì `JobsService.claim()` bỏ qua chốt serialize (nó chỉ
       * áp với job có `dedupe_key`), nên hai lượt research cùng nhóm chạy song
       * song: tốn gấp đôi tiền và hai kết quả ghi đè nhau xuống DB.
       *
       * Nhưng dùng `chatId` trần thì research lại xếp cùng hàng với `agent_turn`
       * — nghĩa là cả nhóm không chat được suốt 2–4 phút Zino đang tra cứu.
       * Tiền tố `research:` cho hai loại việc hai hàng riêng: research nối tiếp
       * research, còn trò chuyện vẫn chạy song song bình thường.
       */
      await ctx.enqueue(
        "deep_plan",
        {
          conversationId: ctx.conversationId,
          zaloChatId: ctx.zaloChatId,
          tripId: ctx.tripId,
          focus: input.focus
        },
        undefined,
        `research:${ctx.zaloChatId}`
      );
      return {
        ok: true,
        message: "Đã nhận việc, đang research nền",
        instruction_for_you:
          "Báo user là bạn đang tìm hiểu và sẽ gửi kết quả sau vài phút, rồi kết thúc lượt. " +
          "ĐỪNG hứa con số cụ thể như '1 phút' — tuỳ độ khó mà mất từ một tới bốn phút, " +
          "hứa ngắn rồi trả lời muộn còn tệ hơn nói chung chung."
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

/**
 * Điều phối câu trả lời khi nhiều người nhắn cùng lúc.
 *
 * Backend gộp các tin đến gần nhau thành một lượt. Quyết định "gộp hay tách
 * câu trả lời" là quyết định NGỮ NGHĨA — chỉ agent làm được, vì nó phải hiểu
 * các yêu cầu có liên quan tới nhau không.
 */
const replyTools: ToolDef[] = [
  {
    name: "reply",
    description:
      "Gửi MỘT tin trả lời vào nhóm. Dùng khi có nhiều người hỏi cùng lúc và bạn muốn " +
      "TÁCH thành nhiều tin riêng cho dễ theo dõi.\n\n" +
      "Nguyên tắc tách:\n" +
      "• Các yêu cầu LIÊN QUAN nhau (cùng chủ đề, bổ sung cho nhau) → gộp một tin duy nhất\n" +
      "• Các yêu cầu ĐỘC LẬP (người hỏi chỗ ở, người hỏi chia tiền) → mỗi việc một tin, " +
      "mở đầu bằng tên người hỏi để họ biết đang trả lời ai\n" +
      "• Chỉ một người nhắn, hoặc mọi thứ cùng một chủ đề → KHÔNG cần gọi tool này, " +
      "cứ trả lời bình thường bằng văn bản\n\n" +
      "Gọi nhiều lần để gửi nhiều tin. Tin sẽ được gửi theo đúng thứ tự bạn gọi.",
    input_schema: schema(
      {
        text: S.str("Nội dung tin nhắn. Plain text, dưới 2000 ký tự."),
        to: S.str("Tên người mà tin này trả lời — dùng khi tách theo từng người")
      },
      ["text"]
    ),
    handler: async (input, ctx) => {
      const text = String(input.text ?? "").trim();
      if (!text) return { ok: false, error: "text rỗng" };

      ctx.queueReply(text, input.to?.trim() || undefined);
      return { ok: true, queued: true, length: text.length };
    }
  }
];

/**
 * Toàn bộ tool Zino dùng được.
 *
 * Pipeline 4 agent nằm sau cờ ZINO_PIPELINE_ENABLED. Tắt cờ = hệ thống chạy y
 * hệt trước khi có pipeline — đây là đường lui trong 5 giây nếu Managed Agents
 * trục trặc đúng hôm demo.
 *
 * ⚠ Khi BẬT pipeline thì phải BỎ `request_deep_plan`: nó làm gần đúng việc của
 * pipeline (đẩy job deep_plan dựng lịch trình), để cả hai thì model có hai
 * đường lên kế hoạch và sẽ chọn ngẫu nhiên.
 */
export const allTools: ToolDef[] = outcomeEnabled()
  ? [
      /**
       * Kiến trúc v4 Agent-only trên Zalo.
       *
       * Giữ trọn 21 tool — đây là điểm khác căn bản so với v7, nơi flow hút mọi
       * tin nhắn và nhóm mất quyền ghi chi phí, đặt nhắc hẹn, đọc ảnh hoá đơn
       * suốt thời gian flow mở.
       *
       * ⚠ BỎ `request_deep_plan`: nó làm gần đúng việc của `planning_agent`
       * (nghiên cứu rồi đề xuất). Để cả hai thì model có hai đường lên kế hoạch
       * và sẽ chọn ngẫu nhiên — đúng lỗi đã gặp khi bật pipeline v2.
       */
      ...tripTools,
      ...moneyTools,
      ...partnerTools,
      ...decisionTools,
      ...memoryTools,
      ...asyncTools.filter((t) => t.name !== "request_deep_plan"),
      ...outcomeTools,
      ...replyTools
    ]
  : v7Enabled()
  ? [
      // v7: ba agent Intake/Brain/Finalizer. Gỡ request_deep_plan vì Brain
      // làm đúng việc đó, để cả hai thì model chọn ngẫu nhiên.
      ...tripTools,
      ...moneyTools,
      ...partnerTools,
      ...decisionTools,
      ...memoryTools,
      ...asyncTools.filter((t) => t.name !== "request_deep_plan"),
      ...v7Tools,
      ...replyTools
    ]
  : pipelineEnabled()
  ? [
      ...tripTools,
      ...moneyTools,
      ...partnerTools,
      ...decisionTools,
      ...memoryTools,
      ...asyncTools.filter((t) => t.name !== "request_deep_plan"),
      ...planningTools,
      ...replyTools
    ]
  : [...tripTools, ...moneyTools, ...partnerTools, ...decisionTools, ...memoryTools, ...asyncTools, ...replyTools];

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
  const defs = allTools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema
  }));

  // Đánh dấu cache ở TOOL CUỐI CÙNG → toàn bộ ~1.900 token định nghĩa tool
  // trở thành tiền tố được cache. Anthropic cache theo tiền tố, nên breakpoint
  // đặt ở cuối khối là cách gói trọn cả khối.
  if (defs.length > 0) {
    (defs[defs.length - 1] as Record<string, unknown>).cache_control = { type: "ephemeral" };
  }
  return defs;
}

export * from "./types";
export { loadTripState } from "./trip.tools";

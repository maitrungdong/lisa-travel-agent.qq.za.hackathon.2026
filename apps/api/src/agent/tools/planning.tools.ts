import { randomUUID } from "node:crypto";
import { and, eq, notInArray } from "drizzle-orm";
import { pipelineRuns } from "../../db/schema";
import { RUN_TTL_MS, TERMINAL_STATUSES } from "../../pipeline/pipeline.types";
import { S, schema, type ToolDef } from "./types";

/**
 * Cửa vào pipeline 4 agent.
 *
 * Cùng khuôn mẫu với `request_deep_plan`: tool chỉ đẩy job vào hàng đợi rồi
 * bảo model kết thúc lượt ngay. Không chờ, không bịa.
 *
 * LƯU Ý: "logic trigger" nằm ở `description`, không phải ở code. Không có câu
 * `if` nào quyết định pipeline chạy hay không — chính LLM đọc mô tả rồi chọn.
 * Vì thế hai dòng "DÙNG KHI" / "KHÔNG DÙNG" là phần đáng chỉnh nhất ở đây.
 *
 * Chỉ được nạp khi ZINO_PIPELINE_ENABLED=1 (xem tools/index.ts).
 */
export const planningTools: ToolDef[] = [
  {
    name: "start_trip_planning",
    description:
      "Khởi động quy trình lên kế hoạch chuyến đi đầy đủ: chốt nhu cầu → dò phương án thật " +
      "→ dựng 2-3 lịch trình kèm chi phí để nhóm chọn. " +
      "DÙNG KHI: user muốn lên kế hoạch cho một chuyến đi cụ thể — kể cả khi còn thiếu " +
      "ngày, số người hay ngân sách (quy trình sẽ tự hỏi). " +
      "KHÔNG DÙNG cho: hỏi thông tin chung ('Đà Lạt có gì chơi', 'tháng 8 nên đi đâu'), " +
      "ghi chi phí, nhắc hẹn, lưu ảnh, hay chuyến đi đã chốt xong lịch trình. " +
      "Mất 1-2 phút và chạy nền. SAU KHI gọi tool này: nói NGẮN GỌN kiểu 'ok để mình lo nha' " +
      "rồi KẾT THÚC LƯỢT. Đừng hỏi thêm gì — agent chuyên trách sẽ tự hỏi phần còn thiếu.",
    input_schema: schema(
      {
        user_message: S.str(
          "Nguyên văn yêu cầu của user, KHÔNG tóm tắt lại. Agent phía sau cần đúng cách họ nói."
        )
      },
      ["user_message"]
    ),
    handler: async (input, ctx) => {
      const traceId = randomUUID();
      try {
        const [row] = await ctx.db
          .insert(pipelineRuns)
          .values({
            conversationId: ctx.conversationId,
            zaloChatId: ctx.zaloChatId,
            // Người gọi tool = owner. Chỉ owner được chọn phương án ở cuối.
            ownerZaloId: ctx.senderZaloId,
            ownerName: ctx.senderName,
            stage: "A",
            status: "running_a",
            traceId,
            expiresAt: new Date(Date.now() + RUN_TTL_MS)
          })
          .returning({ id: pipelineRuns.id });

        // dedupeKey bắt buộc — xem ghi chú cùng vấn đề ở v7.tools.ts.
        // Webhook đẩy pipeline_step kèm dedupeKey = chatId; job mở flow này
        // phải dùng cùng khoá, nếu không hai stage chạy song song được.
        await ctx.enqueue(
          "pipeline_step",
          {
            runId: row.id,
            stage: "A",
            userMessage: String(input.user_message ?? ""),
            actorId: ctx.senderZaloId,
            actorName: ctx.senderName
          },
          undefined,
          ctx.zaloChatId
        );

        return {
          ok: true,
          run_id: row.id,
          instruction_for_you:
            "Báo user bạn đang lo việc này, một câu thôi, rồi KẾT THÚC LƯỢT. Đừng hỏi thêm."
        };
      } catch (err) {
        // Unique partial index chặn hai run song song trong cùng một nhóm
        if ((err as { code?: string })?.code === "23505") {
          return {
            ok: false,
            error: "Nhóm này đang có một kế hoạch dở dang",
            hint:
              "Nói với user rằng đang có kế hoạch chạy dở, hỏi họ muốn tiếp tục cái cũ hay " +
              "bỏ đi làm lại. Muốn bỏ thì gọi cancel_trip_planning."
          };
        }
        throw err;
      }
    }
  },

  {
    name: "cancel_trip_planning",
    description:
      "Huỷ kế hoạch đang chạy dở của nhóm. " +
      "DÙNG KHI: user muốn bỏ ('thôi khỏi', 'huỷ đi'), hoặc muốn đổi yêu cầu căn bản " +
      "(đổi điểm đến, đổi ngày, đổi số người) — vì quy trình không sửa giữa chừng được, " +
      "phải huỷ rồi bắt đầu lại. " +
      "Sau khi huỷ, nếu user muốn làm lại thì gọi start_trip_planning với yêu cầu MỚI.",
    input_schema: schema({}, []),
    handler: async (_input, ctx) => {
      const rows = await ctx.db
        .update(pipelineRuns)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(pipelineRuns.conversationId, ctx.conversationId),
            notInArray(pipelineRuns.status, TERMINAL_STATUSES as unknown as string[])
          )
        )
        .returning({ id: pipelineRuns.id });

      if (!rows.length) {
        return { ok: false, error: "Nhóm này không có kế hoạch nào đang chạy" };
      }
      return {
        ok: true,
        cancelled: rows.length,
        instruction_for_you: "Xác nhận đã huỷ, hỏi user có muốn lên kế hoạch mới không."
      };
    }
  }
];

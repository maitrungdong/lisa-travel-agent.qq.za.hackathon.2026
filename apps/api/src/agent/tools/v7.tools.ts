import { randomUUID } from "node:crypto";
import { and, eq, notInArray } from "drizzle-orm";
import { pipelineRuns } from "../../db/schema";
import { RUN_TTL_MS, TERMINAL_STATUSES } from "../../pipeline/pipeline.types";
import { S, schema, type ToolDef } from "./types";

/**
 * Cửa vào hệ thống ba agent v7.
 *
 * LỆCH DOC MỘT ĐIỂM, CÓ CHỦ ĐÍCH: v7 §2.2 nói MỌI tin nhắn phải vào Intake.
 * Nhưng Intake chỉ biết `trip | split_bill | quick_qa | action_command | other`
 * — nó không có khái niệm ghi chi phí từ ảnh hoá đơn, nhắc lịch, Partner
 * Network, hay ba tầng bộ nhớ nhóm. Áp dụng nguyên bản là vứt 19 tool đang
 * chạy ổn định.
 *
 * Thoả hiệp: `AgentService` giữ vai trò cửa trước cho mọi việc khác. Khi nó
 * nhận ra ý định lên kế hoạch thì mở flow v7, và TỪ ĐÓ mọi tin nhắn trong hội
 * thoại đi thẳng vào Intake cho tới khi flow kết thúc — đúng tinh thần §2.2
 * trong phạm vi flow.
 */
export const v7Tools: ToolDef[] = [
  {
    name: "start_planning_flow",
    description:
      "Mở quy trình lên kế hoạch/nghiên cứu nhu cầu (du lịch, dịch vụ, mua sắm). " +
      "DÙNG KHI: user muốn bạn TÌM HIỂU và ĐỀ XUẤT phương án có so sánh — lên kế hoạch " +
      "chuyến đi, tìm chỗ ở, so sánh lựa chọn, hoặc chia tiền phức tạp. " +
      "KHÔNG DÙNG cho: ghi một khoản chi, đặt nhắc hẹn, lưu ảnh, thêm mốc lịch trình, " +
      "hay câu hỏi bạn tự trả lời được ngay. " +
      "SAU KHI gọi: nói ĐÚNG MỘT CÂU RẤT NGẮN kiểu 'ok để mình lo nha' rồi KẾT THÚC LƯỢT. " +
      "Đừng hỏi gì, đừng liệt kê gì — trợ lý chuyên trách sẽ tự hỏi phần còn thiếu. " +
      "(Phải có đúng một câu: lượt không có chữ nào sẽ rơi vào tin lỗi mặc định.)",
    input_schema: schema(
      {
        user_message: S.str("Nguyên văn yêu cầu của user, KHÔNG tóm tắt hay diễn giải lại")
      },
      ["user_message"]
    ),
    handler: async (input, ctx) => {
      const existing = await ctx.db
        .select({ id: pipelineRuns.id })
        .from(pipelineRuns)
        .where(
          and(
            eq(pipelineRuns.conversationId, ctx.conversationId),
            notInArray(pipelineRuns.status, TERMINAL_STATUSES as unknown as string[])
          )
        )
        .limit(1);

      let runId = existing[0]?.id;

      if (!runId) {
        try {
        const [row] = await ctx.db
          .insert(pipelineRuns)
          .values({
            conversationId: ctx.conversationId,
            zaloChatId: ctx.zaloChatId,
            // v7 khai tử khái niệm owner; cột này NOT NULL từ v2 nên vẫn ghi,
            // nhưng KHÔNG dùng để chặn ai.
            ownerZaloId: ctx.senderZaloId,
            ownerName: ctx.senderName,
            stage: "A",
            status: "awaiting_user",
            traceId: randomUUID(),
            thinState: {},
            expiresAt: new Date(Date.now() + RUN_TTL_MS)
          })
          .returning({ id: pipelineRuns.id });
        runId = row.id;
        } catch (err) {
          // Hai người cùng nhờ lên kế hoạch một lúc → unique partial index chặn.
          // Đọc lại run của người kia thay vì ném lỗi thô ra cho model.
          if ((err as { code?: string })?.code !== "23505") throw err;
          const [again] = await ctx.db
            .select({ id: pipelineRuns.id })
            .from(pipelineRuns)
            .where(
              and(
                eq(pipelineRuns.conversationId, ctx.conversationId),
                notInArray(pipelineRuns.status, TERMINAL_STATUSES as unknown as string[])
              )
            )
            .limit(1);
          if (!again) throw err;
          runId = again.id;
        }
      }

      /**
       * `dedupeKey` BẮT BUỘC ở đây.
       *
       * `JobsService.claim()` bỏ qua chốt serialize với job `dedupe_key IS NULL`,
       * nên nếu để trống thì lượt mở flow này không chặn được lượt v7 kế tiếp do
       * webhook đẩy vào (webhook luôn truyền `msg.chatId`). Hai lượt cùng hội
       * thoại chạy song song sẽ ghi đè `thin_state` của nhau và gọi Brain hai
       * lần — đúng thứ v7 §3.3 cấm.
       *
       * Hôm nay worker chạy tuần tự một container nên chưa vỡ, nhưng bảo đảm
       * phải nằm ở hàng đợi chứ không nằm ở hình dạng triển khai.
       */
      await ctx.enqueue(
        "v7_turn",
        {
          runId,
          userMessage: String(input.user_message ?? ""),
          actorId: ctx.senderZaloId,
          actorName: ctx.senderName
        },
        undefined,
        ctx.zaloChatId
      );

      return {
        ok: true,
        run_id: runId,
        instruction_for_you:
          "Nói đúng một câu rất ngắn kiểu 'ok để mình lo nha' rồi KẾT THÚC LƯỢT. Không hỏi gì thêm."
      };
    }
  },

  {
    name: "cancel_planning_flow",
    description:
      "Huỷ quy trình lên kế hoạch đang chạy dở của nhóm. " +
      "DÙNG KHI: user nói thôi/huỷ/dừng, hoặc muốn bắt đầu lại từ đầu với yêu cầu khác hẳn.",
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

      if (!rows.length) return { ok: false, error: "Không có quy trình nào đang chạy" };
      return { ok: true, cancelled: rows.length };
    }
  }
];

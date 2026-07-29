import { S, schema, type ToolDef } from "./types";

/**
 * Cửa vào hành trình lên kế hoạch v4 — MỘT tool duy nhất.
 *
 * VÌ SAO MỘT CHỨ KHÔNG HAI: bản đầu tôi định tách `start_planning` và
 * `continue_planning`. Nhưng mỗi lựa chọn thêm cho model là một chỗ nó chọn
 * sai, và ở đây chọn sai nghĩa là "Chọn 2" rơi vào lượt mới thay vì lượt đang
 * chờ — mất cả hành trình. Backend tự biết đã có hành trình mở hay chưa, nên
 * đừng bắt model quyết định điều nó không cần biết.
 *
 * VÌ SAO KHÔNG HÚT THẲNG MỌI TIN NHẮN như hệ v7 làm: làm vậy thì suốt hành
 * trình, nhóm mất 21 tool còn lại — không ghi được tiền cà phê, không đặt được
 * nhắc hẹn, không đọc được ảnh hoá đơn. Đó là lỗi thiết kế của v7 đã trả giá
 * bằng trọn ngày 29/07. Ở đây `AgentService` vẫn thấy mọi tin và tự quyết định
 * chuyển tiếp — model định tuyến vốn là việc nó làm tốt.
 */
export const outcomeTools: ToolDef[] = [
  {
    name: "planning_agent",
    description:
      "Chuyển tin nhắn cho trợ lý lên kế hoạch chuyên trách — nó lo nghiên cứu, so sánh " +
      "phương án và dẫn nhóm đi từng bước quyết định.\n\n" +
      "DÙNG KHI:\n" +
      "• User muốn bạn TÌM HIỂU và ĐỀ XUẤT có so sánh — lên kế hoạch chuyến đi, tìm chỗ ở, " +
      "tìm phương tiện, so sánh lựa chọn\n" +
      "• Nhóm đang trong một hành trình lên kế hoạch và tin nhắn này thuộc về hành trình đó — " +
      'kể cả tin rất ngắn như "Chọn 2", "cái đầu", "BẮT ĐẦU RESEARCH", "đổi sang 3 ngày"\n\n' +
      "KHÔNG DÙNG cho: ghi một khoản chi, đặt nhắc hẹn, lưu ảnh, thêm mốc lịch trình, " +
      "chia tiền, hay câu hỏi bạn tự trả lời được ngay. Những việc đó dùng tool riêng của chúng, " +
      "kể cả khi đang giữa một hành trình lên kế hoạch.\n\n" +
      "SAU KHI GỌI: nói ĐÚNG MỘT CÂU RẤT NGẮN kiểu 'để mình xem nha' rồi KẾT THÚC LƯỢT. " +
      "Đừng hỏi gì, đừng liệt kê gì, đừng đoán trước câu trả lời — trợ lý chuyên trách sẽ tự " +
      "trả lời vào nhóm. (Phải có đúng một câu: lượt không có chữ nào sẽ rơi vào tin lỗi mặc định.)",
    input_schema: schema(
      {
        user_message: S.str(
          "Nguyên văn tin nhắn của user, KHÔNG tóm tắt, KHÔNG diễn giải lại, KHÔNG dịch. " +
            'Trợ lý kia cần đúng chữ user gõ để hiểu "Chọn 2" là chọn cái gì.'
        )
      },
      ["user_message"]
    ),
    handler: async (input, ctx) => {
      const text = String(input.user_message ?? "").trim();
      if (!text) return { ok: false, error: "user_message rỗng" };

      const run = await ctx.ensurePlanningRun();
      /**
       * `dedupeKey` riêng cho hành trình — KHÔNG dùng `ctx.zaloChatId` trần.
       *
       * §9 yêu cầu không hai active run song song trong cùng conversation. Nhưng
       * dùng chatId trần thì hành trình xếp cùng hàng với `agent_turn`, và cả
       * nhóm không chat được suốt 2–3 phút agent đang nghiên cứu.
       */
      await ctx.enqueue(
        "outcome_turn",
        { runId: run.id, userMessage: text },
        undefined,
        `planning:${ctx.zaloChatId}`
      );

      return {
        ok: true,
        run_id: run.id,
        instruction_for_you:
          "Nói đúng một câu rất ngắn kiểu 'để mình xem nha' rồi KẾT THÚC LƯỢT. Không hỏi gì thêm."
      };
    }
  },

  {
    name: "end_planning",
    description:
      "Đóng hành trình lên kế hoạch đang chạy dở. " +
      "DÙNG KHI: user nói thôi/huỷ/dừng/xong rồi, hoặc muốn bắt đầu lại từ đầu với nhu cầu khác hẳn.",
    input_schema: schema({}, []),
    handler: async (_input, ctx) => {
      const closed = await ctx.closePlanningRun();
      return closed
        ? { ok: true, message: "Đã đóng hành trình lên kế hoạch" }
        : { ok: false, error: "Không có hành trình nào đang chạy" };
    }
  }
];

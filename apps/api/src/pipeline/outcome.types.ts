/**
 * Contract kiến trúc v4 Agent-only — `v4_outcome_agent`.
 *
 * Ngắn đến mức gần như không có gì, và đó là điểm mạnh: §4.2 của
 * `BACKEND_HANDOFF_V4_AGENT_ONLY.md` quy định **plain text vào, plain text ra**.
 * Không JSON envelope, không field cần parse, không `state_patch`.
 *
 * VÌ SAO ĐÁNG GIÁ: bốn lỗi đã ngốn trọn ngày 29/07 đều cùng một loại — hợp
 * đồng JSON giữa backend và agent lệch nhau. Status `gathered` không có trong
 * §6.8, Brain thiếu `draft_message_to_user`, `scope_summary` rỗng ở lượt chọn,
 * brief nằm ở `normalized_request` thay vì `current_brief`. Không parse thì
 * không có hợp đồng để lệch.
 *
 * Backend chỉ còn giữ hai trách nhiệm mà model không làm thay được:
 * giữ đúng session cho mỗi hành trình, và không chạy hai lượt song song.
 */

import { envInt } from "./pipeline.types";

export function outcomeEnabled(): boolean {
  return process.env.ZINO_OUTCOME_ENABLED === "1" && Boolean(process.env.ZINO_AGENT_OUTCOME_ID);
}

export function outcomeAgentId(): string {
  return process.env.ZINO_AGENT_OUTCOME_ID ?? "";
}

/**
 * Dùng agent v4 làm bộ máy nghiên cứu cho job `deep_plan` của v1.
 *
 * CỜ RIÊNG, cố ý tách khỏi `ZINO_OUTCOME_ENABLED`. Hai thứ khác nhau:
 *
 *   ZINO_OUTCOME_ENABLED     → hành trình nhiều lượt hút tin nhắn vào agent
 *   ZINO_DEEP_PLAN_VIA_AGENT → chỉ mượn sức nghiên cứu, chạy nền, một chiều
 *
 * Tách ra để có được thứ tốt nhất của cả hai: v1 giữ nguyên vai cửa trước với
 * 21 tool và toàn bộ tích hợp DB, còn phần nghiên cứu sâu — có evidence, có
 * inventory thật, có deep link — thì giao cho agent đã dựng sẵn trên Console.
 *
 * Không có hành trình để mà kẹt, vì `deep_plan` xưa nay đã là job nền một
 * chiều: agent nhận việc, chạy xong tự đẩy kết quả về nhóm.
 */
export function deepPlanViaAgent(): boolean {
  return process.env.ZINO_DEEP_PLAN_VIA_AGENT === "1" && Boolean(outcomeAgentId());
}

/**
 * Trần thời gian một lượt.
 *
 * §9 nói rapid research là mặc định và một user turn gọi tối đa MỘT Brain run.
 * Nhưng chưa ai đo bản v4; số duy nhất có thật là Brain đơn lẻ chạy 155s và
 * 205s ngày 29/07. Để rộng 180s cho tới khi có số đo — cắt ngang một lượt
 * research là kiểu hỏng tệ nhất: tốn tiền, mất kết quả, user nhận câu xin lỗi.
 *
 * Đo xong thấy dưới 60s thì hạ bằng `.env`, không cần build lại.
 */
export const OUTCOME_TIMEOUT_MS = envInt("ZINO_OUTCOME_TIMEOUT_MS", 180_000);

/**
 * Khoá phụ trong `pipeline_runs.agent_sessions` giữ session của hành trình.
 *
 * Tái dùng bảng `pipeline_runs` thay vì thêm bảng mới: nó đã có
 * `conversation_id`, `agent_sessions`, và partial unique index bảo đảm mỗi hội
 * thoại chỉ một hành trình đang mở — đúng thứ §9 yêu cầu ("chỉ một active run
 * trên mỗi conversation"), miễn phí.
 */
export const OUTCOME_SESSION_KEY = "OUTCOME";

/**
 * Đánh dấu run thuộc kiến trúc v4, để hệ ba agent v7 không nhận nhầm.
 *
 * Nếu ai đó bật lại `ZINO_V7_ENABLED=1` trong lúc có hành trình v4 đang mở,
 * `V7Service.findActive` sẽ thấy dòng đó và bắt đầu hút mọi tin nhắn vào Intake
 * — đúng cái bẫy đã cắn sáng 29/07. Một ký tự ở cột `stage` chặn được.
 */
export const OUTCOME_STAGE = "O";

/**
 * Output rỗng là lỗi thật, không phải câu trả lời ngắn.
 *
 * Đây là phép kiểm DUY NHẤT còn lại. §10 nói backend không cần hiểu lỗi nghiệp
 * vụ trong text — agent tự trình bày phần chưa xác minh. Nhưng chuỗi rỗng thì
 * không có gì để hiển thị, và im lặng là kiểu hỏng tệ nhất trong chat.
 */
export function assertNonEmptyReply(raw: string): string {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error("Outcome Agent trả về chuỗi rỗng");
  return text;
}

/** §10 — tin dự phòng khi hạ tầng lỗi. Không được claim research đã xong. */
export const OUTCOME_FALLBACK_MESSAGE =
  "Mình chưa hoàn tất được bước này do kết nối bị gián đoạn. Bạn gửi lại tin nhắn vừa rồi nhé.";

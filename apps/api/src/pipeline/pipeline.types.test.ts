import { describe, expect, it } from "vitest";
import { parseCandidate } from "../zalo/zalo.controller";
import { extractJson, parseStageOutput, StageOutputError } from "./pipeline.types";

/**
 * Hai hàm thuần này là chỗ dễ vỡ nhất của pipeline:
 *  • parseStageOutput — lớp phòng thủ DUY NHẤT trước việc Managed Agents không
 *    đảm bảo JSON (define-outcomes chỉ chấm rubric, không ép schema)
 *  • parseCandidate — quyết định tin nhắn nào bị pipeline "cướp" khỏi
 *    AgentService. Nhận dạng lỏng quá là bot ngừng trả lời chuyện khác.
 */

describe("extractJson", () => {
  it("JSON thuần", () => {
    expect(extractJson('{"status":"blocked"}')).toEqual({ status: "blocked" });
  });

  it("bọc trong ```json — kiểu agent hay trả", () => {
    const raw = '```json\n{"status":"ready_for_scout","message_to_user":"ok"}\n```';
    expect(extractJson(raw)).toEqual({ status: "ready_for_scout", message_to_user: "ok" });
  });

  it("có câu dẫn trước và sau JSON", () => {
    const raw = 'Đây là kết quả:\n{"status":"options_ready"}\nMong là hữu ích!';
    expect(extractJson(raw)).toEqual({ status: "options_ready" });
  });

  it("không có JSON → null", () => {
    expect(extractJson("mình chưa tìm được gì cả")).toBeNull();
  });
});

describe("parseStageOutput", () => {
  it("giữ nguyên field domain, không bóc", () => {
    const out = parseStageOutput(
      "A",
      '{"status":"ready_for_scout","message_to_user":"ok nha","brief":{"dest":"Đà Lạt"},"shopping_list":[1]}'
    );
    expect(out.status).toBe("ready_for_scout");
    expect(out.brief).toEqual({ dest: "Đà Lạt" });
    expect(out.shopping_list).toEqual([1]);
  });

  it("message_to_user = null là hợp lệ", () => {
    const out = parseStageOutput("B", '{"status":"ready_for_composer","message_to_user":null}');
    expect(out.message_to_user).toBeNull();
  });

  it("thiếu message_to_user → coi như null, không ném", () => {
    const out = parseStageOutput("C", '{"status":"options_ready"}');
    expect(out.message_to_user).toBeNull();
  });

  it("\\n trong JSON thành xuống dòng thật sau khi parse", () => {
    const out = parseStageOutput("C", '{"status":"options_ready","message_to_user":"1\\n2"}');
    expect(out.message_to_user).toBe("1\n2");
    expect(out.message_to_user).not.toContain("\\n");
  });

  it("status không thuộc enum của stage → ném", () => {
    // options_ready là của C, không phải của A
    expect(() => parseStageOutput("A", '{"status":"options_ready"}')).toThrow(StageOutputError);
  });

  it("status của stage khác không lọt qua", () => {
    expect(() => parseStageOutput("C", '{"status":"needs_user_input"}')).toThrow(StageOutputError);
  });

  it("không phải JSON → ném", () => {
    expect(() => parseStageOutput("A", "xin lỗi mình chưa làm được")).toThrow(StageOutputError);
  });
});

describe("parseCandidate", () => {
  it.each([
    ["2", "candidate_02"],
    ["chọn 3", "candidate_03"],
    ["  1  ", "candidate_01"],
    ["ok 2 nha", "candidate_02"],
    ["1️⃣", "candidate_01"],
    ["candidate_02", "candidate_02"],
    ["cand_A", "cand_a"]
  ])("%s → %s", (input, expected) => {
    expect(parseCandidate(input)).toBe(expected);
  });

  it.each([
    "2 đứa nữa đi cùng nhé",
    "cho mình thêm 3 người",
    "ai trả tiền cà phê hôm qua",
    "nhắc tao 7h sáng mai",
    ""
  ])("KHÔNG cướp tin nhắn thường: %s", (input) => {
    expect(parseCandidate(input)).toBeNull();
  });
});

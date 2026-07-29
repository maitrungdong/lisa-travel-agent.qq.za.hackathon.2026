import { describe, expect, it } from "vitest";
import { applyStatePatch, get } from "./state-patch";
import {
  looksLikeResearchTrigger,
  parseAgentJson,
  V7ValidationError,
  validateBrain,
  validateFinalizer,
  validateIntake
} from "./v7.types";

/**
 * Ba thứ được test ở đây là ba chỗ hỏng thì hỏng âm thầm:
 *
 *  • applyStatePatch — sai luật gộp thì state trôi dần qua từng lượt, và triệu
 *    chứng chỉ hiện ra vài lượt sau khi Intake hiểu nhầm ngữ cảnh.
 *  • validateIntake — đây là CỔNG duy nhất chặn Brain chạy oan. Brain là thứ
 *    đắt và chậm nhất hệ thống.
 *  • parseAgentJson — v7 §3.2 bảo từ chối code fence, nhưng agent thật vẫn bọc.
 */

describe("applyStatePatch — v7 §3.4", () => {
  it("object gộp đệ quy", () => {
    const out = applyStatePatch(
      { active_flow: { stage: "idle", scope_version: 1 }, other: true },
      { active_flow: { stage: "research_running" } }
    );
    expect(out.active_flow).toEqual({ stage: "research_running", scope_version: 1 });
    expect(out.other).toBe(true);
  });

  it("array THAY THẾ, không nối", () => {
    const out = applyStatePatch({ options: [{ id: 1 }, { id: 2 }] }, { options: [{ id: 9 }] });
    expect(out.options).toEqual([{ id: 9 }]);
  });

  it("null XOÁ field, không phải gán null", () => {
    const out = applyStatePatch({ selected_option: "option_02", keep: 1 }, { selected_option: null });
    expect("selected_option" in out).toBe(false);
    expect(out.keep).toBe(1);
  });

  it("field vắng mặt thì giữ nguyên", () => {
    const out = applyStatePatch({ a: 1, b: 2 }, { a: 10 });
    expect(out).toEqual({ a: 10, b: 2 });
  });

  it("không sửa state cũ tại chỗ", () => {
    const before = { active_flow: { stage: "idle" } };
    applyStatePatch(before, { active_flow: { stage: "completed" } });
    expect(before.active_flow.stage).toBe("idle");
  });

  it("state rỗng / patch rác không làm vỡ", () => {
    expect(applyStatePatch(null, { a: 1 })).toEqual({ a: 1 });
    expect(applyStatePatch({ a: 1 }, "không phải object")).toEqual({ a: 1 });
  });

  it("get đọc field lồng nhau an toàn", () => {
    const s = { active_flow: { stage: "selected" } };
    expect(get(s, "active_flow.stage")).toBe("selected");
    expect(get(s, "active_flow.khong_co")).toBeUndefined();
    expect(get(s, "a.b.c.d")).toBeUndefined();
  });
});

describe("looksLikeResearchTrigger — v7 §2.5", () => {
  it.each(["BẮT ĐẦU RESEARCH", "  bắt đầu research  ", "Bắt Đầu Research.", "BẮT ĐẦU RESEARCH!"])(
    "nhận: %s",
    (s) => expect(looksLikeResearchTrigger(s)).toBe(true)
  );

  it.each(["ok", "xác nhận", "làm đi", "triển khai đi", "bắt đầu", "research", "bắt đầu research đi"])(
    "TỪ CHỐI: %s",
    (s) => expect(looksLikeResearchTrigger(s)).toBe(false)
  );
});

describe("parseAgentJson", () => {
  it("bóc được ```json dù prompt cấm — agent thật vẫn bọc", () => {
    const o = parseAgentJson("INTAKE", '```json\n{"status":"delivered"}\n```');
    expect(o.status).toBe("delivered");
  });

  it("không có JSON thì ném", () => {
    expect(() => parseAgentJson("BRAIN", "xin lỗi mình chưa làm được")).toThrow(V7ValidationError);
  });
});

describe("validateIntake — CỔNG chặn Brain chạy oan (§6.9)", () => {
  const gate = {
    status: "ready_for_brain",
    route: { target: "brain" },
    handoff: {
      brief_complete: true,
      missing_blockers: [],
      owner_confirmation: "confirmed",
      scope_summary: "Đà Lạt 8-10/8, 4 người"
    },
    message_to_user: null
  };

  it("cổng đủ điều kiện thì cho qua", () => {
    expect(validateIntake({ ...gate }).route.target).toBe("brain");
  });

  it.each([
    ["message_to_user không null", { message_to_user: "chào bạn" }],
    ["brief_complete false", { handoff: { ...gate.handoff, brief_complete: false } }],
    ["còn blocker", { handoff: { ...gate.handoff, missing_blockers: ["budget"] } }],
    ["chưa confirm", { handoff: { ...gate.handoff, owner_confirmation: "pending" } }],
    ["scope_summary rỗng", { handoff: { ...gate.handoff, scope_summary: "" } }]
  ])("CHẶN khi %s", (_label, override) => {
    expect(() => validateIntake({ ...gate, ...override })).toThrow(V7ValidationError);
  });

  it("deliver mà message rỗng thì chặn — user sẽ không nhận được gì", () => {
    expect(() =>
      validateIntake({ status: "delivered", route: { target: "deliver" }, message_to_user: "" })
    ).toThrow(V7ValidationError);
  });

  it("target lạ thì chặn", () => {
    expect(() => validateIntake({ route: { target: "brain_v2" }, message_to_user: null })).toThrow(
      V7ValidationError
    );
  });
});

describe("validateBrain / validateFinalizer — §10.2, §10.3", () => {
  /**
   * Test này TỪNG kỳ vọng "thiếu evidence thì chặn". Commit 5a2f531 cố ý nới
   * `validateBrain` sau khi đo thật: Brain chạy 155s, trả JSON hợp lệ nhưng
   * không có `evidence`/`quality` — bản cũ ném lỗi và vứt trọn 155 giây công
   * việc vì thiếu field mà backend KHÔNG ĐỌC (cả khối được chuyển thẳng sang
   * Finalizer). Test không được cập nhật theo nên đỏ từ đó.
   *
   * Giữ lại kỳ vọng cũ là bắt code quay về hành vi đã bị bác bỏ có lý do, nên
   * ở đây ghi lại đúng giao kèo hiện hành.
   */
  it("thiếu evidence/quality thì VẪN cho qua — backend không đọc hai field này", () => {
    const b = validateBrain({
      status: "ready_for_finalizer",
      draft_message_to_user: "x",
      quality: {}
    });
    expect(b.status).toBe("ready_for_finalizer");
  });

  it("thiếu status thì chặn", () => {
    expect(() => validateBrain({ draft_message_to_user: "x" })).toThrow(V7ValidationError);
  });

  it("KHÔNG có gì cho Finalizer soạn thì chặn", () => {
    expect(() => validateBrain({ status: "ready_for_finalizer", quality: {} })).toThrow(
      V7ValidationError
    );
  });

  it("chỉ có answer_payload cũng đủ — không bắt buộc phải là draft_message_to_user", () => {
    const b = validateBrain({ status: "ready_for_finalizer", answer_payload: { a: 1 } });
    expect(b.status).toBe("ready_for_finalizer");
  });

  it("Brain đủ field thì qua", () => {
    const b = validateBrain({
      status: "ready_for_finalizer",
      draft_message_to_user: "1. Phương án A",
      evidence: [],
      quality: { scope: "pass" }
    });
    expect(b.status).toBe("ready_for_finalizer");
  });

  it("Finalizer thiếu reply_contract thì chặn", () => {
    expect(() => validateFinalizer({ status: "ready", message_to_user: "xong" })).toThrow(
      V7ValidationError
    );
  });
});

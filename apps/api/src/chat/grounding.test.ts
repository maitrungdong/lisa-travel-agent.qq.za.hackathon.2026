import { describe, expect, it } from "vitest";
import {
  collectFactTokens,
  digitRuns,
  gateReply,
  hasWordAmount,
  normalizeThousands,
  verifyGrounded
} from "./grounding";

/** Kết quả tool giả lập — đúng hình dạng thật: có tiền, ngày, tên. */
const FACTS = {
  totalSpent: 8_300_000,
  budgetTotal: 9_000_000,
  // Giá trị DẪN XUẤT cũng phải nằm trong kết quả tool. Không có dòng này thì
  // model buộc phải tự trừ 9.000.000 − 8.300.000, và cổng sẽ chặn câu đúng.
  // Nguyên tắc: model không làm phép tính, tool trả sẵn mọi số cần nói.
  budgetRemaining: 700_000,
  memberCount: 3,
  unpaid: [{ fromName: "Linh", toName: "Đông", amount: 2_066_666 }],
  events: [{ id: 42, title: "Nhận phòng Malibu", startsAt: "2026-08-12T07:00:00.000Z" }]
};

const FALLBACK = "Mình soát xong: 1 việc cần xử lý ngay.";

describe("digitRuns", () => {
  it("quy mọi cách viết tiền về cùng một dạng", () => {
    expect(digitRuns("8.300.000đ")).toEqual(["8300000"]);
    expect(digitRuns("8300000")).toEqual(["8300000"]);
    expect(digitRuns("8,300,000")).toEqual(["8300000"]);
  });

  it("bỏ số 0 ở đầu để 05:15 khớp với 5 và 15", () => {
    expect(digitRuns("05:15")).toEqual(["5", "15"]);
  });

  it("chuỗi không có số trả về rỗng", () => {
    expect(digitRuns("không có gì")).toEqual([]);
  });
});

describe("normalizeThousands", () => {
  it("gộp nhiều dấu ngăn trong cùng một số", () => {
    expect(normalizeThousands("8.300.000")).toBe("8300000");
  });

  it("không đụng vào số thập phân hay giờ", () => {
    expect(normalizeThousands("05:15")).toBe("05:15");
    expect(normalizeThousands("1.5")).toBe("1.5");
  });
});

describe("collectFactTokens", () => {
  it("gom được số từ mọi tầng của object", () => {
    const t = collectFactTokens(FACTS);
    expect(t.has("8300000")).toBe(true);
    expect(t.has("2066666")).toBe(true);
    expect(t.has("42")).toBe(true);
  });

  it("không sập với giá trị lạ", () => {
    expect(() => collectFactTokens(undefined)).not.toThrow();
    expect(() => collectFactTokens(null)).not.toThrow();
  });
});

describe("verifyGrounded", () => {
  it("cho qua con số đúng bằng dữ liệu", () => {
    expect(verifyGrounded("Cả nhóm đã tiêu 8300000đ", FACTS).ok).toBe(true);
  });

  it("cho qua khi viết có dấu chấm ngăn nghìn", () => {
    expect(verifyGrounded("Cả nhóm đã tiêu 8.300.000đ", FACTS).ok).toBe(true);
  });

  it("CHẶN số bịa kể cả khi có dấu ngăn nghìn — đây là lỗi test đã bắt được", () => {
    const r = verifyGrounded("Cả nhóm đã tiêu 8.500.000đ", FACTS);
    expect(r.ok).toBe(false);
    expect(r.ungrounded).toContain("8500000");
  });

  it("CHẶN con số bịa", () => {
    const r = verifyGrounded("Cả nhóm đã tiêu 8500000đ", FACTS);
    expect(r.ok).toBe(false);
    expect(r.ungrounded).toContain("8500000");
  });

  it("chặn số tiền bịa kể cả khi câu còn lại đúng hết", () => {
    const r = verifyGrounded("Linh chuyển 2999999 cho Đông, còn lại thì ổn", FACTS);
    expect(r.ok).toBe(false);
  });

  it("cho qua số đếm nhỏ mà model tự đếm từ danh sách", () => {
    expect(verifyGrounded("Có 2 việc cần làm và 1 chỗ nên xem lại", FACTS).ok).toBe(true);
  });

  it("câu không có số thì luôn qua", () => {
    expect(verifyGrounded("Chuyến này ổn, không có gì đáng lo.", FACTS).ok).toBe(true);
  });

  it("liệt kê từng số sai, không trùng lặp", () => {
    const r = verifyGrounded("Tiêu 8500000 và còn 7777777, tổng 8500000", FACTS);
    expect(r.ungrounded.sort()).toEqual(["7777777", "8500000"]);
  });
});

describe("hasWordAmount", () => {
  it("bắt tiền viết bằng chữ", () => {
    expect(hasWordAmount("khoảng 8 triệu rưỡi")).toBe(true);
    expect(hasWordAmount("hai trăm nghìn")).toBe(true);
  });

  it("không nhầm với câu thường", () => {
    expect(hasWordAmount("Cả nhóm đã tiêu 8300000đ")).toBe(false);
  });
});

describe("gateReply", () => {
  it("cho qua câu sạch", () => {
    const r = gateReply("Cả nhóm đã tiêu 8300000đ, còn 700000.", FACTS, FALLBACK);
    expect(r.passed).toBe(true);
    expect(r.text).toContain("8300000");
  });

  it("CHẶN số model tự tính ra, kể cả khi phép tính đúng", () => {
    // 8.300.000 / 3 người = 2.766.666 — đúng về số học nhưng tool không trả về,
    // nên không kiểm được. Muốn nói con số này thì tool phải tính sẵn.
    const r = gateReply("Trung bình mỗi người 2766666đ", FACTS, FALLBACK);
    expect(r.passed).toBe(false);
  });

  it("thay bằng câu tất định khi có số bịa", () => {
    const r = gateReply("Cả nhóm đã tiêu 8500000đ", FACTS, FALLBACK);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe("ungrounded_number");
    expect(r.text).toBe(FALLBACK);
  });

  it("thay bằng câu tất định khi model viết tiền bằng chữ", () => {
    const r = gateReply("Cả nhóm tiêu khoảng 8 triệu rưỡi", FACTS, FALLBACK);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe("word_amount");
  });

  it("KHÔNG cố sửa câu của model — thay hẳn hoặc giữ nguyên", () => {
    const bad = "Tiêu 8500000đ nhé bạn";
    const r = gateReply(bad, FACTS, FALLBACK);
    expect(r.text).not.toContain("8500000");
    expect(r.text).toBe(FALLBACK);
  });

  it("câu rỗng cũng rơi về câu tất định", () => {
    expect(gateReply("   ", FACTS, FALLBACK).text).toBe(FALLBACK);
  });

  it("trả về danh sách số sai để ghi log truy vết", () => {
    const r = gateReply("Tiêu 8500000đ", FACTS, FALLBACK);
    expect(r.ungrounded).toEqual(["8500000"]);
  });
});

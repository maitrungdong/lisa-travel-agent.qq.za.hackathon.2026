import { describe, expect, it } from "vitest";
import { settleExpenses, splitEvenly, type ExpenseInput, type MemberInput, type SettleResult } from "./settle";

/* ============================================================================
 * Tiện ích dùng chung cho test
 * ========================================================================== */

const member = (id: string, name: string): MemberInput => ({ zaloUserId: id, displayName: name });

const expense = (
  id: number,
  title: string,
  amount: number,
  paidBy: string,
  splits?: ExpenseInput["splits"]
): ExpenseInput => ({ id, title, amount, paidBy, splits });

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Tổng số tiền các con nợ phải trả (= tổng số tiền chủ nợ phải nhận) */
const totalDebt = (r: SettleResult): number => sum(r.perMember.filter((m) => m.net > 0).map((m) => m.net));

/** Bất biến bắt buộc đúng với MỌI đầu vào hợp lệ */
function expectInvariants(r: SettleResult, memberCount: number): void {
  // Tổng net luôn = 0 (tiền không tự sinh ra cũng không bốc hơi)
  expect(sum(r.perMember.map((m) => m.net))).toBe(0);
  // Tổng chuyển khoản khớp chính xác tổng nợ (sau khi dồn sai số làm tròn)
  expect(sum(r.settlements.map((s) => s.amount))).toBe(totalDebt(r));
  // Số giao dịch tối thiểu: không bao giờ vượt n-1
  expect(r.settlements.length).toBeLessThanOrEqual(Math.max(0, memberCount - 1));
  // Không ai vừa trả vừa nhận
  const payers = new Set(r.settlements.map((s) => s.from));
  const receivers = new Set(r.settlements.map((s) => s.to));
  for (const p of payers) expect(receivers.has(p)).toBe(false);
  // Không có giao dịch 0đ hoặc âm
  for (const s of r.settlements) expect(s.amount).toBeGreaterThan(0);
  // Không ai tự chuyển cho chính mình
  for (const s of r.settlements) expect(s.from).not.toBe(s.to);
}

/* ============================================================================
 * splitEvenly — nền móng của mọi phép chia
 * ========================================================================== */

describe("splitEvenly", () => {
  it("chia hết thì mọi người bằng nhau", () => {
    expect(splitEvenly(90_000, 3)).toEqual([30_000, 30_000, 30_000]);
  });

  it("chia không hết thì dồn dư vào người đầu, tổng vẫn khớp chính xác", () => {
    expect(splitEvenly(100_000, 3)).toEqual([33_334, 33_333, 33_333]);
    expect(sum(splitEvenly(100_000, 3))).toBe(100_000);
  });

  it("dư nhiều hơn 1 thì rải dần từ đầu", () => {
    // 100.000 / 7 = 14.285 dư 5 → 5 người đầu nhận thêm 1đ
    expect(splitEvenly(100_000, 7)).toEqual([14_286, 14_286, 14_286, 14_286, 14_286, 14_285, 14_285]);
    expect(sum(splitEvenly(100_000, 7))).toBe(100_000);
  });

  it("parts <= 0 trả mảng rỗng thay vì chia cho 0", () => {
    expect(splitEvenly(1_000, 0)).toEqual([]);
    expect(splitEvenly(1_000, -3)).toEqual([]);
  });
});

/* ============================================================================
 * settleExpenses
 * ========================================================================== */

describe("settleExpenses — nhóm 2 người, 1 khoản", () => {
  const members = [member("u1", "Đông"), member("u2", "Mai")];
  const r = settleExpenses([expense(1, "Vé máy bay", 200_000, "u1")], members);

  it("cộng sổ đúng", () => {
    expect(r.totalSpent).toBe(200_000);
    expect(r.perMember).toEqual([
      { zaloUserId: "u1", displayName: "Đông", paid: 200_000, owed: 100_000, net: 100_000 },
      { zaloUserId: "u2", displayName: "Mai", paid: 0, owed: 100_000, net: -100_000 }
    ]);
  });

  it("sinh đúng 1 giao dịch, không cần làm tròn", () => {
    expect(r.settlements).toEqual([
      { from: "u2", fromName: "Mai", to: "u1", toName: "Đông", amount: 100_000 }
    ]);
    expect(r.roundingAdjustment).toBe(0);
    expect(r.warnings).toEqual([]);
    expectInvariants(r, members.length);
  });
});

describe("settleExpenses — nhóm 3 người, 100.000đ chia không hết", () => {
  const members = [member("u1", "Đông"), member("u2", "Mai"), member("u3", "Nam")];
  const r = settleExpenses([expense(1, "Cà phê", 100_000, "u1")], members);

  it("phần chịu là 33.334 / 33.333 / 33.333 và tổng khớp chính xác", () => {
    expect(r.perMember.map((m) => m.owed)).toEqual([33_334, 33_333, 33_333]);
    expect(sum(r.perMember.map((m) => m.owed))).toBe(100_000);
    expect(r.perMember.map((m) => m.net)).toEqual([66_666, -33_333, -33_333]);
  });

  it("làm tròn lên 1000 rồi dồn sai số vào giao dịch lớn nhất", () => {
    // raw: 33.333 + 33.333 = 66.666 → làm tròn lên: 34.000 + 34.000 = 68.000
    // dôi 1.334 bị trừ khỏi giao dịch lớn nhất (giao dịch đầu, sort ổn định)
    expect(r.roundingAdjustment).toBe(1_334);
    expect(r.settlements).toEqual([
      { from: "u2", fromName: "Mai", to: "u1", toName: "Đông", amount: 32_666 },
      { from: "u3", fromName: "Nam", to: "u1", toName: "Đông", amount: 34_000 }
    ]);
    expect(sum(r.settlements.map((s) => s.amount))).toBe(66_666);
    expectInvariants(r, members.length);
  });
});

describe("settleExpenses — nhóm 4 người, nhiều khoản, nhiều người trả", () => {
  const members = [member("u1", "Đông"), member("u2", "Mai"), member("u3", "Nam"), member("u4", "Linh")];
  const r = settleExpenses(
    [
      expense(1, "Khách sạn", 400_000, "u1"),
      expense(2, "Ăn tối", 200_000, "u2"),
      expense(3, "Taxi", 120_000, "u3")
    ],
    members
  );

  it("mỗi người chịu 180.000đ", () => {
    expect(r.totalSpent).toBe(720_000);
    expect(r.perMember.map((m) => m.owed)).toEqual([180_000, 180_000, 180_000, 180_000]);
    expect(r.perMember.map((m) => m.net)).toEqual([220_000, 20_000, -60_000, -180_000]);
  });

  it("greedy khớp lớn-nhất-với-lớn-nhất, tối đa n-1 giao dịch", () => {
    expect(r.settlements).toEqual([
      { from: "u4", fromName: "Linh", to: "u1", toName: "Đông", amount: 180_000 },
      { from: "u3", fromName: "Nam", to: "u1", toName: "Đông", amount: 40_000 },
      { from: "u3", fromName: "Nam", to: "u2", toName: "Mai", amount: 20_000 }
    ]);
    expect(r.settlements.length).toBe(3);
    expect(r.roundingAdjustment).toBe(0);
    expectInvariants(r, members.length);
  });
});

describe("settleExpenses — custom splits", () => {
  const members = [member("u1", "Đông"), member("u2", "Mai"), member("u3", "Nam")];

  it("dùng đúng shareAmount đã khai báo", () => {
    const r = settleExpenses(
      [
        expense(1, "Bia", 300_000, "u1", [
          { memberZaloId: "u1", memberName: "Đông", shareAmount: 100_000 },
          { memberZaloId: "u2", memberName: "Mai", shareAmount: 200_000 }
        ])
      ],
      members
    );
    expect(r.perMember.map((m) => m.owed)).toEqual([100_000, 200_000, 0]);
    expect(r.settlements).toEqual([
      { from: "u2", fromName: "Mai", to: "u1", toName: "Đông", amount: 200_000 }
    ]);
    expect(r.warnings).toEqual([]);
    expectInvariants(r, members.length);
  });

  it("trộn khoản chia đều và khoản custom", () => {
    const r = settleExpenses(
      [
        expense(1, "Xăng xe", 300_000, "u1"),
        expense(2, "Vé vào cổng", 200_000, "u2", [
          { memberZaloId: "u2", shareAmount: 100_000 },
          { memberZaloId: "u3", shareAmount: 100_000 }
        ])
      ],
      members
    );
    expect(r.totalSpent).toBe(500_000);
    // u1: owed 100k | u2: 100k + 100k | u3: 100k + 100k
    expect(r.perMember.map((m) => m.owed)).toEqual([100_000, 200_000, 200_000]);
    expect(r.perMember.map((m) => m.net)).toEqual([200_000, 0, -200_000]);
    expect(r.settlements).toEqual([
      { from: "u3", fromName: "Nam", to: "u1", toName: "Đông", amount: 200_000 }
    ]);
    expectInvariants(r, members.length);
  });

  it("tổng shareAmount lệch với amount thì cảnh báo nhưng KHÔNG crash", () => {
    const r = settleExpenses(
      [
        expense(1, "Buffet", 300_000, "u1", [
          { memberZaloId: "u1", shareAmount: 100_000 },
          { memberZaloId: "u2", shareAmount: 150_000 }
        ])
      ],
      members
    );
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings.some((w) => w.includes("Buffet"))).toBe(true);
    expect(r.totalSpent).toBe(300_000);
    // Vẫn tính bình thường theo phần đã khai báo
    expect(r.perMember.map((m) => m.owed)).toEqual([100_000, 150_000, 0]);
    expect(r.settlements).toEqual([
      { from: "u2", fromName: "Mai", to: "u1", toName: "Đông", amount: 150_000 }
    ]);
  });

  it("splits rỗng được coi như chia đều", () => {
    const r = settleExpenses([expense(1, "Nước", 90_000, "u1", [])], members);
    expect(r.perMember.map((m) => m.owed)).toEqual([30_000, 30_000, 30_000]);
  });
});

describe("settleExpenses — người không tiêu gì", () => {
  const members = [member("u1", "Đông"), member("u2", "Mai"), member("u3", "Nam")];

  it("người ngoài mọi khoản chi có net = 0 và không xuất hiện trong giao dịch", () => {
    const r = settleExpenses(
      [
        expense(1, "Lẩu", 90_000, "u1", [
          { memberZaloId: "u1", shareAmount: 45_000 },
          { memberZaloId: "u2", shareAmount: 45_000 }
        ])
      ],
      members
    );
    const nam = r.perMember.find((m) => m.zaloUserId === "u3");
    expect(nam).toEqual({ zaloUserId: "u3", displayName: "Nam", paid: 0, owed: 0, net: 0 });
    expect(r.settlements.some((s) => s.from === "u3" || s.to === "u3")).toBe(false);
    expectInvariants(r, members.length);
  });

  it("người có mặt nhưng chưa trả đồng nào vẫn phải chia tiền", () => {
    const r = settleExpenses([expense(1, "Grab", 60_000, "u1")], members);
    expect(r.perMember.map((m) => m.paid)).toEqual([60_000, 0, 0]);
    expect(r.perMember.map((m) => m.owed)).toEqual([20_000, 20_000, 20_000]);
    expect(r.settlements.length).toBe(2);
  });
});

describe("settleExpenses — không cần giao dịch nào", () => {
  it("tất cả trả bằng nhau → 0 giao dịch", () => {
    const members = [member("u1", "Đông"), member("u2", "Mai")];
    const r = settleExpenses(
      [expense(1, "Sáng", 100_000, "u1"), expense(2, "Tối", 100_000, "u2")],
      members
    );
    expect(r.perMember.map((m) => m.net)).toEqual([0, 0]);
    expect(r.settlements).toEqual([]);
    expect(r.roundingAdjustment).toBe(0);
    expectInvariants(r, members.length);
  });

  it("chưa có khoản chi nào", () => {
    const members = [member("u1", "Đông"), member("u2", "Mai")];
    const r = settleExpenses([], members);
    expect(r.totalSpent).toBe(0);
    expect(r.settlements).toEqual([]);
    expectInvariants(r, members.length);
  });

  it("mỗi người tự trả phần của mình qua splits → 0 giao dịch", () => {
    const members = [member("u1", "Đông"), member("u2", "Mai"), member("u3", "Nam")];
    const r = settleExpenses(
      [
        expense(1, "Vé u1", 50_000, "u1", [{ memberZaloId: "u1", shareAmount: 50_000 }]),
        expense(2, "Vé u2", 70_000, "u2", [{ memberZaloId: "u2", shareAmount: 70_000 }]),
        expense(3, "Vé u3", 90_000, "u3", [{ memberZaloId: "u3", shareAmount: 90_000 }])
      ],
      members
    );
    expect(r.settlements).toEqual([]);
    expectInvariants(r, members.length);
  });
});

describe("settleExpenses — số lớn (chục triệu)", () => {
  const members = [member("u1", "Đông"), member("u2", "Mai"), member("u3", "Nam")];
  const r = settleExpenses(
    [
      expense(1, "Vé máy bay cả nhóm", 25_000_000, "u1"),
      expense(2, "Resort 3 đêm", 12_500_000, "u2"),
      expense(3, "Thuê xe", 7_000_000, "u3")
    ],
    members
  );

  it("không mất đồng nào khi chia số lớn không chia hết", () => {
    expect(r.totalSpent).toBe(44_500_000);
    expect(sum(r.perMember.map((m) => m.owed))).toBe(44_500_000);
    expect(r.perMember.map((m) => m.owed)).toEqual([14_833_335, 14_833_333, 14_833_332]);
    expect(r.perMember.map((m) => m.net)).toEqual([10_166_665, -2_333_333, -7_833_332]);
  });

  it("giao dịch được làm tròn nghìn, chỉ 1 giao dịch gánh phần lẻ", () => {
    expectInvariants(r, members.length);
    expect(sum(r.settlements.map((s) => s.amount))).toBe(10_166_665);
    const notRounded = r.settlements.filter((s) => s.amount % 1000 !== 0);
    expect(notRounded.length).toBeLessThanOrEqual(1);
    expect(r.roundingAdjustment).toBeGreaterThan(0);
    expect(r.roundingAdjustment).toBeLessThan(1000 * r.settlements.length);
  });
});

describe("settleExpenses — dữ liệu bẩn không làm sập hàm", () => {
  it("người trả không có trong danh sách thành viên vẫn được ghi sổ", () => {
    const members = [member("u1", "Đông"), member("u2", "Mai")];
    const r = settleExpenses(
      [{ id: 1, title: "Kem", amount: 100_000, paidBy: "u9", paidByName: "Khách" }],
      members
    );
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.perMember.map((m) => m.zaloUserId)).toEqual(["u1", "u2", "u9"]);
    // Vẫn giữ bất biến tổng net = 0
    expect(sum(r.perMember.map((m) => m.net))).toBe(0);
    expect(sum(r.settlements.map((s) => s.amount))).toBe(totalDebt(r));
  });

  it("amount không hợp lệ bị bỏ qua kèm cảnh báo", () => {
    const members = [member("u1", "Đông"), member("u2", "Mai")];
    const r = settleExpenses(
      [expense(1, "Lỗi", 0, "u1"), expense(2, "Âm", -5_000, "u1"), expense(3, "Ổn", 50_000, "u1")],
      members
    );
    expect(r.totalSpent).toBe(50_000);
    expect(r.warnings.length).toBe(2);
    expect(r.settlements).toEqual([
      { from: "u2", fromName: "Mai", to: "u1", toName: "Đông", amount: 25_000 }
    ]);
  });

  it("không có thành viên nào thì người trả tự chịu", () => {
    const r = settleExpenses([expense(1, "Một mình", 100_000, "u1")], []);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.settlements).toEqual([]);
    expect(sum(r.perMember.map((m) => m.net))).toBe(0);
  });
});

/* ============================================================================
 * Property test — bất biến phải đúng với dữ liệu ngẫu nhiên
 * ========================================================================== */

/** PRNG tất định (mulberry32) để test lặp lại được */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("settleExpenses — property test", () => {
  it("tổng net luôn = 0 và tổng chuyển khoản luôn khớp tổng nợ (200 ca ngẫu nhiên)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rng = makeRng(seed);
      const memberCount = 2 + Math.floor(rng() * 7); // 2..8 người
      const members: MemberInput[] = [];
      for (let i = 0; i < memberCount; i++) members.push(member(`u${i}`, `Người ${i}`));

      const expenseCount = Math.floor(rng() * 13); // 0..12 khoản
      const expenses: ExpenseInput[] = [];
      for (let i = 0; i < expenseCount; i++) {
        const amount = 1_000 + Math.floor(rng() * 50_000_000);
        const payer = members[Math.floor(rng() * memberCount)].zaloUserId;
        if (rng() < 0.25) {
          // 25% dùng custom splits hợp lệ (tổng share = amount)
          const shares = splitEvenly(amount, memberCount);
          expenses.push(
            expense(
              i,
              `Khoản ${i}`,
              amount,
              payer,
              members.map((m, idx) => ({ memberZaloId: m.zaloUserId, shareAmount: shares[idx] }))
            )
          );
        } else {
          expenses.push(expense(i, `Khoản ${i}`, amount, payer));
        }
      }

      const r = settleExpenses(expenses, members);
      expect(r.warnings).toEqual([]);
      expect(r.totalSpent).toBe(sum(expenses.map((e) => e.amount)));
      expect(sum(r.perMember.map((m) => m.owed))).toBe(r.totalSpent);
      expect(sum(r.perMember.map((m) => m.paid))).toBe(r.totalSpent);
      expectInvariants(r, memberCount);
    }
  });
});

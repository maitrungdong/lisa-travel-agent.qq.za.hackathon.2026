import { describe, expect, it } from "vitest";
import {
  applyEditRules,
  canDelete,
  canEdit,
  editableFields,
  isRealTransaction,
  mockTxnCode,
  type ExpenseLike
} from "./expense-rules";

const userExpense: ExpenseLike = {
  source: "user",
  txnCode: null,
  createdBy: "u3",
  paidBy: "u3"
};

const zinoPaid: ExpenseLike = {
  source: "zino",
  txnCode: "ZP-8842",
  createdBy: null,
  paidBy: "u1"
};

/** Zino tạo nhưng CHƯA thanh toán — chưa phải giao dịch thật. */
const zinoPending: ExpenseLike = {
  source: "zino",
  txnCode: null,
  createdBy: null,
  paidBy: "u1"
};

const ORGANIZER = { zaloUserId: "u1", role: "organizer" };
const CREATOR = { zaloUserId: "u3" };
const STRANGER = { zaloUserId: "u2" };

describe("isRealTransaction", () => {
  it("chỉ tính là giao dịch thật khi Zino tạo VÀ có mã giao dịch", () => {
    expect(isRealTransaction(zinoPaid)).toBe(true);
    expect(isRealTransaction(zinoPending)).toBe(false);
    expect(isRealTransaction({ ...userExpense, txnCode: "ZP-1" })).toBe(false);
  });
});

describe("editableFields", () => {
  it("khoản người dùng tạo: người tạo sửa được mọi thứ", () => {
    const f = editableFields(userExpense, CREATOR);
    expect([...f].sort()).toEqual(["amount", "category", "note", "paidBy", "split", "title"]);
  });

  it("người tổ chức sửa được mọi khoản, kể cả không phải mình tạo", () => {
    expect(canEdit(userExpense, ORGANIZER)).toBe(true);
  });

  it("người ngoài không sửa được khoản của người khác", () => {
    expect(editableFields(userExpense, STRANGER).size).toBe(0);
    expect(canEdit(userExpense, STRANGER)).toBe(false);
  });

  it("giao dịch thật: khoá số tiền và người trả, chỉ mở cách chia + ghi chú", () => {
    const f = editableFields(zinoPaid, ORGANIZER);
    expect([...f].sort()).toEqual(["note", "split"]);
    expect(f.has("amount")).toBe(false);
    expect(f.has("paidBy")).toBe(false);
  });

  it("Zino tạo nhưng chưa thanh toán thì vẫn sửa được số tiền", () => {
    expect(editableFields(zinoPending, ORGANIZER).has("amount")).toBe(true);
  });

  it("người ứng tiền cũng được sửa dù không phải người tạo", () => {
    const e: ExpenseLike = { source: "user", txnCode: null, createdBy: "u3", paidBy: "u2" };
    expect(canEdit(e, STRANGER)).toBe(true); // u2 là người trả
  });
});

describe("applyEditRules", () => {
  it("giữ trường được phép, trả lại danh sách trường bị chặn", () => {
    const r = applyEditRules(zinoPaid, ORGANIZER, {
      amount: 999,
      note: "chia lại cho 3 người",
      split: ["u1", "u2"]
    });
    expect(r.allowed).toEqual({ note: "chia lại cho 3 người", split: ["u1", "u2"] });
    expect(r.rejected).toEqual(["amount"]);
  });

  it("bỏ qua trường undefined, không coi là bị chặn", () => {
    const r = applyEditRules(userExpense, CREATOR, { amount: undefined, title: "Cà phê" });
    expect(r.allowed).toEqual({ title: "Cà phê" });
    expect(r.rejected).toEqual([]);
  });

  it("người không có quyền thì mọi trường đều bị chặn", () => {
    const r = applyEditRules(userExpense, STRANGER, { title: "x", amount: 1 });
    expect(r.allowed).toEqual({});
    expect(r.rejected.sort()).toEqual(["amount", "title"]);
  });
});

describe("canDelete", () => {
  it("không xoá được giao dịch thật", () => {
    expect(canDelete(zinoPaid, ORGANIZER)).toBe(false);
  });
  it("người tạo xoá được khoản của mình", () => {
    expect(canDelete(userExpense, CREATOR)).toBe(true);
  });
  it("người khác không xoá được", () => {
    expect(canDelete(userExpense, STRANGER)).toBe(false);
  });
});

describe("mockTxnCode", () => {
  it("có tiền tố ZP- và 4 số, nói rõ là mã mock", () => {
    expect(mockTxnCode(18842)).toBe("ZP-8842");
    expect(mockTxnCode(7)).toBe("ZP-0007");
  });
});

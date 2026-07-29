import { describe, expect, it } from "vitest";
import {
  describeProposal,
  normalizeEvent,
  normalizeExpense,
  normalizeNote,
  revalidate,
  type ProposalContext
} from "./proposals";

const ctx: ProposalContext = {
  tripStart: "2026-08-12T01:00:00.000Z",
  tripEnd: "2026-08-14T10:00:00.000Z",
  members: [
    { zaloUserId: "u1", displayName: "Đông" },
    { zaloUserId: "u2", displayName: "Đạt" },
    { zaloUserId: "u3", displayName: "Linh" }
  ],
  actorZaloId: "u1"
};

describe("normalizeExpense", () => {
  it("đủ thông tin thì qua, mặc định người trả là người đang chat", () => {
    const r = normalizeExpense({ title: "Ăn tối", amount: 350000, category: "food" }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      kind: "expense",
      title: "Ăn tối",
      amount: 350000,
      category: "food",
      paidBy: "u1",
      paidByName: "Đông",
      splitWith: []
    });
  });

  /**
   * Chốt chặn quan trọng nhất của cả file này. Model đọc "350k" từ câu nói của
   * người dùng — không phải từ tool — nên cổng kiểm chứng không đỡ được. Nếu nó
   * hiểu thành 350 thì khoản chi sai gấp nghìn lần mà không ai nhận ra.
   */
  it("chặn số tiền nhỏ bất thường — dấu hiệu model đọc nhầm đơn vị", () => {
    const r = normalizeExpense({ title: "Ăn tối", amount: 350 }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("350000");
  });

  it("chặn số tiền lớn bất thường", () => {
    const r = normalizeExpense({ title: "Ăn tối", amount: 900_000_000 }, ctx);
    expect(r.ok).toBe(false);
  });

  it("nhận người trả theo TÊN, không phân biệt hoa thường", () => {
    const r = normalizeExpense({ title: "Cà phê", amount: 90000, paidBy: "linh" }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ paidBy: "u3", paidByName: "Linh" });
  });

  it("người trả không có trong nhóm thì từ chối, kèm danh sách tên thật", () => {
    const r = normalizeExpense({ title: "Cà phê", amount: 90000, paidBy: "Hùng" }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("Đông");
  });

  it("chia riêng cho vài người thì quy tên về id và bỏ trùng", () => {
    const r = normalizeExpense(
      { title: "Taxi", amount: 200000, splitWith: ["Đông", "u1", "Đạt"] },
      ctx
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ splitWith: ["u1", "u2"] });
  });

  it("người trong danh sách chia không thuộc nhóm thì từ chối", () => {
    const r = normalizeExpense({ title: "Taxi", amount: 200000, splitWith: ["Ai đó"] }, ctx);
    expect(r.ok).toBe(false);
  });

  it("hạng mục lạ thì về 'other' chứ không văng", () => {
    const r = normalizeExpense({ title: "X", amount: 50000, category: "vũ trụ" }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ category: "other" });
  });

  it("thiếu tên hoặc thiếu tiền thì nói rõ thiếu gì để model hỏi lại", () => {
    expect(normalizeExpense({ amount: 50000 }, ctx)).toMatchObject({ ok: false });
    expect(normalizeExpense({ title: "X" }, ctx)).toMatchObject({ ok: false });
  });

  it("số tiền thập phân không được nhận — VND là số nguyên", () => {
    expect(normalizeExpense({ title: "X", amount: 350000.5 }, ctx)).toMatchObject({ ok: false });
  });
});

describe("normalizeNote", () => {
  it("qua khi có nội dung", () => {
    const r = normalizeNote({ content: "Mang kem chống nắng" });
    expect(r).toMatchObject({ ok: true });
  });

  it("rỗng hoặc chỉ khoảng trắng thì từ chối", () => {
    expect(normalizeNote({ content: "   " })).toMatchObject({ ok: false });
    expect(normalizeNote({})).toMatchObject({ ok: false });
  });

  it("loại ghi chú lạ thì về 'note'", () => {
    const r = normalizeNote({ content: "X", noteKind: "bí mật" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ noteKind: "note" });
  });
});

describe("normalizeEvent", () => {
  it("trong khoảng chuyến đi thì qua, thiếu giờ thì mặc định 09:00", () => {
    const r = normalizeEvent({ title: "Leo hải đăng", date: "2026-08-13" }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.kind).toBe("event");
    if (r.value.kind !== "event") return;
    expect(r.value.startsAt).toBe("2026-08-13T02:00:00.000Z"); // 09:00 giờ VN
  });

  /**
   * Cho qua thì `checkTrip` sẽ báo `event_outside_trip` ngay lượt soát kế tiếp
   * — Zino tự tạo việc cho mình rồi lại đi báo lỗi cho người dùng.
   */
  it("ngoài khoảng chuyến đi thì từ chối, nói rõ khoảng hợp lệ", () => {
    const r = normalizeEvent({ title: "X", date: "2026-09-01" }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("2026-08-12");
    expect(r.reason).toContain("2026-08-14");
  });

  it("ngày đầu và ngày cuối của chuyến đều hợp lệ", () => {
    expect(normalizeEvent({ title: "X", date: "2026-08-12" }, ctx)).toMatchObject({ ok: true });
    expect(normalizeEvent({ title: "X", date: "2026-08-14" }, ctx)).toMatchObject({ ok: true });
  });

  it("ngày hoặc giờ sai định dạng thì từ chối", () => {
    expect(normalizeEvent({ title: "X", date: "13/08/2026" }, ctx)).toMatchObject({ ok: false });
    expect(normalizeEvent({ title: "X", date: "2026-08-13", time: "9h" }, ctx)).toMatchObject({
      ok: false
    });
  });

  it("giờ được hiểu theo giờ VN, không phải UTC", () => {
    const r = normalizeEvent({ title: "X", date: "2026-08-13", time: "08:00" }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok || r.value.kind !== "event") return;
    expect(r.value.startsAt).toBe("2026-08-13T01:00:00.000Z");
  });
});

describe("revalidate — server không tin thẻ do client gửi lên", () => {
  it("đề xuất hợp lệ đi qua nguyên vẹn", () => {
    const p = { kind: "expense", title: "Ăn tối", amount: 350000, category: "food", paidBy: "u1" };
    expect(revalidate(p, ctx)).toMatchObject({ ok: true });
  });

  it("client sửa số tiền thành phi lý thì vẫn bị chặn ở server", () => {
    const p = { kind: "expense", title: "Ăn tối", amount: 999_999_999, paidBy: "u1" };
    expect(revalidate(p, ctx)).toMatchObject({ ok: false });
  });

  it("client đổi người trả thành người ngoài nhóm thì bị chặn", () => {
    const p = { kind: "expense", title: "X", amount: 50000, paidBy: "kẻ lạ" };
    expect(revalidate(p, ctx)).toMatchObject({ ok: false });
  });

  it("mục lịch trình bị client dời ra ngoài chuyến thì bị chặn", () => {
    const p = { kind: "event", title: "X", startsAt: "2026-12-25T02:00:00.000Z", eventKind: "activity" };
    expect(revalidate(p, ctx)).toMatchObject({ ok: false });
  });

  it("mục lịch trình hợp lệ giữ nguyên mốc thời gian sau khi đi vòng qua client", () => {
    const p = { kind: "event", title: "X", startsAt: "2026-08-13T01:00:00.000Z", eventKind: "food" };
    const r = revalidate(p, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok || r.value.kind !== "event") return;
    expect(r.value.startsAt).toBe("2026-08-13T01:00:00.000Z");
    expect(r.value.eventKind).toBe("food");
  });

  it("loại hành động lạ thì từ chối, không im lặng bỏ qua", () => {
    expect(revalidate({ kind: "delete_everything" }, ctx)).toMatchObject({ ok: false });
    expect(revalidate(null, ctx)).toMatchObject({ ok: false });
  });
});

describe("describeProposal", () => {
  it("thẻ khoản chi nêu đủ số tiền, người trả và ai chịu", () => {
    const r = normalizeExpense({ title: "Ăn tối", amount: 350000, category: "food" }, ctx);
    if (!r.ok) throw new Error("fixture sai");
    const d = describeProposal(r.value, ctx);
    expect(d.title).toContain("350.000₫");
    expect(d.detail).toContain("Đông");
    expect(d.detail).toContain("cả nhóm");
  });

  it("chia riêng thì hiện tên từng người, không nói 'cả nhóm'", () => {
    const r = normalizeExpense({ title: "Taxi", amount: 200000, splitWith: ["u2", "u3"] }, ctx);
    if (!r.ok) throw new Error("fixture sai");
    const d = describeProposal(r.value, ctx);
    expect(d.detail).toContain("Đạt, Linh");
    expect(d.detail).not.toContain("cả nhóm");
  });

  it("thẻ lịch trình hiện ngày giờ theo giờ VN", () => {
    const r = normalizeEvent({ title: "Leo hải đăng", date: "2026-08-13", time: "08:00" }, ctx);
    if (!r.ok) throw new Error("fixture sai");
    expect(describeProposal(r.value, ctx).detail).toContain("13/08 lúc 08:00");
  });
});

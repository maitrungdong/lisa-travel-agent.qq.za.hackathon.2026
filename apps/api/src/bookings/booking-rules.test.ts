import { describe, expect, it } from "vitest";
import {
  bookingsFromEvents,
  canTransition,
  nextActionLabel,
  nextStatus,
  summarize,
  transitionError,
  type EventLike
} from "./booking-rules";

describe("chuỗi trạng thái", () => {
  it("đi một chiều: chưa đặt → đã đặt → đã trả", () => {
    expect(nextStatus("to_book")).toBe("booked");
    expect(nextStatus("booked")).toBe("paid");
    expect(nextStatus("paid")).toBe(null);
  });

  it("huỷ rồi thì hết đường đi tiếp", () => {
    expect(nextStatus("cancelled")).toBe(null);
    expect(nextActionLabel("cancelled")).toBe(null);
  });

  it("nhãn nút nói rõ việc sắp làm", () => {
    expect(nextActionLabel("to_book")).toBe("Đánh dấu đã đặt");
    expect(nextActionLabel("booked")).toBe("Đánh dấu đã trả tiền");
    expect(nextActionLabel("paid")).toBe(null);
  });
});

describe("canTransition", () => {
  it("cho phép đúng một bước kế tiếp", () => {
    expect(canTransition("to_book", "booked")).toBe(true);
    expect(canTransition("booked", "paid")).toBe(true);
  });

  /**
   * Nhảy cóc thường là dấu hiệu client cũ hoặc bấm nhầm, và nó làm mất một mốc
   * trong lịch sử — sau này không ai biết khoản đó có thật sự được đặt hay
   * người ta chỉ trả tiền cho một chỗ chưa từng giữ.
   */
  it("KHÔNG cho nhảy cóc từ chưa đặt thẳng sang đã trả", () => {
    expect(canTransition("to_book", "paid")).toBe(false);
    expect(transitionError("to_book", "paid")).toContain("Chưa đặt");
  });

  it("KHÔNG cho lùi lại", () => {
    expect(canTransition("paid", "booked")).toBe(false);
    expect(canTransition("booked", "to_book")).toBe(false);
  });

  it("huỷ được từ mọi trạng thái đang sống", () => {
    expect(canTransition("to_book", "cancelled")).toBe(true);
    expect(canTransition("booked", "cancelled")).toBe(true);
    expect(canTransition("paid", "cancelled")).toBe(true);
  });

  it("đã huỷ thì không tự sống lại", () => {
    expect(canTransition("cancelled", "to_book")).toBe(false);
    expect(canTransition("cancelled", "booked")).toBe(false);
    expect(transitionError("cancelled", "booked")).toContain("tạo mục mới");
  });

  it("bấm lại đúng trạng thái đang có thì báo rõ, không âm thầm ghi đè", () => {
    expect(canTransition("booked", "booked")).toBe(false);
    expect(transitionError("booked", "booked")).toContain("Đã đặt");
  });
});

describe("summarize", () => {
  it("mục đã huỷ không tính vào mẫu số", () => {
    expect(summarize(["paid", "to_book", "cancelled"])).toEqual({
      total: 2,
      done: 1,
      todo: 1,
      percent: 50
    });
  });

  it("chưa có đặt chỗ nào thì 0%, không chia cho 0", () => {
    expect(summarize([])).toEqual({ total: 0, done: 0, todo: 0, percent: 0 });
    expect(summarize(["cancelled"])).toEqual({ total: 0, done: 0, todo: 0, percent: 0 });
  });

  it("xong hết là 100%", () => {
    expect(summarize(["paid", "paid"]).percent).toBe(100);
  });
});

function ev(over: Partial<EventLike> & { id: number }): EventLike {
  return {
    title: `Mục ${over.id}`,
    kind: "activity",
    startsAt: "2026-08-12T07:00:00.000Z",
    estimatedCost: null,
    location: null,
    ...over
  };
}

describe("bookingsFromEvents", () => {
  it("chỉ lấy mục cần đặt trước: chỗ ở, di chuyển, vé", () => {
    const r = bookingsFromEvents([
      ev({ id: 1, kind: "stay" }),
      ev({ id: 2, kind: "transport" }),
      ev({ id: 3, kind: "flight" }),
      ev({ id: 4, kind: "ticket" })
    ]);
    expect(r.map((b) => b.kind)).toEqual(["stay", "transport", "transport", "ticket"]);
  });

  /**
   * Đưa mọi mục vào thì màn Đặt chỗ đầy những dòng không bao giờ đổi trạng
   * thái, và thanh tiến độ vĩnh viễn không đầy — người dùng học được rằng con
   * số đó vô nghĩa rồi thôi không nhìn nữa.
   */
  it("BỎ QUA hoạt động và ăn uống — không ai đặt chỗ để đi ngắm bình minh", () => {
    const r = bookingsFromEvents([
      ev({ id: 1, kind: "activity" }),
      ev({ id: 2, kind: "food" }),
      ev({ id: 3, kind: "other" })
    ]);
    expect(r).toEqual([]);
  });

  it("không sinh lại mục đã có đặt chỗ", () => {
    const events = [ev({ id: 1, kind: "stay" }), ev({ id: 2, kind: "ticket" })];
    expect(bookingsFromEvents(events, [1]).map((b) => b.eventId)).toEqual([2]);
    expect(bookingsFromEvents(events, [1, 2])).toEqual([]);
  });

  it("cùng một mục xuất hiện hai lần trong input cũng chỉ ra một đặt chỗ", () => {
    const e = ev({ id: 1, kind: "stay" });
    expect(bookingsFromEvents([e, e])).toHaveLength(1);
  });

  it("mang theo giá ước tính, địa điểm và OA đối tác", () => {
    const r = bookingsFromEvents([
      ev({
        id: 1,
        kind: "stay",
        title: "Khách sạn Malibu",
        estimatedCost: 3600000,
        location: "Bãi Sau",
        partnerOaId: "themalibuhotel"
      })
    ]);
    expect(r[0]).toEqual({
      eventId: 1,
      kind: "stay",
      title: "Khách sạn Malibu",
      amount: 3600000,
      provider: "Bãi Sau",
      partnerOaId: "themalibuhotel"
    });
  });

  it("giá dạng chuỗi từ driver vẫn ra số", () => {
    const r = bookingsFromEvents([
      ev({ id: 1, kind: "ticket", estimatedCost: "600000" as unknown as number })
    ]);
    expect(r[0].amount).toBe(600000);
  });
});

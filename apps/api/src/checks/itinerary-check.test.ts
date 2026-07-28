import { describe, expect, it } from "vitest";
import { checkTrip, summarize, type CheckInput } from "./itinerary-check";

/** Chuyến 2 ngày: 12/08 → 13/08 giờ VN. */
function input(over: Partial<CheckInput> = {}): CheckInput {
  return {
    trip: {
      id: 1,
      name: "Vũng Tàu",
      startDate: "2026-08-12T01:00:00.000Z",
      endDate: "2026-08-13T10:00:00.000Z",
      budgetPerPerson: 3_000_000
    },
    events: [
      {
        id: 1,
        title: "Nhận phòng Malibu",
        startsAt: "2026-08-12T07:00:00.000Z",
        kind: "stay",
        estimatedCost: 3_600_000
      },
      {
        id: 2,
        title: "Ăn tối",
        startsAt: "2026-08-13T11:00:00.000Z",
        kind: "food",
        estimatedCost: 500_000
      }
    ],
    memberCount: 3,
    totalSpent: 4_000_000,
    unpaidTransfers: [],
    openDecision: null,
    ...over
  };
}

const codes = (i: CheckInput) => checkTrip(i).map((x) => x.code);

describe("mục hỏng", () => {
  it("báo lỗi kèm lý do, mức error", () => {
    const r = checkTrip(
      input({
        events: [
          {
            id: 9,
            title: "Xe limousine",
            startsAt: "2026-08-12T05:00:00Z",
            kind: "transport",
            status: "failed",
            failReason: "Hết chỗ khung giờ này"
          }
        ]
      })
    );
    const failed = r.find((x) => x.code === "event_failed");
    expect(failed?.level).toBe("error");
    expect(failed?.detail).toBe("Hết chỗ khung giờ này");
    expect(failed?.eventId).toBe(9);
  });

  it("lỗi luôn đứng trước cảnh báo và ghi chú", () => {
    const r = checkTrip(
      input({
        events: [
          { id: 9, title: "Xe", startsAt: "2026-08-12T05:00:00Z", kind: "transport", status: "failed" }
        ],
        unpaidTransfers: [{ fromName: "Linh", toName: "Đông", amount: 100_000 }]
      })
    );
    expect(r[0].level).toBe("error");
    expect(r[r.length - 1].level).toBe("info");
  });
});

describe("trùng giờ", () => {
  it("phát hiện khi mục trước chưa xong đã tới mục sau", () => {
    const r = codes(
      input({
        events: [
          {
            id: 1,
            title: "Ăn trưa",
            startsAt: "2026-08-12T05:00:00Z",
            endsAt: "2026-08-12T07:00:00Z",
            kind: "food"
          },
          {
            id: 2,
            title: "Leo núi",
            startsAt: "2026-08-12T06:00:00Z",
            endsAt: "2026-08-12T08:00:00Z",
            kind: "activity"
          }
        ]
      })
    );
    expect(r).toContain("event_overlap");
  });

  it("KHÔNG đoán bừa khi mục không có giờ kết thúc", () => {
    const r = codes(
      input({
        events: [
          { id: 1, title: "Ăn trưa", startsAt: "2026-08-12T05:00:00Z", kind: "food" },
          { id: 2, title: "Leo núi", startsAt: "2026-08-12T05:30:00Z", kind: "activity" }
        ]
      })
    );
    expect(r).not.toContain("event_overlap");
  });

  it("hai mục nối đuôi nhau sát giờ thì không phải trùng", () => {
    const r = codes(
      input({
        events: [
          {
            id: 1,
            title: "A",
            startsAt: "2026-08-12T05:00:00Z",
            endsAt: "2026-08-12T06:00:00Z",
            kind: "food"
          },
          {
            id: 2,
            title: "B",
            startsAt: "2026-08-12T06:00:00Z",
            endsAt: "2026-08-12T07:00:00Z",
            kind: "food"
          }
        ]
      })
    );
    expect(r).not.toContain("event_overlap");
  });
});

describe("chỗ ở", () => {
  it("báo đêm chưa có chỗ ở", () => {
    expect(codes(input({ events: [] }))).toContain("no_stay");
  });

  it("đêm cuối không tính — hôm đó là ngày về", () => {
    const r = checkTrip(input({ events: [] })).filter((x) => x.code === "no_stay");
    expect(r).toHaveLength(1); // chuyến 2 ngày → chỉ xét 1 đêm
  });

  it("có mục 'stay' đúng ngày thì không báo", () => {
    expect(codes(input())).not.toContain("no_stay");
  });
});

describe("ngân sách", () => {
  it("vượt thật thì mức error", () => {
    const r = checkTrip(input({ totalSpent: 10_000_000 })).find((x) => x.code === "over_budget");
    expect(r?.level).toBe("error");
    expect(r?.title).toContain("vượt ngân sách");
  });

  it("chưa vượt nhưng cộng phần dự kiến thì vượt → cảnh báo sớm", () => {
    // 4tr đã tiêu + 4,1tr dự kiến = 8,1tr > 9tr? chưa. Đặt totalSpent cao hơn:
    const r = checkTrip(input({ totalSpent: 5_500_000 })).find((x) => x.code === "over_budget");
    expect(r?.level).toBe("warn");
    expect(r?.title).toBe("Sắp vượt ngân sách");
  });

  it("không đặt ngân sách thì im lặng, không đoán", () => {
    const i = input();
    i.trip.budgetPerPerson = null;
    expect(codes(i)).not.toContain("over_budget");
  });
});

describe("việc còn treo", () => {
  it("nhắc quyết định chưa chốt kèm ai chưa bầu", () => {
    const r = checkTrip(
      input({ openDecision: { title: "Chọn khách sạn", pendingNames: ["Đông"] } })
    ).find((x) => x.code === "open_decision");
    expect(r?.detail).toContain("Đông");
  });

  it("cả nhóm bầu xong thì đổi câu, không nói sai", () => {
    const r = checkTrip(
      input({ openDecision: { title: "Chọn khách sạn", pendingNames: [] } })
    ).find((x) => x.code === "open_decision");
    expect(r?.detail).toContain("chờ người tổ chức chốt");
  });

  it("liệt kê từng khoản nợ chưa trả", () => {
    const r = checkTrip(
      input({
        unpaidTransfers: [
          { fromName: "Linh", toName: "Đông", amount: 2_066_666 },
          { fromName: "Tú", toName: "Đông", amount: 1_267_000 }
        ]
      })
    ).filter((x) => x.code === "unpaid_transfer");
    expect(r).toHaveLength(2);
    expect(r[0].title).toContain("2.066.666đ");
  });
});

describe("sự kiện lạc ngày", () => {
  it("bắt được mục nằm ngoài khoảng ngày chuyến đi", () => {
    expect(
      codes(
        input({
          events: [{ id: 5, title: "Gõ nhầm tháng", startsAt: "2026-09-20T05:00:00Z", kind: "food" }]
        })
      )
    ).toContain("event_outside_trip");
  });
});

describe("summarize", () => {
  it("không có vấn đề thì nói thẳng là ổn", () => {
    expect(summarize([])).toContain("ổn");
  });

  it("đếm đúng theo mức độ", () => {
    const s = summarize(
      checkTrip(
        input({
          events: [
            { id: 9, title: "Xe", startsAt: "2026-08-12T05:00:00Z", kind: "transport", status: "failed" }
          ],
          unpaidTransfers: [{ fromName: "A", toName: "B", amount: 1000 }]
        })
      )
    );
    expect(s).toContain("cần xử lý ngay");
  });
});

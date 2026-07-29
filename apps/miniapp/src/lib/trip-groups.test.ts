import { describe, expect, it } from "vitest";
import type { TripSummary } from "./api";
import { groupTrips, tripGroupKey } from "./trip-groups";

/** 12:00 trưa giờ VN ngày 29/07/2026 — mốc "hôm nay" cho mọi test dưới đây. */
const NOW = new Date("2026-07-29T05:00:00.000Z");

function trip(over: Partial<TripSummary> & { id: number }): TripSummary {
  return {
    name: `Chuyến ${over.id}`,
    destination: "Vũng Tàu",
    startDate: "2026-07-28T01:00:00.000Z",
    endDate: "2026-07-30T10:00:00.000Z",
    status: "planning",
    budgetPerPerson: null,
    memberCount: 3,
    totalSpent: 0,
    ...over
  };
}

describe("tripGroupKey", () => {
  it("chuyến đang diễn ra là 'đang đi'", () => {
    expect(tripGroupKey(trip({ id: 1 }), NOW)).toBe("ongoing");
  });

  it("chuyến khởi hành hôm nay đã là 'đang đi', không phải 'sắp tới'", () => {
    // 01:00Z = 08:00 sáng 29/07 giờ VN. Cẩn thận: "2026-07-29T23:00:00Z" trông
    // như vẫn là ngày 29 nhưng thực ra đã là 06:00 ngày 30 ở VN.
    const t = trip({ id: 2, startDate: "2026-07-29T01:00:00.000Z", endDate: "2026-07-31T10:00:00.000Z" });
    expect(tripGroupKey(t, NOW)).toBe("ongoing");
  });

  it("chuyến KẾT THÚC hôm nay vẫn là 'đang đi' — còn đang trên đường về", () => {
    const t = trip({ id: 3, startDate: "2026-07-27T01:00:00.000Z", endDate: "2026-07-29T02:00:00.000Z" });
    expect(tripGroupKey(t, NOW)).toBe("ongoing");
  });

  it("kết thúc hôm qua là 'đã xong'", () => {
    const t = trip({ id: 4, startDate: "2026-07-26T01:00:00.000Z", endDate: "2026-07-28T10:00:00.000Z" });
    expect(tripGroupKey(t, NOW)).toBe("past");
  });

  it("chuyến tương lai là 'sắp tới'", () => {
    const t = trip({ id: 5, startDate: "2026-08-15T01:00:00.000Z", endDate: "2026-08-16T11:00:00.000Z" });
    expect(tripGroupKey(t, NOW)).toBe("upcoming");
  });

  it("status 'done' thắng ngày tháng — chuyến huỷ giữa chừng không nằm ở 'sắp tới'", () => {
    const t = trip({ id: 6, startDate: "2026-08-15T01:00:00.000Z", endDate: "2026-08-16T11:00:00.000Z", status: "done" });
    expect(tripGroupKey(t, NOW)).toBe("past");
  });

  it("KHÔNG suy ngược lại: status 'ongoing' mà ngày đã qua thì vẫn là 'đã xong'", () => {
    const t = trip({ id: 7, startDate: "2026-07-20T01:00:00.000Z", endDate: "2026-07-22T10:00:00.000Z", status: "ongoing" });
    expect(tripGroupKey(t, NOW)).toBe("past");
  });

  it("ranh giới nửa đêm tính theo giờ VN, không theo UTC", () => {
    // 2026-07-28T18:00Z = 01:00 ngày 29/07 giờ VN → theo VN là hôm nay, chưa qua.
    const t = trip({ id: 8, startDate: "2026-07-27T01:00:00.000Z", endDate: "2026-07-28T18:00:00.000Z" });
    expect(tripGroupKey(t, NOW)).toBe("ongoing");
  });
});

describe("groupTrips", () => {
  it("bỏ nhóm rỗng, giữ thứ tự đang đi → sắp tới → đã xong", () => {
    const groups = groupTrips(
      [
        trip({ id: 1, startDate: "2026-08-15T01:00:00.000Z", endDate: "2026-08-16T11:00:00.000Z" }),
        trip({ id: 2 })
      ],
      NOW
    );
    expect(groups.map((g) => g.key)).toEqual(["ongoing", "upcoming"]);
    expect(groups.map((g) => g.label)).toEqual(["Đang đi", "Sắp tới"]);
  });

  it("danh sách rỗng trả về mảng rỗng, không phải ba nhóm trống", () => {
    expect(groupTrips([], NOW)).toEqual([]);
  });

  it("'sắp tới' xếp chuyến gần nhất lên trước", () => {
    const groups = groupTrips(
      [
        trip({ id: 1, startDate: "2026-09-01T01:00:00.000Z", endDate: "2026-09-03T10:00:00.000Z" }),
        trip({ id: 2, startDate: "2026-08-15T01:00:00.000Z", endDate: "2026-08-16T10:00:00.000Z" }),
        trip({ id: 3, startDate: "2026-12-24T01:00:00.000Z", endDate: "2026-12-26T10:00:00.000Z" })
      ],
      NOW
    );
    expect(groups[0].trips.map((t) => t.id)).toEqual([2, 1, 3]);
  });

  it("'đã xong' xếp chuyến vừa đi lên trước", () => {
    const groups = groupTrips(
      [
        trip({ id: 1, startDate: "2026-01-01T01:00:00.000Z", endDate: "2026-01-03T10:00:00.000Z" }),
        trip({ id: 2, startDate: "2026-07-01T01:00:00.000Z", endDate: "2026-07-03T10:00:00.000Z" })
      ],
      NOW
    );
    expect(groups[0].trips.map((t) => t.id)).toEqual([2, 1]);
  });

  it("'đang đi' xếp chuyến sắp kết thúc lên trước — nó là chuyến cần chốt sổ", () => {
    const groups = groupTrips(
      [
        trip({ id: 1, startDate: "2026-07-20T01:00:00.000Z", endDate: "2026-08-10T10:00:00.000Z" }),
        trip({ id: 2, startDate: "2026-07-28T01:00:00.000Z", endDate: "2026-07-30T10:00:00.000Z" })
      ],
      NOW
    );
    expect(groups[0].trips.map((t) => t.id)).toEqual([2, 1]);
  });

  it("ngày hỏng bị đẩy xuống cuối chứ không làm loạn thứ tự cả nhóm", () => {
    const groups = groupTrips(
      [
        trip({ id: 1, startDate: "không-phải-ngày", endDate: "2026-08-20T10:00:00.000Z" }),
        trip({ id: 2, startDate: "2026-08-15T01:00:00.000Z", endDate: "2026-08-16T10:00:00.000Z" }),
        trip({ id: 3, startDate: "2026-08-18T01:00:00.000Z", endDate: "2026-08-19T10:00:00.000Z" })
      ],
      NOW
    );
    const upcoming = groups.find((g) => g.key === "upcoming");
    expect(upcoming?.trips.map((t) => t.id)).toEqual([2, 3, 1]);
  });

  it("không làm mất chuyến nào", () => {
    const trips = [
      trip({ id: 1 }),
      trip({ id: 2, startDate: "2026-08-15T01:00:00.000Z", endDate: "2026-08-16T10:00:00.000Z" }),
      trip({ id: 3, startDate: "2026-01-01T01:00:00.000Z", endDate: "2026-01-03T10:00:00.000Z" })
    ];
    const total = groupTrips(trips, NOW).flatMap((g) => g.trips).length;
    expect(total).toBe(trips.length);
  });
});

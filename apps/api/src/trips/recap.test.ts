import { describe, expect, it } from "vitest";
import {
  buildRecap,
  escapeHtml,
  formatVnd,
  ictDateKey,
  ictTime,
  renderRecapHtml,
  tripDayCount,
  cssUrl,
  type RecapInput
} from "./recap";

/** Chuyến Vũng Tàu 12–14/8 — đúng kịch bản demo. */
function fixture(over: Partial<RecapInput> = {}): RecapInput {
  return {
    trip: {
      id: 7,
      name: "Vũng Tàu quẩy tới bến",
      destination: "Vũng Tàu",
      startDate: "2026-08-12T01:00:00.000Z", // 08:00 giờ VN
      endDate: "2026-08-14T10:00:00.000Z",
      status: "done",
      budgetPerPerson: 3_000_000
    },
    events: [
      {
        id: 1,
        title: "Xuất phát từ Sài Gòn",
        startsAt: "2026-08-12T01:00:00.000Z", // 12/8 08:00 ICT
        endsAt: null,
        location: "Bến xe Miền Đông",
        kind: "transport",
        note: null,
        estimatedCost: 200_000
      },
      {
        id: 2,
        title: "Nhận phòng Malibu",
        startsAt: "2026-08-12T07:00:00.000Z", // 12/8 14:00 ICT
        endsAt: null,
        location: "Khách sạn Malibu",
        kind: "stay",
        note: "Đặt 3 phòng đôi",
        estimatedCost: 1_800_000
      },
      {
        id: 3,
        // 13/8 00:30 giờ VN — nếu gom theo UTC sẽ rơi nhầm sang ngày 12
        title: "Ăn khuya bãi Sau",
        startsAt: "2026-08-12T17:30:00.000Z",
        endsAt: null,
        location: null,
        kind: "food",
        note: null,
        estimatedCost: null
      }
    ],
    expenses: [
      {
        id: 1,
        title: "Khách sạn 2 đêm",
        amount: 3_600_000,
        category: "stay",
        paidByName: "Đông",
        receiptPhotoUrl: null,
        spentAt: "2026-08-12T07:30:00.000Z"
      },
      {
        id: 2,
        title: "Hải sản Gành Hào",
        amount: 1_400_000,
        category: "food",
        paidByName: "Đạt",
        receiptPhotoUrl: null,
        spentAt: "2026-08-13T12:00:00.000Z"
      }
    ],
    photos: [
      {
        id: 1,
        url: "https://zah-35.123c.vn/media/a.jpg",
        caption: "Bình minh bãi Sau",
        uploaderName: "Đông",
        takenAt: "2026-08-13T22:00:00.000Z"
      }
    ],
    notes: [
      {
        id: 1,
        content: "Nhớ né hải sản cho Đông",
        kind: "note",
        authorName: "Zino",
        takenAt: "2026-08-12T02:00:00.000Z"
      }
    ],
    members: [
      { zaloUserId: "u1", displayName: "Đông" },
      { zaloUserId: "u2", displayName: "Đạt" }
    ],
    settlement: {
      totalSpent: 5_000_000,
      perMember: [
        { zaloUserId: "u1", displayName: "Đông", paid: 3_600_000, owed: 2_500_000, net: 1_100_000 },
        { zaloUserId: "u2", displayName: "Đạt", paid: 1_400_000, owed: 2_500_000, net: -1_100_000 }
      ],
      settlements: [
        { from: "u2", fromName: "Đạt", to: "u1", toName: "Đông", amount: 1_100_000 }
      ],
      roundingAdjustment: 0,
      warnings: []
    },
    ...over
  };
}

describe("helper giờ VN", () => {
  it("gom ngày theo ICT chứ không theo UTC", () => {
    // 17:30 UTC = 00:30 hôm sau ở VN
    expect(ictDateKey("2026-08-12T17:30:00.000Z")).toBe("2026-08-13");
    expect(ictTime("2026-08-12T17:30:00.000Z")).toBe("00:30");
  });

  it("đếm ngày bao gồm cả ngày đầu và ngày cuối", () => {
    expect(tripDayCount("2026-08-12T01:00:00Z", "2026-08-14T10:00:00Z")).toBe(3);
    expect(tripDayCount("2026-08-12T01:00:00Z", "2026-08-12T10:00:00Z")).toBe(1);
  });

  it("định dạng tiền không phụ thuộc ICU của môi trường", () => {
    expect(formatVnd(1_100_000)).toBe("1.100.000₫");
    expect(formatVnd(0)).toBe("0₫");
    expect(formatVnd(-250_000)).toBe("-250.000₫");
  });
});

describe("buildRecap", () => {
  it("gom lịch trình theo ngày giờ VN, đánh số ngày liên tục", () => {
    const r = buildRecap(fixture());
    expect(r.days.map((d) => d.date)).toEqual(["2026-08-12", "2026-08-13"]);
    expect(r.days[0].index).toBe(1);
    expect(r.days[0].items).toHaveLength(2);
    // sự kiện 00:30 giờ VN phải nằm ở ngày 13, không phải ngày 12
    expect(r.days[1].items[0].title).toBe("Ăn khuya bãi Sau");
    expect(r.days[0].estimatedCost).toBe(2_000_000);
  });

  it("sắp xếp sự kiện trong ngày theo giờ", () => {
    const f = fixture();
    f.events.reverse();
    const r = buildRecap(f);
    expect(r.days[0].items.map((i) => i.time)).toEqual(["08:00", "14:00"]);
  });

  it("tổng theo hạng mục cộng đúng bằng tổng chi", () => {
    const r = buildRecap(fixture());
    const sum = r.byCategory.reduce((s, c) => s + c.amount, 0);
    expect(sum).toBe(r.stats.totalSpent);
    expect(r.byCategory[0].category).toBe("stay"); // sắp xếp giảm dần
    expect(r.byCategory[0].share).toBe(72);
  });

  it("tính ngân sách nhóm và phần còn dư", () => {
    const r = buildRecap(fixture());
    expect(r.stats.budgetTotal).toBe(6_000_000);
    expect(r.stats.budgetRemaining).toBe(1_000_000);
    expect(r.stats.perPerson).toBe(2_500_000);
    expect(r.stats.dayCount).toBe(3);
  });

  it("không có ngân sách thì budgetRemaining là null, không phải 0", () => {
    const f = fixture();
    f.trip.budgetPerPerson = null;
    const r = buildRecap(f);
    expect(r.stats.budgetTotal).toBeNull();
    expect(r.stats.budgetRemaining).toBeNull();
  });

  it("chuyến rỗng vẫn ra payload hợp lệ, không ném lỗi", () => {
    const r = buildRecap({
      trip: fixture().trip,
      events: [],
      expenses: [],
      photos: [],
      notes: [],
      members: [],
      settlement: {
        totalSpent: 0,
        perMember: [],
        settlements: [],
        roundingAdjustment: 0,
        warnings: ["Chuyến đi chưa có thành viên"]
      }
    });
    expect(r.days).toEqual([]);
    expect(r.stats.perPerson).toBe(0);
    expect(r.stats.memberCount).toBe(0);
  });

  it("nhận cả Date lẫn chuỗi ISO (drizzle trả Date, JSON trả string)", () => {
    const f = fixture();
    f.trip.startDate = new Date(f.trip.startDate as string);
    f.events[0].startsAt = new Date(f.events[0].startsAt as string);
    expect(() => buildRecap(f)).not.toThrow();
    expect(buildRecap(f).days[0].items[0].time).toBe("08:00");
  });
});

describe("renderRecapHtml", () => {
  it("ra file HTML hoàn chỉnh, không phụ thuộc CDN", () => {
    const html = renderRecapHtml(buildRecap(fixture()));
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\/(cdn|unpkg|fonts)\./i);
  });

  it("hiện đủ số liệu chính", () => {
    const html = renderRecapHtml(buildRecap(fixture()));
    expect(html).toContain("Vũng Tàu quẩy tới bến");
    expect(html).toContain("5.000.000₫"); // tổng chi
    expect(html).toContain("1.100.000₫"); // giao dịch chia tiền
    expect(html).toContain("Còn dư 1.000.000₫");
    expect(html).toContain("Ngày 1");
    expect(html).toContain("Ngày 2");
  });

  it("chèn lời tựa khi có, và bỏ qua khi LLM lỗi", () => {
    const data = buildRecap(fixture());
    expect(renderRecapHtml(data, { intro: "Ba ngày nắng cháy." })).toContain("Ba ngày nắng cháy.");
    const noIntro = renderRecapHtml(data, { intro: null });
    expect(noIntro).not.toContain('class="intro"');
    expect(noIntro).toContain("5.000.000₫"); // thiếu lời tựa, trang vẫn đủ
  });

  it("escape nội dung do user nhập — không cho chèn thẻ", () => {
    const f = fixture();
    f.notes[0].content = '<img src=x onerror="alert(1)">';
    const html = renderRecapHtml(buildRecap(f));
    // chuỗi vẫn hiện ra dưới dạng chữ, nhưng không được là thẻ thật
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("loại URL ảnh không phải http(s) — chặn javascript:", () => {
    const f = fixture();
    f.photos[0].url = "javascript:alert(1)";
    const html = renderRecapHtml(buildRecap(f));
    expect(html).not.toContain("javascript:");
  });

  it("escapeHtml xử lý đủ 5 ký tự nguy hiểm", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("hiện ai trả bao nhiêu, ai còn phải bù — không chỉ mũi tên chuyển tiền", () => {
    const html = renderRecapHtml(buildRecap(fixture()));
    expect(html).toContain("trả ");
    expect(html).toMatch(/còn bù|được nhận|vừa đủ/);
  });

  it("nói ra chỗ làm tròn thay vì giấu", () => {
    const f = fixture();
    f.settlement.roundingAdjustment = 667;
    expect(renderRecapHtml(buildRecap(f))).toContain("Đã làm tròn 667₫");
    f.settlement.roundingAdjustment = 0;
    expect(renderRecapHtml(buildRecap(f))).not.toContain("Đã làm tròn");
  });

  it("cảnh báo của phần chia tiền phải hiện ra, không nuốt", () => {
    const f = fixture();
    f.settlement.warnings = ["Chuyến đi chưa có thành viên"];
    expect(renderRecapHtml(buildRecap(f))).toContain("Chuyến đi chưa có thành viên");
  });

  it("KHÔNG nhét số tiền dài vào ô đếm — ô đó chỉ chứa số nguyên ngắn", () => {
    const f = fixture();
    const html = renderRecapHtml(buildRecap(f));
    const stats = html.slice(html.indexOf('class="stats"'), html.indexOf('class="wrap"'));
    // "2.666.667₫" ở 20px đậm trong ô rộng ~70px là tràn hoặc vỡ dòng giữa số.
    expect(stats).not.toContain("₫");
  });
});

/**
 * `cssUrl` là hàng rào riêng cho URL nằm trong `style="background-image:url()"`.
 * `escapeHtml` KHÔNG đủ ở đó: nó đổi `"` thành `&quot;`, nhưng trình duyệt giải
 * mã thực thể trước khi đọc CSS nên dấu nháy hiện lại nguyên hình và thoát ra
 * được. Cách duy nhất chắc chắn là từ chối hẳn các ký tự đó.
 */
describe("cssUrl", () => {
  it("cho qua http(s) và đường dẫn tương đối", () => {
    expect(cssUrl("https://cdn.x/a.jpg")).toBe("https://cdn.x/a.jpg");
    expect(cssUrl("/media/abc.jpg")).toBe("/media/abc.jpg");
  });

  it("chặn mọi thứ có thể thoát khỏi url()", () => {
    expect(cssUrl("https://x/a'); background:url('evil")).toBe("");
    expect(cssUrl('https://x/a");x:url("evil')).toBe("");
    expect(cssUrl("https://x/a b.jpg")).toBe("");
    expect(cssUrl("https://x/a\\b.jpg")).toBe("");
  });

  it("chặn scheme nguy hiểm", () => {
    expect(cssUrl("javascript:alert(1)")).toBe("");
    expect(cssUrl("data:image/svg+xml,<svg onload=alert(1)>")).toBe("");
  });

  it("ảnh có URL bẩn thì hero rơi về nền chuyển sắc, không dựng style hỏng", () => {
    const f = fixture();
    f.photos = [{ ...f.photos[0], url: "https://x/a'); background:url('evil" }];
    const html = renderRecapHtml(buildRecap(f));
    expect(html).not.toContain("background-image:url");
  });
});

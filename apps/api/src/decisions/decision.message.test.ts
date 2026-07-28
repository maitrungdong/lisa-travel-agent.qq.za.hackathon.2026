import { describe, expect, it } from "vitest";
import { decidedMessage, formatVnd, proposalMessage, reminderMessage } from "./decision.message";
import type { DecisionView } from "./decisions.service";

const APP = "https://zalo.me/s/126962352654603209/";

function view(over: Partial<DecisionView> = {}): DecisionView {
  return {
    id: 1,
    tripId: 7,
    kind: "stay",
    title: "Chọn khách sạn",
    status: "open",
    recommendedOptionId: 10,
    recommendationReason: "trong ngân sách, cách biển 400m",
    decidedOptionId: null,
    decidedByName: null,
    decidedAt: null,
    againstMajority: false,
    options: [
      {
        id: 10,
        label: "Malibu",
        detail: "cách Bãi Sau 400m",
        price: 3_600_000,
        partnerOaId: "themalibuhotel",
        votes: 2,
        voterNames: ["Lan", "Tú"],
        isRecommended: true
      },
      {
        id: 20,
        label: "Seaside",
        detail: "ngay mặt biển",
        price: 4_100_000,
        partnerOaId: null,
        votes: 0,
        voterNames: [],
        isRecommended: false
      }
    ],
    pendingNames: ["Minh"],
    totalVotes: 2,
    memberCount: 3,
    isTie: false,
    ...over
  };
}

describe("formatVnd", () => {
  it("chấm ngăn nghìn, không phụ thuộc ICU", () => {
    expect(formatVnd(3_600_000)).toBe("3.600.000đ");
    expect(formatVnd(0)).toBe("0đ");
  });
});

describe("proposalMessage", () => {
  it("đánh nhãn A/B và kèm giá", () => {
    const m = proposalMessage(view(), APP);
    expect(m).toContain("**A · Malibu** — 3.600.000đ");
    expect(m).toContain("**B · Seaside** — 4.100.000đ");
  });

  it("nêu lý do Zino nghiêng phương án nào", () => {
    expect(proposalMessage(view(), APP)).toContain("Mình nghiêng **Malibu**: trong ngân sách");
  });

  it("không có lý do thì bỏ hẳn đoạn đó, không để câu cụt", () => {
    const m = proposalMessage(view({ recommendationReason: null }), APP);
    expect(m).not.toContain("Mình nghiêng");
    expect(m).toContain("Cả nhóm bình chọn");
  });

  it("luôn kèm link mở app — đó là đường vào duy nhất", () => {
    expect(proposalMessage(view(), APP)).toContain(APP);
  });

  it("không vượt giới hạn 2000 ký tự của Zalo", () => {
    const many = view({
      options: Array.from({ length: 40 }, (_, i) => ({
        id: i,
        label: `Phương án ${i} với cái tên rất dài để thử giới hạn độ dài tin nhắn`,
        detail: "mô tả dài dòng ".repeat(10),
        price: 1_000_000,
        partnerOaId: null,
        votes: 0,
        voterNames: [],
        isRecommended: false
      }))
    });
    expect(proposalMessage(many, APP).length).toBeLessThanOrEqual(2000);
  });
});

describe("decidedMessage", () => {
  it("nói rõ ai chốt và bao nhiêu phiếu", () => {
    const m = decidedMessage(
      view({ status: "decided", decidedOptionId: 10, decidedByName: "Đông" }),
      APP
    );
    expect(m).toContain("Nhóm đã chốt **Malibu** (Đông chốt, 2/3 phiếu)");
  });

  it("chốt ngược đa số thì phải nói ra", () => {
    const m = decidedMessage(
      view({ status: "decided", decidedOptionId: 20, decidedByName: "Đông", againstMajority: true }),
      APP
    );
    expect(m).toContain("không phải lựa chọn của số đông");
  });

  it("không ngược đa số thì không thêm cảnh báo thừa", () => {
    const m = decidedMessage(
      view({ status: "decided", decidedOptionId: 10, decidedByName: "Đông" }),
      APP
    );
    expect(m).not.toContain("số đông");
  });
});

describe("reminderMessage", () => {
  it("nêu đích danh ai chưa bầu", () => {
    expect(reminderMessage(view(), APP)).toContain("còn Minh chưa bình chọn");
  });

  it("hoà phiếu thì nói đang hoà, không tự xử", () => {
    const m = reminderMessage(view({ status: "tie", pendingNames: [] , isTie: true}), APP);
    expect(m).toBeNull(); // hết người chưa bầu thì thôi nhắc
    const m2 = reminderMessage(view({ status: "tie", isTie: true }), APP);
    expect(m2).toContain("đang hoà phiếu");
  });

  it("mọi người đã bầu xong thì im lặng", () => {
    expect(reminderMessage(view({ pendingNames: [] }), APP)).toBeNull();
  });

  it("đã chốt rồi thì không nhắc nữa", () => {
    expect(reminderMessage(view({ status: "decided" }), APP)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { isAgainstMajority, openStatus, tallyVotes, type TallyMember } from "./tally";

const MEMBERS: TallyMember[] = [
  { zaloUserId: "u1", displayName: "Đông", role: "organizer" },
  { zaloUserId: "u2", displayName: "Lan" },
  { zaloUserId: "u3", displayName: "Tú" }
];

describe("tallyVotes", () => {
  it("đếm đúng phiếu và liệt kê ai đã bầu", () => {
    const t = tallyVotes(
      [10, 20],
      [
        { optionId: 10, zaloUserId: "u2" },
        { optionId: 10, zaloUserId: "u3" }
      ],
      MEMBERS
    );
    expect(t.perOption[0]).toMatchObject({ optionId: 10, votes: 2 });
    expect(t.perOption[0].voterNames).toEqual(["Lan", "Tú"]);
    expect(t.perOption[1].votes).toBe(0);
  });

  it("chỉ ra ai CHƯA bầu — thứ wireframe bắt buộc hiện", () => {
    const t = tallyVotes([10], [{ optionId: 10, zaloUserId: "u2" }], MEMBERS);
    expect(t.pendingNames).toEqual(["Đông", "Tú"]);
    expect(t.everyoneVoted).toBe(false);
  });

  it("nhận ra hoà phiếu", () => {
    const t = tallyVotes(
      [10, 20],
      [
        { optionId: 10, zaloUserId: "u1" },
        { optionId: 20, zaloUserId: "u2" }
      ],
      MEMBERS
    );
    expect(t.isTie).toBe(true);
    expect(t.leadingOptionIds.sort()).toEqual([10, 20]);
  });

  it("chưa ai bầu thì không có phương án dẫn đầu, và không phải hoà", () => {
    const t = tallyVotes([10, 20], [], MEMBERS);
    expect(t.topVotes).toBe(0);
    expect(t.leadingOptionIds).toEqual([]);
    expect(t.isTie).toBe(false);
  });

  it("bỏ phiếu của người đã rời nhóm", () => {
    const t = tallyVotes([10], [{ optionId: 10, zaloUserId: "nguoi-la" }], MEMBERS);
    expect(t.totalVotes).toBe(0);
    expect(t.pendingNames).toHaveLength(3);
  });

  it("bỏ phiếu trỏ vào phương án không còn tồn tại", () => {
    const t = tallyVotes([10], [{ optionId: 999, zaloUserId: "u1" }], MEMBERS);
    expect(t.totalVotes).toBe(0);
  });

  it("everyoneVoted đúng khi cả nhóm đã bầu", () => {
    const t = tallyVotes(
      [10],
      MEMBERS.map((m) => ({ optionId: 10, zaloUserId: m.zaloUserId })),
      MEMBERS
    );
    expect(t.everyoneVoted).toBe(true);
    expect(t.pendingNames).toEqual([]);
  });
});

describe("isAgainstMajority", () => {
  it("chốt đúng phương án dẫn đầu → không ngược", () => {
    const t = tallyVotes(
      [10, 20],
      [
        { optionId: 10, zaloUserId: "u2" },
        { optionId: 10, zaloUserId: "u3" }
      ],
      MEMBERS
    );
    expect(isAgainstMajority(t, 10)).toBe(false);
    expect(isAgainstMajority(t, 20)).toBe(true);
  });

  it("chưa ai bầu thì chốt gì cũng không tính là ngược", () => {
    const t = tallyVotes([10, 20], [], MEMBERS);
    expect(isAgainstMajority(t, 20)).toBe(false);
  });

  it("đang hoà, chốt một trong hai phương án dẫn đầu → không ngược", () => {
    const t = tallyVotes(
      [10, 20],
      [
        { optionId: 10, zaloUserId: "u1" },
        { optionId: 20, zaloUserId: "u2" }
      ],
      MEMBERS
    );
    expect(isAgainstMajority(t, 10)).toBe(false);
    expect(isAgainstMajority(t, 20)).toBe(false);
  });
});

describe("openStatus", () => {
  it("hoà nhưng chưa đủ phiếu → vẫn là open, chưa gọi là hoà", () => {
    const t = tallyVotes(
      [10, 20],
      [
        { optionId: 10, zaloUserId: "u1" },
        { optionId: 20, zaloUserId: "u2" }
      ],
      MEMBERS
    );
    expect(t.isTie).toBe(true);
    expect(openStatus(t)).toBe("open"); // Tú chưa bầu, còn cơ hội phá hoà
  });

  it("cả nhóm đã bầu mà vẫn hoà → tie", () => {
    const t = tallyVotes(
      [10, 20, 30],
      [
        { optionId: 10, zaloUserId: "u1" },
        { optionId: 20, zaloUserId: "u2" },
        { optionId: 30, zaloUserId: "u3" }
      ],
      MEMBERS
    );
    expect(openStatus(t)).toBe("tie");
  });
});

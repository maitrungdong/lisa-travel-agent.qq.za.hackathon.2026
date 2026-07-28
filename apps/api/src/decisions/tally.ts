/**
 * Đếm phiếu cho một quyết định nhóm.
 *
 * Hàm thuần, không I/O — vì đây là chỗ dễ sai nhất mà lại lộ ra trước mặt cả
 * nhóm: hiện nhầm "2/3 phiếu" hay quên mất ai chưa bầu là mất niềm tin ngay.
 *
 * Ba quy tắc lấy thẳng từ wireframe (DEV NOTES — J2):
 *  • Hoà phiếu thì KHÔNG tự xử — chỉ nói đang hoà, chờ người tổ chức chốt.
 *  • Người tổ chức chốt được kể cả khi chưa đủ phiếu hoặc ngược đa số.
 *  • Chốt ngược đa số phải được ghi lại, không giấu.
 */

export interface TallyMember {
  zaloUserId: string;
  displayName: string;
  role?: string;
}

export interface TallyVote {
  optionId: number;
  zaloUserId: string;
}

export interface OptionTally {
  optionId: number;
  votes: number;
  /** Tên người đã bầu cho phương án này, theo thứ tự thành viên */
  voterNames: string[];
}

export interface Tally {
  perOption: OptionTally[];
  /** Thành viên chưa bỏ phiếu — thứ wireframe bắt phải hiện */
  pendingNames: string[];
  totalVotes: number;
  /** Số phiếu cao nhất; 0 khi chưa ai bầu */
  topVotes: number;
  /** Các phương án đang dẫn đầu. >1 phần tử = đang hoà */
  leadingOptionIds: number[];
  /** true khi có ≥2 phương án cùng dẫn đầu VÀ đã có người bầu */
  isTie: boolean;
  /** Đã đủ phiếu của mọi thành viên chưa */
  everyoneVoted: boolean;
}

export function tallyVotes(
  optionIds: number[],
  votes: TallyVote[],
  members: TallyMember[]
): Tally {
  // Chỉ tính phiếu của người CÒN trong nhóm và bầu cho phương án CÒN tồn tại.
  // Thành viên rời nhóm hoặc phương án bị gỡ mà vẫn đếm thì con số vô nghĩa.
  const memberIds = new Set(members.map((m) => m.zaloUserId));
  const optionSet = new Set(optionIds);
  const valid = votes.filter((v) => memberIds.has(v.zaloUserId) && optionSet.has(v.optionId));

  const nameOf = new Map(members.map((m) => [m.zaloUserId, m.displayName]));

  const perOption: OptionTally[] = optionIds.map((optionId) => {
    const voters = valid.filter((v) => v.optionId === optionId);
    return {
      optionId,
      votes: voters.length,
      voterNames: members
        .filter((m) => voters.some((v) => v.zaloUserId === m.zaloUserId))
        .map((m) => nameOf.get(m.zaloUserId) ?? m.zaloUserId)
    };
  });

  const voted = new Set(valid.map((v) => v.zaloUserId));
  const pendingNames = members.filter((m) => !voted.has(m.zaloUserId)).map((m) => m.displayName);

  const topVotes = perOption.reduce((max, o) => Math.max(max, o.votes), 0);
  const leadingOptionIds = topVotes > 0 ? perOption.filter((o) => o.votes === topVotes).map((o) => o.optionId) : [];

  return {
    perOption,
    pendingNames,
    totalVotes: valid.length,
    topVotes,
    leadingOptionIds,
    isTie: leadingOptionIds.length > 1,
    everyoneVoted: members.length > 0 && pendingNames.length === 0
  };
}

/**
 * Chốt phương án này có ngược số đông không.
 *
 * Chưa ai bầu thì KHÔNG tính là ngược — không có "đa số" nào để mà ngược.
 * Đang hoà mà chốt một trong các phương án dẫn đầu cũng không tính là ngược.
 */
export function isAgainstMajority(tally: Tally, chosenOptionId: number): boolean {
  if (tally.totalVotes === 0) return false;
  return !tally.leadingOptionIds.includes(chosenOptionId);
}

/** Trạng thái nên lưu khi quyết định còn mở: `tie` để UI nói "đang hoà". */
export function openStatus(tally: Tally): "open" | "tie" {
  return tally.isTie && tally.everyoneVoted ? "tie" : "open";
}

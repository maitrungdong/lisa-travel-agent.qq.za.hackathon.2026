/**
 * Chia tiền nhóm (settle-up) cho một chuyến đi.
 *
 * Thuần hàm: không I/O, không phụ thuộc NestJS — dễ test và dễ audit.
 * Mọi số tiền đều là VND dạng số nguyên; phép chia luôn bảo toàn tổng
 * (không bao giờ "bốc hơi" hay "đẻ thêm" tiền vì làm tròn).
 */

/** Một khoản chi đã ghi nhận trong chuyến đi. */
export interface ExpenseInput {
  id: number;
  title: string;
  /** VND, số nguyên dương */
  amount: number;
  /** zalo user id của người đã ứng tiền */
  paidBy: string;
  paidByName?: string;
  /** Ai chịu khoản này. Rỗng/undefined = chia đều cho TẤT CẢ thành viên */
  splits?: { memberZaloId: string; memberName?: string; shareAmount: number }[];
}

/** Một thành viên trong nhóm đi chơi. */
export interface MemberInput {
  zaloUserId: string;
  displayName: string;
}

/** Số dư của một thành viên sau khi cộng hết mọi khoản chi. */
export interface MemberBalance {
  zaloUserId: string;
  displayName: string;
  /** Tổng số tiền người này đã ứng ra */
  paid: number;
  /** Tổng phần người này phải chịu */
  owed: number;
  /** paid - owed. Dương = chủ nợ, âm = con nợ */
  net: number;
}

/** Một giao dịch chuyển khoản cần thực hiện để tất toán. */
export interface Settlement {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  /** VND, đã làm tròn bội số 1000 (trừ giao dịch gánh sai số làm tròn) */
  amount: number;
}

export interface SettleResult {
  totalSpent: number;
  perMember: MemberBalance[];
  settlements: Settlement[];
  /** Sai số do làm tròn đã được dồn vào giao dịch lớn nhất */
  roundingAdjustment: number;
  /** Cảnh báo dữ liệu bẩn — không chặn tính toán, chỉ để hiển thị/log */
  warnings: string[];
}

/** Mọi giao dịch chuyển khoản được làm tròn lên bội số này (VND). */
const ROUND_UNIT = 1000;

/**
 * Chia `amount` thành `parts` phần nguyên, tổng KHỚP CHÍNH XÁC `amount`.
 * Phần dư được dồn vào những người đầu danh sách.
 * VD: 100_000 / 3 → [33_334, 33_333, 33_333]
 */
export function splitEvenly(amount: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(amount / parts);
  const remainder = amount - base * parts;
  const shares: number[] = new Array<number>(parts);
  for (let i = 0; i < parts; i++) shares[i] = base + (i < remainder ? 1 : 0);
  return shares;
}

/**
 * Tính ai nợ ai bao nhiêu, với SỐ GIAO DỊCH TỐI THIỂU (greedy khớp
 * chủ nợ lớn nhất với con nợ lớn nhất → tối đa n-1 giao dịch).
 */
export function settleExpenses(expenses: ExpenseInput[], members: MemberInput[]): SettleResult {
  const warnings: string[] = [];

  // Map giữ nguyên thứ tự chèn: thành viên chính thức trước, "người lạ" (xuất
  // hiện trong expense nhưng không có trong danh sách) được thêm vào sau.
  const balances = new Map<string, MemberBalance>();
  /** id các thành viên chính thức — mẫu số của phép chia đều */
  const roster: string[] = [];

  const ensure = (zaloUserId: string, displayName?: string): MemberBalance => {
    const existing = balances.get(zaloUserId);
    if (existing) {
      // Bổ sung tên nếu trước đó chỉ có id
      if (existing.displayName === existing.zaloUserId && displayName && displayName.trim()) {
        existing.displayName = displayName.trim();
      }
      return existing;
    }
    const created: MemberBalance = {
      zaloUserId,
      displayName: displayName && displayName.trim() ? displayName.trim() : zaloUserId,
      paid: 0,
      owed: 0,
      net: 0
    };
    balances.set(zaloUserId, created);
    return created;
  };

  for (const m of members) {
    if (balances.has(m.zaloUserId)) {
      warnings.push(`Thành viên bị lặp trong danh sách: ${m.zaloUserId}`);
      continue;
    }
    ensure(m.zaloUserId, m.displayName);
    roster.push(m.zaloUserId);
  }

  /* ---------------------------------------------------------------------- *
   * 1. Cộng sổ: ai đã trả bao nhiêu (paid) và ai phải chịu bao nhiêu (owed)
   * ---------------------------------------------------------------------- */
  let totalSpent = 0;

  for (const expense of expenses) {
    const amount = Math.round(expense.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      warnings.push(`Khoản "${expense.title}" (#${expense.id}) có số tiền không hợp lệ — đã bỏ qua`);
      continue;
    }
    totalSpent += amount;

    if (!balances.has(expense.paidBy)) {
      warnings.push(
        `Người trả "${expense.paidByName ?? expense.paidBy}" của khoản "${expense.title}" không có trong danh sách thành viên`
      );
    }
    ensure(expense.paidBy, expense.paidByName).paid += amount;

    const splits = expense.splits ?? [];

    // 2a. Không khai báo splits → chia đều cho toàn bộ thành viên
    if (splits.length === 0) {
      if (roster.length === 0) {
        warnings.push(`Không có thành viên nào để chia đều khoản "${expense.title}" — người trả tự chịu`);
        ensure(expense.paidBy, expense.paidByName).owed += amount;
        continue;
      }
      const shares = splitEvenly(amount, roster.length);
      for (let i = 0; i < roster.length; i++) {
        ensure(roster[i]).owed += shares[i];
      }
      continue;
    }

    // 2b. Có splits → dùng đúng shareAmount đã khai báo
    let declared = 0;
    for (const split of splits) {
      const share = Math.round(split.shareAmount);
      if (!Number.isFinite(share)) {
        warnings.push(`Phần chia của "${split.memberName ?? split.memberZaloId}" trong khoản "${expense.title}" không hợp lệ — đã bỏ qua`);
        continue;
      }
      if (!balances.has(split.memberZaloId)) {
        warnings.push(
          `"${split.memberName ?? split.memberZaloId}" chịu khoản "${expense.title}" nhưng không có trong danh sách thành viên`
        );
      }
      ensure(split.memberZaloId, split.memberName).owed += share;
      declared += share;
    }
    if (declared !== amount) {
      warnings.push(
        `Khoản "${expense.title}" (#${expense.id}): tổng phần chia ${declared}đ khác số tiền ${amount}đ (lệch ${amount - declared}đ)`
      );
    }
  }

  const perMember = [...balances.values()];
  for (const b of perMember) b.net = b.paid - b.owed;

  /* ---------------------------------------------------------------------- *
   * 2. Greedy: khớp chủ nợ lớn nhất với con nợ lớn nhất
   *    Array.prototype.sort ổn định (ES2019) → kết quả tất định theo thứ tự
   *    thành viên đầu vào khi |net| bằng nhau.
   * ---------------------------------------------------------------------- */
  const creditors = perMember.filter((b) => b.net > 0).sort((a, b) => b.net - a.net);
  const debtors = perMember.filter((b) => b.net < 0).sort((a, b) => a.net - b.net);
  const creditLeft = creditors.map((b) => b.net);
  const debtLeft = debtors.map((b) => -b.net);

  const raw: Settlement[] = [];
  let ci = 0;
  let di = 0;
  while (di < debtors.length && ci < creditors.length) {
    const amount = Math.min(debtLeft[di], creditLeft[ci]);
    if (amount <= 0) break; // chốt chặn, về lý thuyết không xảy ra
    raw.push({
      from: debtors[di].zaloUserId,
      fromName: debtors[di].displayName,
      to: creditors[ci].zaloUserId,
      toName: creditors[ci].displayName,
      amount
    });
    debtLeft[di] -= amount;
    creditLeft[ci] -= amount;
    if (debtLeft[di] === 0) di++;
    if (creditLeft[ci] === 0) ci++;
  }

  /* ---------------------------------------------------------------------- *
   * 3. Làm tròn LÊN bội số 1000 cho từng giao dịch, rồi trừ phần dôi ra khỏi
   *    giao dịch lớn nhất để TỔNG vẫn khớp chính xác tổng nợ thật.
   *    (Tổng nợ hiếm khi chia hết cho 1000 → bắt buộc có đúng 1 giao dịch
   *     mang số lẻ; chọn giao dịch lớn nhất vì nó ít bị méo nhất.)
   * ---------------------------------------------------------------------- */
  const rawTotal = raw.reduce((sum, s) => sum + s.amount, 0);
  const settlements: Settlement[] = raw.map((s) => ({
    ...s,
    amount: Math.ceil(s.amount / ROUND_UNIT) * ROUND_UNIT
  }));
  const roundedTotal = settlements.reduce((sum, s) => sum + s.amount, 0);
  const roundingAdjustment = roundedTotal - rawTotal;

  // Thứ tự hấp thụ sai số: giao dịch lớn nhất trước. Tính xong mới sửa amount.
  const byAmountDesc = settlements.map((_, i) => i).sort((a, b) => settlements[b].amount - settlements[a].amount);
  let remaining = roundingAdjustment;
  for (const idx of byAmountDesc) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, settlements[idx].amount);
    settlements[idx].amount -= take;
    remaining -= take;
  }

  return {
    totalSpent,
    perMember,
    settlements: settlements.filter((s) => s.amount > 0),
    roundingAdjustment,
    warnings
  };
}

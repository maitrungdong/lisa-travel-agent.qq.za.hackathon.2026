/**
 * Ai được sửa gì trên một khoản chi.
 *
 * Quy tắc gốc từ wireframe: **sửa được dữ liệu, không sửa được giao dịch**.
 * Khoản do Zino tạo kèm mã giao dịch là bản ghi của việc đã xảy ra ngoài đời;
 * cho sửa số tiền là biến sổ sách thành chuyện kể lại. Nhưng cách chia và ghi
 * chú thì vẫn phải mở — chúng là thoả thuận nội bộ của nhóm, không phải giao dịch.
 *
 * Hàm thuần để test được mọi tổ hợp mà không cần DB, và để UI với API dùng
 * CHUNG một bộ luật: nếu hai bên tự suy diễn riêng thì sớm muộn cũng lệch, và
 * lệch kiểu này thì người dùng thấy nút bấm được nhưng server từ chối.
 */

export type ExpenseField = "title" | "amount" | "category" | "paidBy" | "split" | "note";

export interface ExpenseLike {
  source: string;
  txnCode: string | null;
  createdBy: string | null;
  paidBy: string;
}

export interface EditActor {
  zaloUserId: string;
  role?: string;
}

/** Khoản này có phải giao dịch thật đã thực hiện không. */
export function isRealTransaction(e: ExpenseLike): boolean {
  return e.source === "zino" && Boolean(e.txnCode);
}

/**
 * Trả về các trường actor được phép sửa. Rỗng = chỉ đọc.
 *
 * Người tổ chức sửa được mọi khoản; thành viên chỉ sửa khoản mình tạo hoặc
 * mình đã ứng tiền — người ứng tiền là người biết rõ nhất khoản đó là gì.
 */
export function editableFields(e: ExpenseLike, actor: EditActor): Set<ExpenseField> {
  const organizer = actor.role === "organizer";
  const mine = e.createdBy === actor.zaloUserId || e.paidBy === actor.zaloUserId;

  if (isRealTransaction(e)) {
    // Tiền đã chuyển thật: chỉ còn thoả thuận nội bộ là sửa được.
    return organizer || mine ? new Set<ExpenseField>(["split", "note"]) : new Set();
  }

  if (organizer || mine) {
    return new Set<ExpenseField>(["title", "amount", "category", "paidBy", "split", "note"]);
  }
  return new Set();
}

export function canEdit(e: ExpenseLike, actor: EditActor): boolean {
  return editableFields(e, actor).size > 0;
}

/** Xoá: chỉ khoản người dùng tạo, và chỉ người tạo hoặc người tổ chức. */
export function canDelete(e: ExpenseLike, actor: EditActor): boolean {
  if (isRealTransaction(e)) return false;
  return actor.role === "organizer" || e.createdBy === actor.zaloUserId;
}

/**
 * Lọc payload theo quyền. Trả về cả phần bị chặn để API nói được lý do cụ thể
 * thay vì một câu "không có quyền" chung chung.
 */
export function applyEditRules<T extends Partial<Record<ExpenseField, unknown>>>(
  e: ExpenseLike,
  actor: EditActor,
  patch: T
): { allowed: Partial<T>; rejected: ExpenseField[] } {
  const fields = editableFields(e, actor);
  const allowed: Partial<T> = {};
  const rejected: ExpenseField[] = [];

  for (const key of Object.keys(patch) as ExpenseField[]) {
    if (patch[key] === undefined) continue;
    if (fields.has(key)) (allowed as Record<string, unknown>)[key] = patch[key];
    else rejected.push(key);
  }
  return { allowed, rejected };
}

/** Mã giao dịch mock cho hackathon. Tiền tố nói rõ đây là giả, không giấu. */
export function mockTxnCode(seed = Date.now()): string {
  return `ZP-${String(seed % 10000).padStart(4, "0")}`;
}

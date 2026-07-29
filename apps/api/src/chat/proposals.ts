/**
 * Đề xuất hành động của Zino trong Mini App — phần THUẦN.
 *
 * Nguyên tắc không đổi so với phần đọc: **model không ghi dữ liệu**. Nó chỉ gọi
 * được `propose_*`, và mấy tool đó không chạm vào DB — chúng nhận ý định thô,
 * kiểm, chuẩn hoá, rồi trả về một đề xuất kèm bản xem trước. Người dùng bấm nút
 * thì server mới ghi, và ghi thì kiểm lại từ đầu bằng chính hàm ở file này.
 *
 * Vì sao phải có bước xác nhận, không cho model ghi thẳng: số tiền trong đề xuất
 * do MODEL đọc ra từ câu nói ("350k", "hai triệu rưỡi"), không phải từ tool. Cổng
 * kiểm chứng không cứu được chỗ này — nó chỉ đối chiếu số trong câu trả lời với
 * số tool trả về, mà ở đây chính tool là nơi con số ra đời. Nên chốt chặn cuối
 * cùng phải là mắt người: thẻ hiện rõ "350.000₫", sai thì thấy ngay.
 *
 * Cùng một hàm dùng cho cả hai đầu (dựng thẻ và thực thi) để không thể xảy ra
 * chuyện thẻ hiện một đằng, server ghi một nẻo.
 */

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

export const EXPENSE_CATEGORIES = [
  "food",
  "stay",
  "transport",
  "ticket",
  "shopping",
  "other"
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EVENT_KINDS = ["stay", "food", "transport", "activity", "other"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const NOTE_KINDS = ["note", "tip"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export type Proposal =
  | {
      kind: "expense";
      title: string;
      amount: number;
      category: ExpenseCategory;
      paidBy: string;
      paidByName: string;
      /** Rỗng = chia đều cả nhóm */
      splitWith: string[];
    }
  | { kind: "note"; content: string; noteKind: NoteKind }
  /**
   * Chốt chỗ ở vào kế hoạch.
   *
   * Tách riêng khỏi `event` dù cùng ghi vào bảng events, vì nó có một luật mà
   * `event` không có: MỘT chuyến chỉ giữ MỘT chỗ ở chọn từ chat. Chọn chỗ khác
   * là thay chỗ cũ, không phải thêm dòng thứ hai. Không có luật đó thì bấm thử
   * ba phương án là lịch trình có ba khách sạn chồng nhau.
   */
  | {
      kind: "stay";
      title: string;
      startsAt: string;
      location: string | null;
      /** Giá tham khảo dạng chữ ("1,2tr–2,5tr/đêm") — danh bạ không lưu số */
      priceHint: string | null;
      partnerOaId: string | null;
      imageUrl: string | null;
      note: string | null;
    }
  | {
      kind: "event";
      title: string;
      /** ISO đầy đủ, đã quy từ ngày+giờ giờ VN */
      startsAt: string;
      eventKind: EventKind;
      location: string | null;
      note: string | null;
      estimatedCost: number | null;
    };

export interface ProposalContext {
  /** ISO, dùng để chặn mục lịch trình rơi ra ngoài chuyến đi */
  tripStart: string;
  tripEnd: string;
  members: { zaloUserId: string; displayName: string }[];
  /** Người đang chat — mặc định là người trả tiền nếu không nói rõ ai */
  actorZaloId?: string;
}

export type Normalized<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Chặn trên/dưới của số tiền.
 *
 * Dưới: 1.000₫ — dưới mức đó gần như chắc chắn là model hiểu nhầm đơn vị
 * (đọc "350k" thành 350). Trên: 500 triệu cho MỘT khoản — cao hơn nữa thì
 * nhiều khả năng thừa số 0, và nếu là thật thì nhập tay ở tab Chi phí vẫn được.
 */
const MIN_AMOUNT = 1_000;
const MAX_AMOUNT = 500_000_000;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function int(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[.,\s]/g, "")) : NaN;
  return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

/** yyyy-mm-dd theo giờ VN. */
export function ictDay(iso: string): string {
  return new Date(new Date(iso).getTime() + ICT_OFFSET_MS).toISOString().slice(0, 10);
}

export function normalizeExpense(raw: Record<string, unknown>, ctx: ProposalContext): Normalized<Proposal> {
  const title = str(raw.title);
  if (!title) return { ok: false, reason: "Thiếu tên khoản chi — hỏi lại người dùng chi cho việc gì." };
  if (title.length > 200) return { ok: false, reason: "Tên khoản chi dài quá 200 ký tự." };

  const amount = int(raw.amount);
  if (amount == null) return { ok: false, reason: "Thiếu số tiền, hoặc số tiền không phải số nguyên." };
  if (amount < MIN_AMOUNT) {
    return {
      ok: false,
      reason: `Số tiền ${amount}₫ nhỏ bất thường. Nếu người dùng nói "350k" thì amount phải là 350000.`
    };
  }
  if (amount > MAX_AMOUNT) {
    return { ok: false, reason: `Số tiền ${amount}₫ lớn bất thường — hỏi lại cho chắc.` };
  }

  const category = EXPENSE_CATEGORIES.includes(str(raw.category) as ExpenseCategory)
    ? (str(raw.category) as ExpenseCategory)
    : "other";

  // Không nói rõ ai trả thì mặc định là người đang chat.
  const wanted = str(raw.paidBy) || ctx.actorZaloId || "";
  const payer = findMember(wanted, ctx.members);
  if (!payer) {
    return {
      ok: false,
      reason: ctx.members.length
        ? `Chưa rõ ai trả. Chọn một trong: ${ctx.members.map((m) => m.displayName).join(", ")}.`
        : "Chuyến này chưa có thành viên nào để ghi người trả."
    };
  }

  const splitWith: string[] = [];
  if (Array.isArray(raw.splitWith)) {
    for (const s of raw.splitWith) {
      const m = findMember(str(s), ctx.members);
      if (!m) return { ok: false, reason: `Không có thành viên nào tên "${str(s)}" trong chuyến này.` };
      if (!splitWith.includes(m.zaloUserId)) splitWith.push(m.zaloUserId);
    }
  }

  return {
    ok: true,
    value: {
      kind: "expense",
      title,
      amount,
      category,
      paidBy: payer.zaloUserId,
      paidByName: payer.displayName,
      splitWith
    }
  };
}

export function normalizeNote(raw: Record<string, unknown>): Normalized<Proposal> {
  const content = str(raw.content);
  if (!content) return { ok: false, reason: "Thiếu nội dung ghi chú." };
  if (content.length > 500) return { ok: false, reason: "Ghi chú dài quá 500 ký tự." };
  const noteKind = NOTE_KINDS.includes(str(raw.noteKind) as NoteKind)
    ? (str(raw.noteKind) as NoteKind)
    : "note";
  return { ok: true, value: { kind: "note", content, noteKind } };
}

export function normalizeEvent(raw: Record<string, unknown>, ctx: ProposalContext): Normalized<Proposal> {
  const title = str(raw.title);
  if (!title) return { ok: false, reason: "Thiếu tên hoạt động." };
  if (title.length > 200) return { ok: false, reason: "Tên hoạt động dài quá 200 ký tự." };

  const date = str(raw.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, reason: "Thiếu ngày, hoặc ngày không đúng dạng yyyy-mm-dd." };
  }
  const time = str(raw.time) || "09:00";
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return { ok: false, reason: "Giờ không đúng dạng HH:mm." };
  }

  const startsAt = `${date}T${time}:00+07:00`;
  const at = new Date(startsAt);
  if (Number.isNaN(at.getTime())) return { ok: false, reason: "Ngày giờ không hợp lệ." };

  // Chặn mục rơi ra ngoài chuyến đi. Cho qua thì `checkTrip` sẽ báo lỗi
  // `event_outside_trip` ngay lượt soát kế tiếp — tự tạo việc cho mình.
  const day = ictDay(at.toISOString());
  const from = ictDay(ctx.tripStart);
  const to = ictDay(ctx.tripEnd);
  if (day < from || day > to) {
    return { ok: false, reason: `Ngày ${day} nằm ngoài chuyến đi (${from} → ${to}).` };
  }

  const eventKind = EVENT_KINDS.includes(str(raw.kind) as EventKind)
    ? (str(raw.kind) as EventKind)
    : "activity";

  const cost = raw.estimatedCost == null ? null : int(raw.estimatedCost);
  if (cost != null && (cost < 0 || cost > MAX_AMOUNT)) {
    return { ok: false, reason: `Chi phí ước tính ${cost}₫ không hợp lý.` };
  }

  return {
    ok: true,
    value: {
      kind: "event",
      title,
      startsAt: at.toISOString(),
      eventKind,
      location: str(raw.location) || null,
      note: str(raw.note) || null,
      estimatedCost: cost
    }
  };
}

/**
 * Chốt chỗ ở. Ngày nhận phòng mặc định là NGÀY ĐẦU chuyến, 14:00 giờ VN.
 *
 * Không bắt model tự chọn ngày: nó không có lý do gì để biết, và đoán sai thì
 * mục lịch trình rơi vào ngày trống rồi `checkTrip` lại báo lỗi.
 */
export function normalizeStay(raw: Record<string, unknown>, ctx: ProposalContext): Normalized<Proposal> {
  const title = str(raw.title);
  if (!title) return { ok: false, reason: "Thiếu tên chỗ ở." };
  if (title.length > 200) return { ok: false, reason: "Tên chỗ ở dài quá 200 ký tự." };

  const date = str(raw.date) || ictDay(ctx.tripStart);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, reason: "Ngày nhận phòng không đúng dạng yyyy-mm-dd." };
  }
  const from = ictDay(ctx.tripStart);
  const to = ictDay(ctx.tripEnd);
  if (date < from || date > to) {
    return { ok: false, reason: `Ngày ${date} nằm ngoài chuyến đi (${from} → ${to}).` };
  }

  const time = str(raw.time) || "14:00";
  if (!/^\d{2}:\d{2}$/.test(time)) return { ok: false, reason: "Giờ nhận phòng không đúng dạng HH:mm." };

  const at = new Date(`${date}T${time}:00+07:00`);
  if (Number.isNaN(at.getTime())) return { ok: false, reason: "Ngày giờ nhận phòng không hợp lệ." };

  return {
    ok: true,
    value: {
      kind: "stay",
      title,
      startsAt: at.toISOString(),
      location: str(raw.location) || null,
      priceHint: str(raw.priceHint) || null,
      partnerOaId: str(raw.partnerOaId) || null,
      imageUrl: safeImageUrl(str(raw.imageUrl)),
      note: str(raw.note) || null
    }
  };
}

/**
 * Ảnh chỉ nhận http(s). Ảnh đi từ danh bạ ra client rồi quay lại server, nên
 * vẫn phải lọc: `javascript:` hay `data:` lọt vào `<img src>` là chuyện có thật.
 */
function safeImageUrl(s: string): string | null {
  return /^https?:\/\/[^\s'"<>]+$/i.test(s) ? s : null;
}

/** Khớp theo zaloUserId trước, rồi tới tên (không phân biệt hoa thường). */
function findMember(
  wanted: string,
  members: { zaloUserId: string; displayName: string }[]
): { zaloUserId: string; displayName: string } | null {
  if (!wanted) return null;
  const byId = members.find((m) => m.zaloUserId === wanted);
  if (byId) return byId;
  const lower = wanted.toLowerCase();
  return members.find((m) => m.displayName.toLowerCase() === lower) ?? null;
}

/** Kiểm lại đề xuất do client gửi lên. Không tin thẻ, kể cả thẻ do chính mình dựng. */
export function revalidate(p: unknown, ctx: ProposalContext): Normalized<Proposal> {
  if (!p || typeof p !== "object") return { ok: false, reason: "Đề xuất rỗng." };
  const raw = p as Record<string, unknown>;
  switch (raw.kind) {
    case "expense":
      return normalizeExpense(raw, ctx);
    case "note":
      return normalizeNote(raw);
    case "stay":
      return normalizeStay(
        {
          ...raw,
          date: typeof raw.startsAt === "string" ? ictDay(raw.startsAt) : "",
          time:
            typeof raw.startsAt === "string"
              ? new Date(new Date(raw.startsAt).getTime() + ICT_OFFSET_MS)
                  .toISOString()
                  .slice(11, 16)
              : ""
        },
        ctx
      );
    case "event":
      // `normalizeEvent` nhận date/time rời, còn đề xuất đã gộp thành `startsAt`.
      return normalizeEvent(
        {
          ...raw,
          date: typeof raw.startsAt === "string" ? ictDay(raw.startsAt) : "",
          time:
            typeof raw.startsAt === "string"
              ? new Date(new Date(raw.startsAt).getTime() + ICT_OFFSET_MS)
                  .toISOString()
                  .slice(11, 16)
              : "",
          kind: raw.eventKind
        },
        ctx
      );
    default:
      return { ok: false, reason: `Loại hành động không hỗ trợ: ${String(raw.kind)}` };
  }
}

export function formatVnd(n: number): string {
  return `${Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}₫`;
}

/** Chữ trên thẻ xác nhận. Phải nêu ĐỦ thứ sắp bị ghi để người dùng soát được. */
export function describeProposal(
  p: Proposal,
  ctx: ProposalContext
): { title: string; detail: string; confirmLabel: string } {
  switch (p.kind) {
    case "expense": {
      const who = p.splitWith.length
        ? p.splitWith
            .map((id) => ctx.members.find((m) => m.zaloUserId === id)?.displayName ?? id)
            .join(", ")
        : "cả nhóm";
      return {
        title: `Ghi khoản chi ${formatVnd(p.amount)} — ${p.title}`,
        detail: `${p.paidByName} trả · chia cho ${who} · mục ${CATEGORY_VI[p.category]}`,
        confirmLabel: "Ghi vào sổ"
      };
    }
    case "note":
      return {
        title: p.noteKind === "tip" ? "Lưu một mẹo" : "Lưu ghi chú",
        detail: p.content,
        confirmLabel: "Lưu"
      };
    case "event": {
      const d = new Date(new Date(p.startsAt).getTime() + ICT_OFFSET_MS);
      const hhmm = d.toISOString().slice(11, 16);
      const ddmm = `${d.toISOString().slice(8, 10)}/${d.toISOString().slice(5, 7)}`;
      return {
        title: `Thêm vào lịch trình: ${p.title}`,
        detail:
          `${ddmm} lúc ${hhmm}` +
          (p.location ? ` · ${p.location}` : "") +
          (p.estimatedCost ? ` · ${formatVnd(p.estimatedCost)}` : ""),
        confirmLabel: "Thêm vào lịch"
      };
    }
    case "stay": {
      const d = new Date(new Date(p.startsAt).getTime() + ICT_OFFSET_MS);
      const ddmm = `${d.toISOString().slice(8, 10)}/${d.toISOString().slice(5, 7)}`;
      return {
        title: `Chốt chỗ ở: ${p.title}`,
        detail: `Nhận phòng ${ddmm}` + (p.location ? ` · ${p.location}` : ""),
        confirmLabel: "Chọn"
      };
    }
  }
}

const CATEGORY_VI: Record<ExpenseCategory, string> = {
  food: "ăn uống",
  stay: "chỗ ở",
  transport: "di chuyển",
  ticket: "vé",
  shopping: "mua sắm",
  other: "khác"
};

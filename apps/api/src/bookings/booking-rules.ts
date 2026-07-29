/**
 * Đặt chỗ — phần THUẦN: trạng thái và việc tự sinh từ lịch trình.
 *
 * Vì sao đặt chỗ là bảng riêng chứ không phải thêm cột vào `events`:
 * `events.status` đang mang nghĩa "Zino tự động hoá tới đâu" (pending khi Zino
 * đang làm, failed khi hỏng). Trạng thái đặt chỗ là chuyện khác hẳn — nó nói
 * "nhóm đã đặt và trả tiền chưa", do NGƯỜI cập nhật. Nhét cả hai vào một cột
 * thì một mục `failed` không phân biệt được là "Zino đặt hộ không xong" hay
 * "nhóm huỷ rồi".
 *
 * Và không phải đặt chỗ nào cũng có khung giờ: bảo hiểm, đặt cọc, thuê xe máy
 * cả chuyến đều là đặt chỗ mà không nằm ở ô nào trong lịch trình.
 */

export const BOOKING_STATUSES = ["to_book", "booked", "paid", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_KINDS = ["stay", "transport", "ticket", "other"] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];

export const STATUS_LABEL: Record<BookingStatus, string> = {
  to_book: "Chưa đặt",
  booked: "Đã đặt",
  paid: "Đã trả",
  cancelled: "Đã huỷ"
};

/**
 * Đi MỘT CHIỀU: chưa đặt → đã đặt → đã trả. Huỷ được từ bất kỳ đâu.
 *
 * Cố tình không cho lùi bằng nút bấm. Lùi trạng thái gần như luôn là bấm nhầm,
 * và một cái nút "bỏ đánh dấu đã trả" đứng cạnh "đã trả" thì sớm muộn có người
 * bấm nhầm giữa lúc đang vội. Muốn sửa thật thì huỷ rồi tạo lại — hiếm, nhưng
 * rõ ràng, và có dấu vết.
 */
const NEXT: Record<BookingStatus, BookingStatus | null> = {
  to_book: "booked",
  booked: "paid",
  paid: null,
  cancelled: null
};

export function nextStatus(current: BookingStatus): BookingStatus | null {
  return NEXT[current] ?? null;
}

/** Nhãn nút đẩy sang bước kế. null = không còn bước nào. */
export function nextActionLabel(current: BookingStatus): string | null {
  const n = nextStatus(current);
  if (n === "booked") return "Đánh dấu đã đặt";
  if (n === "paid") return "Đánh dấu đã trả tiền";
  return null;
}

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  if (from === to) return false;
  if (to === "cancelled") return from !== "cancelled";
  // Huỷ rồi thì không tự sống lại — phải tạo mục mới.
  if (from === "cancelled") return false;
  return NEXT[from] === to;
}

/** Lý do từ chối, dùng làm câu báo lỗi cho người dùng chứ không chỉ để log. */
export function transitionError(from: BookingStatus, to: BookingStatus): string {
  if (from === to) return `Mục này đã ở trạng thái "${STATUS_LABEL[to]}" rồi.`;
  if (from === "cancelled") return "Mục này đã huỷ. Muốn dùng lại thì nhờ Zino tạo mục mới.";
  if (to === "cancelled") return "Không huỷ được mục này.";
  return `Không thể nhảy thẳng từ "${STATUS_LABEL[from]}" sang "${STATUS_LABEL[to]}".`;
}

/** Tiến độ để hiện thanh trên đầu màn. Mục đã huỷ không tính vào mẫu số. */
export function summarize(statuses: BookingStatus[]): {
  total: number;
  done: number;
  todo: number;
  percent: number;
} {
  const live = statuses.filter((s) => s !== "cancelled");
  const done = live.filter((s) => s === "paid").length;
  return {
    total: live.length,
    done,
    todo: live.filter((s) => s !== "paid").length,
    percent: live.length === 0 ? 0 : Math.round((done / live.length) * 100)
  };
}

export interface EventLike {
  id: number;
  title: string;
  kind: string;
  startsAt: string;
  estimatedCost: number | null;
  location: string | null;
  partnerOaId?: string | null;
}

export interface DraftBooking {
  eventId: number;
  kind: BookingKind;
  title: string;
  amount: number | null;
  provider: string | null;
  partnerOaId: string | null;
}

/**
 * Mục lịch trình nào cần đặt trước.
 *
 * `activity` và `food` bị bỏ qua có chủ ý: đi bộ ngắm bình minh hay ghé quán cà
 * phê thì không ai đặt chỗ, mà đưa vào là màn Đặt chỗ đầy những dòng không bao
 * giờ đổi trạng thái — rồi thanh tiến độ vĩnh viễn không bao giờ đầy.
 */
const KIND_MAP: Record<string, BookingKind> = {
  stay: "stay",
  transport: "transport",
  flight: "transport",
  ticket: "ticket"
};

/**
 * Sinh đặt chỗ từ lịch trình, BỎ QUA mục đã có đặt chỗ rồi.
 *
 * `existingEventIds` là chốt chặn chống trùng ở tầng logic; DB còn một khoá duy
 * nhất trên `event_id` nữa. Hai lớp vì hàm này chạy lại mỗi lần mở màn, và một
 * lần chạy đôi vì bấm nhanh hai lần là danh sách có hai dòng y hệt nhau.
 */
export function bookingsFromEvents(
  events: EventLike[],
  existingEventIds: number[] = []
): DraftBooking[] {
  const seen = new Set(existingEventIds);
  const out: DraftBooking[] = [];

  for (const e of events) {
    const kind = KIND_MAP[e.kind];
    if (!kind) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);

    out.push({
      eventId: e.id,
      kind,
      title: e.title,
      amount: e.estimatedCost == null ? null : Number(e.estimatedCost),
      provider: e.location,
      partnerOaId: e.partnerOaId ?? null
    });
  }
  return out;
}

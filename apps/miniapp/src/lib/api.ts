// Client gọi backend BFF. Base URL inject lúc build (VITE_API_BASE_URL).
const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export interface Trip {
  id: number;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  status: string;
  budgetPerPerson: number | null;
}

export interface TripEvent {
  id: number;
  tripId: number;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  kind: string;
  note: string | null;
  estimatedCost: number | null;
}

export interface Expense {
  id: number;
  tripId: number;
  title: string;
  amount: number;
  category: string;
  paidBy: string;
  paidByName: string | null;
  receiptPhotoUrl: string | null;
  spentAt: string;
}

export interface Photo {
  id: number;
  tripId: number;
  url: string;
  caption: string | null;
  uploaderName: string | null;
  takenAt: string;
}

export interface Note {
  id: number;
  content: string;
  kind: string;
  authorName: string | null;
  takenAt: string;
}

export interface Member {
  id: number;
  zaloUserId: string;
  displayName: string;
}

export interface Activity {
  id: number;
  kind: string;
  content: string;
  createdAt: string;
}

/** Kết quả chia tiền — tính ở server bằng CHUNG hàm với agent, client không tính lại. */
export interface Settlement {
  totalSpent: number;
  perMember: {
    zaloUserId: string;
    displayName: string;
    paid: number;
    owed: number;
    net: number;
  }[];
  settlements: { from: string; fromName: string; to: string; toName: string; amount: number }[];
  roundingAdjustment: number;
  warnings: string[];
}

/** OA đối tác — Zalo không có API search OA nên đây là directory tự dựng. */
export interface Partner {
  id: number;
  oaId: string;
  name: string;
  category: string;
  city: string;
  description: string | null;
  priceHint: string | null;
  tags: string | null;
  deeplink: string | null;
}

export interface FullTrip {
  trip: Trip;
  events: TripEvent[];
  expenses: Expense[];
  photos: Photo[];
  notes: Note[];
  members: Member[];
  activities: Activity[];
  settlement: Settlement;
}

/* ------------------------------------------------------------------ *
 * Trang tổng kết — dữ liệu đã được server gom sẵn (theo ngày, theo
 * hạng mục). Cùng payload với trang web /trip/:id/ nên hai bên không
 * thể lệch số: chỉ có một chỗ tính, ở server.
 * ------------------------------------------------------------------ */

export interface RecapDayItem {
  id: number;
  time: string;
  title: string;
  location: string | null;
  kind: string;
  kindLabel: string;
  note: string | null;
  estimatedCost: number | null;
}

export interface RecapDay {
  date: string;
  index: number;
  label: string;
  items: RecapDayItem[];
  estimatedCost: number;
}

export interface RecapCategory {
  category: string;
  label: string;
  amount: number;
  share: number;
}

export interface RecapStats {
  dayCount: number;
  memberCount: number;
  photoCount: number;
  noteCount: number;
  eventCount: number;
  totalSpent: number;
  perPerson: number;
  budgetTotal: number | null;
  budgetRemaining: number | null;
}

export interface Recap {
  trip: Trip;
  stats: RecapStats;
  days: RecapDay[];
  byCategory: RecapCategory[];
  expenses: Expense[];
  photos: Photo[];
  notes: Note[];
  members: Member[];
  settlement: Settlement;
  generatedAt: string;
}

export const api = {
  trips: () => request<Trip[]>("/trips"),
  trip: (id: number) => request<Trip>(`/trips/${id}`),

  /** Lịch trình gom theo ngày + chi tiêu theo hạng mục — 1 request cho cả màn. */
  recap: (id: number) => request<Recap>(`/trips/${id}/recap`),

  /** Gộp mọi thứ trong 1 request — webview trên 3G thấy rõ từng round-trip. */
  full: (id: number) => request<FullTrip>(`/trips/${id}/full`),

  events: (tripId: number) => request<TripEvent[]>(`/trips/${tripId}/events`),
  expenses: (tripId: number) => request<Expense[]>(`/trips/${tripId}/expenses`),
  photos: (tripId: number) => request<Photo[]>(`/trips/${tripId}/photos`),
  notes: (tripId: number) => request<Note[]>(`/trips/${tripId}/notes`),
  members: (tripId: number) => request<Member[]>(`/trips/${tripId}/members`),
  settle: (tripId: number) => request<Settlement>(`/trips/${tripId}/settle`),

  partners: (opts: { city?: string; category?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.city) q.set("city", opts.city);
    if (opts.category) q.set("category", opts.category);
    const qs = q.toString();
    return request<Partner[]>(`/partners${qs ? `?${qs}` : ""}`);
  }
};

/**
 * Link trang tổng kết công khai — mở được bằng trình duyệt thường, không cần
 * Zalo, không cần nằm trong danh sách thử nghiệm Mini App.
 *
 * Suy từ VITE_API_BASE_URL (bỏ hậu tố `/api`) để khỏi thêm một biến môi trường
 * nữa phải nhớ đồng bộ. Muốn trỏ chỗ khác thì đặt VITE_PUBLIC_BASE_URL.
 */
export function recapPageUrl(tripId: number): string {
  const override = (import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined)?.replace(/\/$/, "");
  if (override) return `${override}/trip/${tripId}/`;

  // Luôn dùng route API, KHÔNG dùng `/trip/:id/`.
  //
  // `/trip/:id/` là file TĨNH, chỉ tồn tại sau khi job recap của Zino chạy xong.
  // Chuyến vừa tạo — hoặc chuyến seed thẳng vào DB — thì file chưa có và nginx
  // trả 404, người dùng thấy "not found" và tưởng app hỏng.
  //
  // `/trips/:id/recap.html` dựng trang ngay lúc request nên lúc nào cũng có, và
  // nội dung y hệt (cùng renderRecapHtml). Link `/trip/:id/` đẹp hơn thì để dành
  // cho Zino gửi trong chat — lúc đó nó đã thật sự dựng xong file.
  return `${BASE.replace(/\/$/, "")}/trips/${tripId}/recap.html`;
}

/**
 * Chuyến đi đang xem: ưu tiên `?trip=<id>` trên URL (Zino gửi link kèm id),
 * không có thì lấy chuyến mới nhất.
 */
export async function resolveActiveTrip(): Promise<number | null> {
  const fromUrl = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("trip");
  if (fromUrl && Number.isFinite(Number(fromUrl))) return Number(fromUrl);
  const trips = await api.trips();
  return trips[0]?.id ?? null;
}

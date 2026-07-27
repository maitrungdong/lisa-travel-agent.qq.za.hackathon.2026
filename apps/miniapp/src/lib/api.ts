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

export const api = {
  trips: () => request<Trip[]>("/trips"),
  trip: (id: number) => request<Trip>(`/trips/${id}`),

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
 * Chuyến đi đang xem: ưu tiên `?trip=<id>` trên URL (Lisa gửi link kèm id),
 * không có thì lấy chuyến mới nhất.
 */
export async function resolveActiveTrip(): Promise<number | null> {
  const fromUrl = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("trip");
  if (fromUrl && Number.isFinite(Number(fromUrl))) return Number(fromUrl);
  const trips = await api.trips();
  return trips[0]?.id ?? null;
}

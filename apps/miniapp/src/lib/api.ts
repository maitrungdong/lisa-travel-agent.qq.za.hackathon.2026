import { errorMessage } from "./api-error";

// Client gọi backend BFF. Base URL inject lúc build (VITE_API_BASE_URL).
const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init
  });
  // Giữ nguyên câu server nói vì sao từ chối, đừng thu về mỗi mã số.
  if (!res.ok) throw new Error(await errorMessage(res, path));
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

/**
 * Chuyến đi kèm số liệu tóm tắt — dạng GET /trips trả về.
 * Chỉ đủ cho sheet đổi chuyến; muốn chi tiết thì gọi /full hoặc /recap.
 */
export interface TripSummary extends Trip {
  memberCount: number;
  totalSpent: number;
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
  /** pending (Zino đang làm) | done | failed — lỗi phải hiện, không được ẩn */
  status?: string;
  failReason?: string | null;
  source?: string;
  bookingRef?: string | null;
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
  /** user | zino — khoản của Zino kèm txnCode thì số tiền bị khoá */
  source?: string;
  txnCode?: string | null;
  note?: string | null;
  createdBy?: string | null;
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
  /** member | organizer — chỉ người tổ chức mới chốt được phương án */
  role?: string;
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

/* ------------------------------------------------------------------ *
 * J2 — Quyết định nhóm. Bàn ở chat, chốt ở app.
 * ------------------------------------------------------------------ */

export interface DecisionOption {
  id: number;
  label: string;
  detail: string | null;
  price: number | null;
  partnerOaId: string | null;
  votes: number;
  voterNames: string[];
  isRecommended: boolean;
}

export interface Decision {
  id: number;
  tripId: number;
  kind: string;
  title: string;
  /** open | tie | decided | cancelled */
  status: string;
  recommendedOptionId: number | null;
  recommendationReason: string | null;
  decidedOptionId: number | null;
  decidedByName: string | null;
  decidedAt: string | null;
  againstMajority: boolean;
  options: DecisionOption[];
  /** Ai chưa bình chọn — wireframe bắt buộc hiện */
  pendingNames: string[];
  totalVotes: number;
  memberCount: number;
  isTie: boolean;
}

/* ------------------------------------------------------------------ *
 * Chat trong app. Zalo Bot API không gửi được nút bấm, nên "thẻ hành
 * động" chỉ tồn tại ở đây. `kind` là tập ĐÓNG — app phải biết cách xử lý
 * mọi giá trị, không để server bịa ra kiểu mới rồi render nút chết.
 * ------------------------------------------------------------------ */

export interface ChatAction {
  kind:
    | "open_tab"
    | "scroll_to_event"
    | "open_decision"
    | "add_expense"
    | "scan_qr"
    | "copy_to_chat";
  label: string;
  value?: string;
}

export interface ChatCard {
  level: "error" | "warn" | "info" | "neutral";
  title: string;
  detail?: string;
  actions: ChatAction[];
}

export interface ChatReply {
  text: string;
  cards: ChatCard[];
  /** deterministic = tính bằng code · llm = model viết và qua được cổng kiểm chứng */
  source: "deterministic" | "llm";
  /** Tool nào đã chạy — hiện lên UI để biết số liệu lấy từ đâu */
  usedTools?: string[];
  /** Có = câu của model bị chặn vì số không khớp dữ liệu */
  gateBlocked?: string;
  /** Có = agent không chạy được, câu này do code tính */
  degraded?: string;
}

export const api = {
  chat: (
    tripId: number,
    body: { message: string; actorZaloId?: string; actorName?: string }
  ) => request<ChatReply>(`/trips/${tripId}/chat`, { method: "POST", body: JSON.stringify(body) }),

  trips: () => request<TripSummary[]>("/trips"),
  trip: (id: number) => request<Trip>(`/trips/${id}`),

  decisions: (tripId: number) => request<Decision[]>(`/trips/${tripId}/decisions`),
  activeDecision: (tripId: number) =>
    request<{ decision: Decision | null }>(`/trips/${tripId}/decisions/active`),

  vote: (decisionId: number, optionId: number, actor: { zaloUserId: string; displayName: string }) =>
    request<Decision>(`/decisions/${decisionId}/vote`, {
      method: "POST",
      body: JSON.stringify({ optionId, ...actor })
    }),

  decide: (decisionId: number, optionId: number, actor: { zaloUserId: string; displayName: string }) =>
    request<{ view: Decision; alreadyDecided: boolean }>(`/decisions/${decisionId}/decide`, {
      method: "POST",
      body: JSON.stringify({ optionId, ...actor })
    }),

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

  /* --- J4: người dùng tự ghi sổ ------------------------------------- */

  addExpense: (
    tripId: number,
    body: {
      actorZaloId: string;
      actorName?: string;
      title: string;
      amount: number;
      category: string;
      paidBy: string;
      paidByName?: string;
      splitWith?: string[];
      spentAt?: string;
      note?: string;
    }
  ) => request<Expense>(`/trips/${tripId}/expenses/user`, { method: "POST", body: JSON.stringify(body) }),

  editExpense: (
    id: number,
    body: {
      actorZaloId: string;
      title?: string;
      amount?: number;
      category?: string;
      paidBy?: string;
      splitWith?: string[];
      note?: string;
    }
  ) =>
    request<{ expense: Expense; rejected: string[] }>(`/expenses/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),

  deleteExpense: (id: number, actorZaloId: string) =>
    request<{ ok: boolean }>(`/expenses/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ actorZaloId })
    }),

  paidPairs: (tripId: number) =>
    request<{ pairs: { from: string; to: string; amount: number; tickedBy: string | null }[] }>(
      `/trips/${tripId}/settlement/paid`
    ),

  tickPaid: (
    tripId: number,
    body: { actorZaloId: string; fromUserId: string; toUserId: string; amount: number; paid: boolean }
  ) =>
    request<{ paid: boolean }>(`/trips/${tripId}/settlement/paid`, {
      method: "POST",
      body: JSON.stringify(body)
    }),

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
  //
  // `?t=` để phá cache của webview Zalo. Server đã gửi `Cache-Control: no-store`
  // nhưng webview trong ứng dụng vẫn giữ lại bản cũ — deploy trang mới xong mở
  // ra vẫn thấy trang cũ. Mà kể cả không có chuyện đó thì trang này vẫn phải
  // luôn mới: mỗi khoản chi hay tấm ảnh thêm vào là nội dung đã khác.
  return `${BASE.replace(/\/$/, "")}/trips/${tripId}/recap.html?t=${Date.now()}`;
}

// `resolveActiveTrip` đã chuyển sang ./active-trip — nó cần danh sách chuyến đã
// nhớ sẵn ở đó để kiểm tra id trên URL còn tồn tại không.

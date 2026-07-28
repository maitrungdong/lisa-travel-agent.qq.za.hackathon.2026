/**
 * Trang tổng kết chuyến đi (`/trip/:id/`).
 *
 * Vì sao module này là HÀM THUẦN, không I/O, không NestJS:
 *   Bản cũ để Claude sinh nguyên file HTML. Đẹp thì đẹp nhưng mỗi lần chạy ra
 *   một kiểu, và nếu LLM lỗi giữa demo thì không có gì để chiếu. Số liệu trên
 *   trang tổng kết còn phải KHỚP TỪNG ĐỒNG với màn Chi phí của Mini App —
 *   thứ đó không được phép phụ thuộc vào việc model hôm nay có ngoan hay không.
 *
 *   Nên: bố cục + số liệu do code dựng (tất định, có unit test); LLM chỉ được
 *   viết đúng một đoạn lời tựa, và thiếu đoạn đó trang vẫn đầy đủ.
 *
 * Múi giờ: mọi phép gom theo ngày đều quy về ICT (UTC+7) bằng cách cộng offset
 * rồi đọc bằng getUTC* — kết quả không đổi dù server chạy ở TZ nào.
 */

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

export type DateLike = Date | string;

export interface RecapTripInput {
  id: number;
  name: string;
  destination: string;
  startDate: DateLike;
  endDate: DateLike;
  status: string;
  budgetPerPerson: number | null;
}

export interface RecapEventInput {
  id: number;
  title: string;
  startsAt: DateLike;
  endsAt?: DateLike | null;
  location: string | null;
  kind: string;
  note: string | null;
  estimatedCost: number | null;
}

export interface RecapExpenseInput {
  id: number;
  title: string;
  amount: number;
  category: string;
  paidByName: string | null;
  receiptPhotoUrl: string | null;
  spentAt: DateLike;
}

export interface RecapPhotoInput {
  id: number;
  url: string;
  caption: string | null;
  uploaderName: string | null;
  takenAt: DateLike;
}

export interface RecapNoteInput {
  id: number;
  content: string;
  kind: string;
  authorName: string | null;
  takenAt: DateLike;
}

export interface RecapMemberInput {
  zaloUserId: string;
  displayName: string;
}

export interface RecapSettlementInput {
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

export interface RecapInput {
  trip: RecapTripInput;
  events: RecapEventInput[];
  expenses: RecapExpenseInput[];
  photos: RecapPhotoInput[];
  notes: RecapNoteInput[];
  members: RecapMemberInput[];
  settlement: RecapSettlementInput;
}

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
  /** yyyy-mm-dd theo giờ VN */
  date: string;
  /** Thứ tự trong chuyến: 1, 2, 3... */
  index: number;
  label: string;
  items: RecapDayItem[];
  estimatedCost: number;
}

export interface RecapCategory {
  category: string;
  label: string;
  amount: number;
  /** 0–100, làm tròn 1 chữ số — dùng vẽ thanh tỉ trọng */
  share: number;
}

export interface RecapPayload {
  trip: RecapTripInput & { startDate: string; endDate: string };
  stats: {
    dayCount: number;
    memberCount: number;
    photoCount: number;
    noteCount: number;
    eventCount: number;
    totalSpent: number;
    /** Chi thực tế bình quân đầu người */
    perPerson: number;
    /** Ngân sách cả nhóm (budgetPerPerson × số người), null nếu chưa đặt */
    budgetTotal: number | null;
    /** budgetTotal − totalSpent. Dương = còn dư. null nếu chưa đặt ngân sách */
    budgetRemaining: number | null;
  };
  days: RecapDay[];
  byCategory: RecapCategory[];
  expenses: (RecapExpenseInput & { spentAt: string })[];
  photos: (RecapPhotoInput & { takenAt: string })[];
  notes: (RecapNoteInput & { takenAt: string })[];
  members: RecapMemberInput[];
  settlement: RecapSettlementInput;
  generatedAt: string;
}

export const KIND_LABEL: Record<string, string> = {
  flight: "Di chuyển",
  stay: "Chỗ ở",
  food: "Ăn uống",
  activity: "Hoạt động",
  transport: "Di chuyển",
  other: "Khác"
};

export const CATEGORY_LABEL: Record<string, string> = {
  food: "Ăn uống",
  stay: "Chỗ ở",
  transport: "Di chuyển",
  ticket: "Vé",
  shopping: "Mua sắm",
  other: "Khác"
};

const WEEKDAY = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

function toDate(v: DateLike): Date {
  return v instanceof Date ? v : new Date(v);
}

/** Đẩy về "giờ VN" rồi đọc bằng getUTC* — độc lập TZ của server. */
function ict(v: DateLike): Date {
  return new Date(toDate(v).getTime() + ICT_OFFSET_MS);
}

/** yyyy-mm-dd theo giờ VN. */
export function ictDateKey(v: DateLike): string {
  const d = ict(v);
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

/** HH:mm theo giờ VN. */
export function ictTime(v: DateLike): string {
  const d = ict(v);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** "Thứ ba, 12/08" theo giờ VN. */
export function ictDayLabel(v: DateLike): string {
  const d = ict(v);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${WEEKDAY[d.getUTCDay()]}, ${day}/${month}`;
}

/** Số ngày của chuyến, tính bao gồm cả ngày đầu và ngày cuối (12→14/8 = 3 ngày). */
export function tripDayCount(start: DateLike, end: DateLike): number {
  const a = Date.parse(`${ictDateKey(start)}T00:00:00Z`);
  const b = Date.parse(`${ictDateKey(end)}T00:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

export function formatVnd(amount: number): string {
  // Không dùng Intl.NumberFormat: output phụ thuộc phiên bản ICU của môi trường
  // (có bản chèn U+00A0 trước ₫, có bản không) → snapshot test sẽ vỡ vô cớ.
  const sign = amount < 0 ? "-" : "";
  const digits = Math.abs(Math.round(amount)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped}₫`;
}

/**
 * Gom dữ liệu thô thành payload cho trang tổng kết và cho Mini App.
 * Một nguồn sự thật duy nhất: trang web và Mini App đọc cùng payload này.
 */
export function buildRecap(input: RecapInput, now: DateLike = new Date()): RecapPayload {
  const { trip, events, expenses, photos, notes, members, settlement } = input;

  // --- Lịch trình gom theo ngày ---------------------------------------------
  const sorted = [...events].sort(
    (a, b) => toDate(a.startsAt).getTime() - toDate(b.startsAt).getTime()
  );
  const byDay = new Map<string, RecapDayItem[]>();
  for (const e of sorted) {
    const key = ictDateKey(e.startsAt);
    const item: RecapDayItem = {
      id: e.id,
      time: ictTime(e.startsAt),
      title: e.title,
      location: e.location,
      kind: e.kind,
      kindLabel: KIND_LABEL[e.kind] ?? "Hoạt động",
      note: e.note,
      estimatedCost: e.estimatedCost == null ? null : Number(e.estimatedCost)
    };
    const bucket = byDay.get(key);
    if (bucket) bucket.push(item);
    else byDay.set(key, [item]);
  }

  const days: RecapDay[] = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items], i) => ({
      date,
      index: i + 1,
      label: ictDayLabel(`${date}T00:00:00+07:00`),
      items,
      estimatedCost: items.reduce((s, it) => s + (it.estimatedCost ?? 0), 0)
    }));

  // --- Chi tiêu theo hạng mục ----------------------------------------------
  const totals = new Map<string, number>();
  for (const e of expenses) {
    totals.set(e.category, (totals.get(e.category) ?? 0) + Number(e.amount));
  }
  const totalSpent = Number(settlement.totalSpent) || [...totals.values()].reduce((s, v) => s + v, 0);
  const byCategory: RecapCategory[] = [...totals.entries()]
    .map(([category, amount]) => ({
      category,
      label: CATEGORY_LABEL[category] ?? category,
      amount,
      share: totalSpent > 0 ? Math.round((amount / totalSpent) * 1000) / 10 : 0
    }))
    .sort((a, b) => b.amount - a.amount);

  const memberCount = members.length;
  const budgetTotal =
    trip.budgetPerPerson != null && memberCount > 0 ? trip.budgetPerPerson * memberCount : null;

  return {
    trip: {
      ...trip,
      startDate: toDate(trip.startDate).toISOString(),
      endDate: toDate(trip.endDate).toISOString()
    },
    stats: {
      dayCount: tripDayCount(trip.startDate, trip.endDate),
      memberCount,
      photoCount: photos.length,
      noteCount: notes.length,
      eventCount: events.length,
      totalSpent,
      perPerson: memberCount > 0 ? Math.round(totalSpent / memberCount) : 0,
      budgetTotal,
      budgetRemaining: budgetTotal == null ? null : budgetTotal - totalSpent
    },
    days,
    byCategory,
    expenses: [...expenses]
      .sort((a, b) => toDate(a.spentAt).getTime() - toDate(b.spentAt).getTime())
      .map((e) => ({ ...e, amount: Number(e.amount), spentAt: toDate(e.spentAt).toISOString() })),
    photos: photos.map((p) => ({ ...p, takenAt: toDate(p.takenAt).toISOString() })),
    notes: notes.map((n) => ({ ...n, takenAt: toDate(n.takenAt).toISOString() })),
    members,
    settlement,
    generatedAt: toDate(now).toISOString()
  };
}

/** Chặn HTML injection từ caption/ghi chú do user nhập. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape cho giá trị nằm trong thuộc tính url (src/href). */
function escapeUrl(s: string): string {
  // Chỉ cho http(s) và đường dẫn tương đối — chặn javascript:/data:
  return /^(https?:\/\/|\/)/i.test(s) ? escapeHtml(s) : "";
}

export interface RenderRecapOptions {
  /** Lời tựa do Zino viết. Không có thì trang vẫn đầy đủ. */
  intro?: string | null;
  /** Dùng cho thẻ og:url — link chia sẻ ra ngoài. */
  publicUrl?: string | null;
}

/**
 * Dựng file HTML self-contained (CSS inline, không CDN, không JS ngoài).
 * Trang này mở bằng link thường — giám khảo không cần cài gì, không cần Zalo.
 */
export function renderRecapHtml(data: RecapPayload, opts: RenderRecapOptions = {}): string {
  const { trip, stats, days, byCategory, photos, notes, settlement } = data;
  const title = `${trip.name} — Zino`;
  const dateRange = `${ictDayLabel(trip.startDate)} → ${ictDayLabel(trip.endDate)}`;

  const intro = opts.intro?.trim()
    ? `<p class="intro">${escapeHtml(opts.intro.trim())}</p>`
    : "";

  const ogUrl = opts.publicUrl ? `<meta property="og:url" content="${escapeHtml(opts.publicUrl)}">` : "";
  // og:image cũng phải qua escapeUrl — ảnh đầu tiên là dữ liệu từ chat, không tin được
  const ogImageSrc = photos[0]?.url ? escapeUrl(photos[0].url) : "";
  const ogImage = ogImageSrc ? `<meta property="og:image" content="${ogImageSrc}">` : "";

  const statCards = [
    { v: String(stats.dayCount), l: "ngày" },
    { v: String(stats.memberCount), l: "người" },
    { v: String(stats.photoCount), l: "ảnh" },
    { v: formatVnd(stats.perPerson), l: "mỗi người" }
  ]
    .map((s) => `<div class="stat"><b>${escapeHtml(s.v)}</b><span>${escapeHtml(s.l)}</span></div>`)
    .join("");

  const timeline = days.length
    ? days
        .map(
          (d) => `<section class="day">
      <h3><i>Ngày ${d.index}</i>${escapeHtml(d.label)}</h3>
      <ol>
        ${d.items
          .map(
            (it) => `<li>
          <time>${escapeHtml(it.time)}</time>
          <div>
            <p class="t">${escapeHtml(it.title)}</p>
            ${it.location ? `<p class="m">📍 ${escapeHtml(it.location)}</p>` : ""}
            ${it.note ? `<p class="m">${escapeHtml(it.note)}</p>` : ""}
          </div>
          ${it.estimatedCost ? `<span class="c">${formatVnd(it.estimatedCost)}</span>` : ""}
        </li>`
          )
          .join("")}
      </ol>
    </section>`
        )
        .join("")
    : `<p class="empty">Chuyến này chưa có lịch trình được ghi lại.</p>`;

  const budgetLine =
    stats.budgetRemaining == null
      ? ""
      : `<p class="budget ${stats.budgetRemaining >= 0 ? "ok" : "over"}">
        ${
          stats.budgetRemaining >= 0
            ? `Còn dư ${formatVnd(stats.budgetRemaining)} so với ngân sách`
            : `Vượt ngân sách ${formatVnd(-stats.budgetRemaining)}`
        }
      </p>`;

  const categoryBars = byCategory
    .map(
      (c) => `<div class="bar">
      <div class="bar-h"><span>${escapeHtml(c.label)}</span><b>${formatVnd(c.amount)}</b></div>
      <div class="track"><div style="width:${c.share}%"></div></div>
    </div>`
    )
    .join("");

  const settleRows = settlement.settlements.length
    ? `<ul class="settle">${settlement.settlements
        .map(
          (s) =>
            `<li><span>${escapeHtml(s.fromName)}</span><em>→</em><span>${escapeHtml(
              s.toName
            )}</span><b>${formatVnd(s.amount)}</b></li>`
        )
        .join("")}</ul>`
    : `<p class="empty">Cả nhóm đã hoà nhau — không ai nợ ai 🎉</p>`;

  const gallery = photos.length
    ? `<div class="grid">${photos
        .map((p) => {
          const src = escapeUrl(p.url);
          if (!src) return "";
          return `<figure><img src="${src}" alt="${escapeHtml(
            p.caption ?? "Ảnh chuyến đi"
          )}" loading="lazy">${
            p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ""
          }</figure>`;
        })
        .join("")}</div>`
    : "";

  const noteList = notes.length
    ? `<ul class="notes">${notes
        .map(
          (n) =>
            `<li><p>${escapeHtml(n.content)}</p><span>${escapeHtml(
              n.authorName ?? "Zino"
            )} · ${escapeHtml(ictDayLabel(n.takenAt))}</span></li>`
        )
        .join("")}</ul>`
    : "";

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(`${trip.destination} · ${dateRange}`)}">
<meta property="og:title" content="${escapeHtml(trip.name)}">
<meta property="og:description" content="${escapeHtml(`${trip.destination} · ${dateRange}`)}">
<meta property="og:type" content="article">
${ogUrl}
${ogImage}
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--ink:#0b2b2b;--muted:#5b7373;--line:#e2eceb;--teal:#0f766e;--amber:#f59e0b;--bg:#f7faf9}
body{font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased}
.wrap{max-width:680px;margin:0 auto;padding:0 20px 64px}
header.hero{background:linear-gradient(160deg,#0f766e,#134e4a);color:#fff;padding:48px 20px 40px;text-align:center}
header.hero .k{font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.75}
header.hero h1{font-size:30px;line-height:1.25;margin:8px 0 6px;font-weight:800}
header.hero p{opacity:.9;font-size:15px}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:-28px auto 0;max-width:640px;padding:0 20px}
.stat{background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px 6px;text-align:center;box-shadow:0 6px 20px rgba(15,118,110,.07)}
.stat b{display:block;font-size:15px;font-weight:700}
.stat span{font-size:11px;color:var(--muted)}
.intro{margin:28px 0 0;padding:16px 18px;background:#fff;border:1px solid var(--line);border-left:3px solid var(--amber);border-radius:12px;font-size:15px;color:#334}
h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:36px 0 12px;font-weight:700}
.day{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:12px}
.day h3{font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px;margin-bottom:10px}
.day h3 i{font-style:normal;background:var(--teal);color:#fff;font-size:11px;padding:3px 8px;border-radius:999px}
.day ol{list-style:none}
.day li{display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line)}
.day li:first-child{border-top:0}
.day time{flex:0 0 44px;font-size:13px;font-weight:600;color:var(--teal);padding-top:1px}
.day li>div{flex:1;min-width:0}
.day .t{font-weight:600;font-size:15px}
.day .m{font-size:13px;color:var(--muted)}
.day .c{font-size:13px;font-weight:600;white-space:nowrap}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px}
.total{font-size:30px;font-weight:800;color:var(--teal)}
.total+.sub{font-size:14px;color:var(--muted)}
.budget{margin-top:8px;font-size:13px;font-weight:600;display:inline-block;padding:4px 10px;border-radius:999px}
.budget.ok{background:#ecfdf5;color:#047857}
.budget.over{background:#fef2f2;color:#b91c1c}
.bar{margin-top:12px}
.bar-h{display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px}
.track{height:7px;background:var(--line);border-radius:999px;overflow:hidden}
.track div{height:100%;background:var(--teal);border-radius:999px}
.settle{list-style:none;margin-top:6px}
.settle li{display:flex;align-items:center;gap:8px;padding:10px 0;border-top:1px solid var(--line);font-size:14px}
.settle li:first-child{border-top:0}
.settle span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.settle em{font-style:normal;color:var(--muted)}
.settle b{color:var(--teal);white-space:nowrap}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
figure{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
figure img{width:100%;aspect-ratio:1;object-fit:cover;display:block;background:var(--line)}
figcaption{font-size:12px;color:var(--muted);padding:8px 10px}
.notes{list-style:none}
.notes li{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:8px}
.notes span{display:block;margin-top:6px;font-size:12px;color:var(--muted)}
.empty{color:var(--muted);font-size:14px;padding:14px 0}
footer{text-align:center;margin-top:44px;font-size:12px;color:var(--muted);line-height:1.8}
@media(min-width:560px){.grid{grid-template-columns:repeat(3,1fr)}}
</style>
</head>
<body>
<header class="hero">
  <p class="k">Tổng kết chuyến đi</p>
  <h1>${escapeHtml(trip.name)}</h1>
  <p>${escapeHtml(trip.destination)} · ${escapeHtml(dateRange)}</p>
</header>

<div class="stats">${statCards}</div>

<div class="wrap">
  ${intro}

  <h2>Lịch trình</h2>
  ${timeline}

  <h2>Chi tiêu</h2>
  <div class="card">
    <p class="total">${formatVnd(stats.totalSpent)}</p>
    <p class="sub">${escapeHtml(
      stats.memberCount > 0
        ? `${formatVnd(stats.perPerson)}/người · ${stats.memberCount} người`
        : "Chưa có thành viên"
    )}</p>
    ${budgetLine}
    ${categoryBars}
  </div>

  <h2>Chia tiền</h2>
  <div class="card">${settleRows}</div>

  ${photos.length ? `<h2>Kỷ niệm</h2>${gallery}` : ""}
  ${notes.length ? `<h2>Ghi chú</h2>${noteList}` : ""}

  <footer>
    Trang này do <b>Zino</b> tự dựng từ dữ liệu nhóm chat.<br>
    Số liệu chi tiêu tính bằng code, khớp từng đồng với Mini App.
  </footer>
</div>
</body>
</html>`;
}

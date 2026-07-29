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

/**
 * URL dùng trong `style="background-image:url(...)"`.
 *
 * Chặt hơn `escapeUrl` một bậc, và phải thế: `escapeHtml` đổi `"` thành
 * `&quot;`, nhưng trình duyệt GIẢI MÃ thực thể trước khi đọc CSS, nên dấu nháy
 * lại hiện nguyên hình bên trong `url("…")` và thoát ra được. Trong CSS không
 * có cách escape nào cứu được chuyện đó, nên đơn giản là từ chối mọi URL có
 * nháy, ngoặc, khoảng trắng hay dấu chéo ngược.
 */
export function cssUrl(s: string): string {
  return /^(https?:\/\/|\/)[^\s'"()\\<>]*$/i.test(s) ? escapeHtml(s) : "";
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

  // Bốn con số NGẮN. Bản cũ nhét `formatVnd(perPerson)` vào đây — "2.666.667₫"
  // ở 15px đậm trong một ô rộng ~70px trên điện thoại là tràn hoặc xuống dòng
  // giữa số. Số tiền đã có chỗ đàng hoàng ở khối Chi tiêu; ô này chỉ để đếm.
  const statCards = [
    { v: String(stats.dayCount), l: "ngày" },
    { v: String(stats.memberCount), l: "người" },
    { v: String(stats.eventCount), l: "hoạt động" },
    { v: String(stats.photoCount), l: "ảnh" }
  ]
    .map((s) => `<div class="stat"><b>${escapeHtml(s.v)}</b><span>${escapeHtml(s.l)}</span></div>`)
    .join("");

  // `kind` đã được tính sẵn trong payload nhưng bản cũ không dùng tới — mọi mục
  // trông y hệt nhau. Cho nó một chấm màu và một nhãn: nhìn lướt là biết ngày
  // hôm đó nặng về ăn uống hay di chuyển.
  const timeline = days.length
    ? days
        .map(
          (d) => `<section class="day">
      <h3><i>Ngày ${d.index}</i><span>${escapeHtml(d.label)}</span>${
        d.estimatedCost ? `<b>${formatVnd(d.estimatedCost)}</b>` : ""
      }</h3>
      <ol>
        ${d.items
          .map(
            (it) => `<li class="k-${escapeHtml(kindClass(it.kind))}">
          <time>${escapeHtml(it.time)}</time>
          <div>
            <p class="t">${escapeHtml(it.title)}<em>${escapeHtml(it.kindLabel)}</em></p>
            ${it.location ? `<p class="m">${escapeHtml(it.location)}</p>` : ""}
            ${it.note ? `<p class="m n">${escapeHtml(it.note)}</p>` : ""}
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

  /**
   * Chưa tiêu đồng nào thì KHÔNG khoe "còn dư".
   *
   * Chuyến Nha Trang trên production: 0 sự kiện, 0đ chi, mà trang vẫn in đậm
   * "Còn dư 4.285.716₫ so với ngân sách" — nghe như nhóm vừa tiết kiệm được
   * ngần ấy, trong khi chuyến còn chưa khởi hành. Chưa chi gì thì con số đó
   * đúng bằng ngân sách, nên gọi thẳng nó là ngân sách.
   */
  const budgetLine =
    stats.budgetRemaining == null
      ? ""
      : stats.totalSpent === 0
        ? `<p class="budget plan">Ngân sách ${formatVnd(stats.budgetTotal ?? 0)}${
            trip.budgetPerPerson ? ` · ${formatVnd(trip.budgetPerPerson)}/người` : ""
          }</p>`
        : `<p class="budget ${stats.budgetRemaining >= 0 ? "ok" : "over"}">
        ${
          stats.budgetRemaining >= 0
            ? `Còn dư ${formatVnd(stats.budgetRemaining)} so với ngân sách`
            : `Vượt ngân sách ${formatVnd(-stats.budgetRemaining)}`
        }
      </p>`;

  /**
   * Chuyến chưa có gì thì nói thẳng, đừng bày ra ba khối rỗng.
   *
   * Không có khối này thì trang mở ra là một dãy "chưa có lịch trình", "0₫",
   * "không ai nợ ai" — người đọc tưởng trang hỏng chứ không nghĩ là chuyến chưa
   * bắt đầu. Đây đúng cái lỗi "rỗng trông như hỏng" mà cả sản phẩm đang tránh.
   */
  const isBlank = stats.eventCount === 0 && stats.totalSpent === 0 && stats.photoCount === 0;
  const blankPanel = isBlank
    ? `<div class="card blank">
      <p><b>Chuyến này chưa có gì để tổng kết.</b></p>
      <p>Nhắn cho Zino trong nhóm Zalo để thêm lịch trình, khoản chi hay ảnh — trang này tự dựng lại mỗi lần mở.</p>
    </div>`
    : "";

  const categoryBars = byCategory
    .map(
      (c) => `<div class="bar c-${escapeHtml(categoryClass(c.category))}">
      <div class="bar-h"><span>${escapeHtml(c.label)}</span><b>${formatVnd(c.amount)}</b><i>${
        c.share
      }%</i></div>
      <div class="track"><div style="width:${c.share}%"></div></div>
    </div>`
    )
    .join("");

  /**
   * Ai trả bao nhiêu, ai còn phải bù — `settlement.perMember` có sẵn trong
   * payload nhưng bản cũ bỏ qua, chỉ in ra các mũi tên chuyển tiền. Thiếu bảng
   * này thì người đọc không kiểm được vì sao lại phải chuyển đúng số đó.
   */
  const ledger = settlement.perMember.length
    ? `<ul class="ledger">${settlement.perMember
        .map(
          (m) => `<li>
        <span>${escapeHtml(m.displayName)}</span>
        <em>trả ${formatVnd(m.paid)}</em>
        <b class="${m.net > 0 ? "in" : m.net < 0 ? "out" : "zero"}">${
          m.net > 0
            ? `được nhận ${formatVnd(m.net)}`
            : m.net < 0
              ? `còn bù ${formatVnd(-m.net)}`
              : "vừa đủ"
        }</b>
      </li>`
        )
        .join("")}</ul>`
    : "";

  const settleRows = settlement.settlements.length
    ? `<ul class="settle">${settlement.settlements
        .map(
          (s) =>
            `<li><span>${escapeHtml(s.fromName)}</span><em>→</em><span>${escapeHtml(
              s.toName
            )}</span><b>${formatVnd(s.amount)}</b></li>`
        )
        .join("")}</ul>`
    : `<p class="empty">Cả nhóm đã hoà nhau — không ai nợ ai.</p>`;

  // Nói ra chỗ làm tròn thay vì giấu. Trang này khoe "khớp từng đồng" thì phải
  // giải thích được đồng lẻ đi đâu, nếu không câu khoe kia thành nói suông.
  const rounding = settlement.roundingAdjustment
    ? `<p class="fine">Đã làm tròn ${formatVnd(
        settlement.roundingAdjustment
      )} để các khoản chuyển khớp tổng.</p>`
    : "";

  const warnings = settlement.warnings.length
    ? `<ul class="warn">${settlement.warnings
        .map((w) => `<li>${escapeHtml(w)}</li>`)
        .join("")}</ul>`
    : "";

  // Ảnh đầu tiên lớn hẳn, phần còn lại xếp lưới. Lưới ô vuông đều tăm tắp làm
  // mọi khoảnh khắc thành như nhau; một tấm mở đầu mới ra dáng cuốn kỷ niệm.
  const gallery = photos.length
    ? `<div class="grid">${photos
        .map((p, i) => {
          const src = escapeUrl(p.url);
          if (!src) return "";
          const cap = [p.caption, p.uploaderName].filter(Boolean).map((x) => escapeHtml(x!));
          return `<figure${i === 0 && photos.length > 2 ? ' class="lead"' : ""}>
            <img src="${src}" alt="${escapeHtml(p.caption ?? "Ảnh chuyến đi")}" loading="lazy">
            ${cap.length ? `<figcaption>${cap.join(" · ")}</figcaption>` : ""}
          </figure>`;
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

  // Ảnh nền hero. Không có ảnh thì rơi về nền chuyển sắc — trang vẫn tử tế.
  const heroSrc = photos.map((p) => cssUrl(p.url)).find(Boolean) ?? "";
  const heroStyle = heroSrc ? ` style="background-image:url('${heroSrc}')"` : "";

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
:root{
  --ink:#12211f;--muted:#63807c;--line:#e4ecea;--card:#fff;--bg:#f5f8f7;
  --teal:#0f766e;--teal-soft:#e7f4f1;--amber:#d97706;--rose:#be123c;
  --stay:#4f46e5;--food:#d97706;--move:#0f766e;--act:#9333ea;--etc:#64748b;
  --shadow:0 1px 2px rgba(18,33,31,.04),0 8px 24px rgba(18,33,31,.05);
}
@media(prefers-color-scheme:dark){:root{
  --ink:#e8f0ee;--muted:#93aaa6;--line:#22322f;--card:#16211f;--bg:#0d1615;
  --teal:#5eead4;--teal-soft:#122b28;--amber:#fbbf24;--rose:#fda4af;
  --stay:#a5b4fc;--food:#fbbf24;--move:#5eead4;--act:#d8b4fe;--etc:#94a3b8;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 8px 24px rgba(0,0,0,.25);
}}
body{font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased}
.wrap{max-width:680px;margin:0 auto;padding:0 20px 56px}

/* --- Hero ---------------------------------------------------------------- */
.hero{position:relative;color:#fff;padding:80px 20px 60px;text-align:center;background:#0f766e;background-size:cover;background-position:center;overflow:hidden}
.hero::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,40,38,.55),rgba(8,40,38,.88))}
.hero>*{position:relative;z-index:1}
.hero .k{font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.8}
.hero h1{font-size:clamp(26px,7vw,36px);line-height:1.2;margin:10px 0 8px;font-weight:800;text-wrap:balance}
.hero p{opacity:.92;font-size:15px}

/* --- Thẻ số liệu, đè lên hero -------------------------------------------- */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:-26px auto 0;max-width:640px;padding:0 20px;position:relative;z-index:2}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 4px;text-align:center;box-shadow:var(--shadow)}
.stat b{display:block;font-size:20px;font-weight:800;line-height:1.1}
.stat span{font-size:11px;color:var(--muted)}

.intro{margin:28px 0 0;padding:16px 18px;background:var(--card);border:1px solid var(--line);border-left:3px solid var(--amber);border-radius:12px;font-size:15px}
h2{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:40px 0 12px;font-weight:700}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;box-shadow:var(--shadow)}

/* --- Lịch trình ---------------------------------------------------------- */
.day{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin-bottom:10px;box-shadow:var(--shadow)}
.day h3{font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px;margin-bottom:6px}
.day h3 i{font-style:normal;background:var(--teal-soft);color:var(--teal);font-size:11px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}
.day h3 span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.day h3 b{margin-left:auto;font-size:12px;color:var(--muted);font-weight:600;white-space:nowrap}
.day ol{list-style:none}
.day li{display:flex;gap:11px;align-items:flex-start;padding:10px 0 10px 11px;border-top:1px solid var(--line);position:relative}
.day li:first-child{border-top:0}
.day li::before{content:"";position:absolute;left:0;top:16px;width:5px;height:5px;border-radius:50%;background:var(--etc)}
.day li.k-stay::before{background:var(--stay)}
.day li.k-food::before{background:var(--food)}
.day li.k-move::before{background:var(--move)}
.day li.k-act::before{background:var(--act)}
.day time{flex:0 0 42px;font-size:13px;font-weight:700;color:var(--muted);padding-top:2px;font-variant-numeric:tabular-nums}
.day li>div{flex:1;min-width:0}
.day .t{font-weight:600;font-size:15px;line-height:1.4}
.day .t em{font-style:normal;font-size:11px;font-weight:600;color:var(--muted);margin-left:7px;white-space:nowrap}
.day .m{font-size:13px;color:var(--muted)}
.day .m.n{font-style:italic}
.day .c{font-size:13px;font-weight:700;white-space:nowrap;padding-top:2px;font-variant-numeric:tabular-nums}

/* --- Chi tiêu ------------------------------------------------------------ */
.total{font-size:34px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.total+.sub{font-size:14px;color:var(--muted)}
.budget{margin-top:10px;font-size:13px;font-weight:700;display:inline-block;padding:5px 11px;border-radius:999px}
.budget.ok{background:var(--teal-soft);color:var(--teal)}
.budget.over{background:rgba(190,18,60,.1);color:var(--rose)}
.budget.plan{background:var(--line);color:var(--muted)}
.blank{margin-top:28px;text-align:center}
.blank p+p{margin-top:6px;font-size:14px;color:var(--muted)}
.bar{margin-top:14px}
.bar-h{display:flex;align-items:baseline;gap:8px;font-size:13px;margin-bottom:5px}
.bar-h span{font-weight:600}
.bar-h b{margin-left:auto;font-variant-numeric:tabular-nums}
.bar-h i{font-style:normal;color:var(--muted);font-size:12px;min-width:38px;text-align:right;font-variant-numeric:tabular-nums}
.track{height:8px;background:var(--line);border-radius:999px;overflow:hidden}
.track div{height:100%;border-radius:999px;background:var(--etc)}
.c-stay .track div{background:var(--stay)}
.c-food .track div{background:var(--food)}
.c-move .track div{background:var(--move)}
.c-act .track div{background:var(--act)}

/* --- Chia tiền ----------------------------------------------------------- */
.ledger{list-style:none;margin-bottom:14px}
.ledger li{display:flex;align-items:baseline;gap:10px;padding:9px 0;border-top:1px solid var(--line);font-size:14px}
.ledger li:first-child{border-top:0}
.ledger span{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ledger em{font-style:normal;color:var(--muted);font-size:12px;white-space:nowrap}
.ledger b{margin-left:auto;white-space:nowrap;font-size:13px;font-variant-numeric:tabular-nums}
.ledger b.in{color:var(--teal)}
.ledger b.out{color:var(--rose)}
.ledger b.zero{color:var(--muted);font-weight:500}
.settle{list-style:none}
.settle li{display:flex;align-items:center;gap:8px;padding:11px 0;border-top:1px solid var(--line);font-size:14px}
.settle li:first-child{border-top:0}
.settle span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.settle em{font-style:normal;color:var(--muted)}
.settle b{color:var(--teal);white-space:nowrap;font-variant-numeric:tabular-nums}
.fine{margin-top:12px;font-size:12px;color:var(--muted)}
.warn{list-style:none;margin-top:12px}
.warn li{font-size:13px;color:var(--amber);padding:2px 0}

/* --- Kỷ niệm ------------------------------------------------------------- */
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
figure{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:var(--shadow)}
figure.lead{grid-column:1/-1}
figure img{width:100%;aspect-ratio:1;object-fit:cover;display:block;background:var(--line)}
figure.lead img{aspect-ratio:16/10}
figcaption{font-size:12px;color:var(--muted);padding:9px 11px;line-height:1.5}

.notes{list-style:none}
.notes li{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:8px;box-shadow:var(--shadow)}
.notes span{display:block;margin-top:7px;font-size:12px;color:var(--muted)}
.empty{color:var(--muted);font-size:14px;padding:14px 0}
footer{text-align:center;margin-top:48px;padding-top:24px;border-top:1px solid var(--line);font-size:12px;color:var(--muted);line-height:1.9}

@media(min-width:560px){.grid{grid-template-columns:repeat(3,1fr)}}
/* Ô số liệu 4 cột trên máy rất hẹp thì chật — xuống 2 hàng cho dễ đọc. */
@media(max-width:359px){.stats{grid-template-columns:repeat(2,1fr)}}
/* Ai cũng chụp màn hình hoặc in trang này ra. Bỏ nền tối và bóng đổ. */
@media print{
  body{background:#fff}
  .hero{background:#fff!important;color:#12211f;padding:24px 0}
  .hero::after{display:none}
  .card,.day,.notes li,figure,.stat{box-shadow:none;break-inside:avoid}
  h2{margin-top:20px}
}
</style>
</head>
<body>
<header class="hero"${heroStyle}>
  <p class="k">Tổng kết chuyến đi</p>
  <h1>${escapeHtml(trip.name)}</h1>
  <p>${escapeHtml(trip.destination)} · ${escapeHtml(dateRange)}</p>
</header>

<div class="stats">${statCards}</div>

<div class="wrap">
  ${intro}
  ${blankPanel}

  <h2>Lịch trình</h2>
  ${timeline}

  ${photos.length ? `<h2>Kỷ niệm</h2>${gallery}` : ""}
  ${notes.length ? `<h2>Ghi chú</h2>${noteList}` : ""}

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
  <div class="card">${ledger}${settleRows}${rounding}${warnings}</div>

  <footer>
    Trang này do <b>Zino</b> tự dựng từ dữ liệu nhóm chat.<br>
    Số liệu chi tiêu tính bằng code, khớp từng đồng với Mini App.<br>
    Cập nhật ${escapeHtml(ictDayLabel(data.generatedAt))} lúc ${escapeHtml(
      ictTime(data.generatedAt)
    )}.
  </footer>
</div>
</body>
</html>`;
}

/** Gom `kind` của sự kiện về 4 nhóm màu — nhiều nhãn cùng nghĩa "di chuyển". */
function kindClass(kind: string): string {
  if (kind === "stay") return "stay";
  if (kind === "food") return "food";
  if (kind === "transport" || kind === "flight") return "move";
  if (kind === "activity") return "act";
  return "etc";
}

/** Cùng bảng màu với lịch trình để hai khối đọc liền mạch với nhau. */
function categoryClass(category: string): string {
  if (category === "stay") return "stay";
  if (category === "food") return "food";
  if (category === "transport") return "move";
  if (category === "ticket") return "act";
  return "etc";
}

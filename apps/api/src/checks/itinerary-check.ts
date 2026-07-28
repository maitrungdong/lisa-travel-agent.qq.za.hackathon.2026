/**
 * Zino tự soát lại chuyến đi.
 *
 * Đây là phần "agent checking" — nhưng CỐ TÌNH không để LLM làm việc soát.
 * Trùng giờ, thiếu chỗ ở, vượt ngân sách là những thứ tính được chính xác bằng
 * số học; đưa cho model đoán thì thỉnh thoảng nó bịa ra một vấn đề không có
 * hoặc bỏ sót một vấn đề có thật. Cả hai kiểu sai đều đắt hơn hẳn cái lợi.
 *
 * LLM vẫn có việc: DIỄN GIẢI danh sách này thành câu người đọc được. Nhưng
 * danh sách thì phải tất định, và phải có unit test.
 *
 * Hàm thuần, không I/O — chạy được ở cả API lẫn test mà không cần DB.
 */

const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

export type IssueLevel = "error" | "warn" | "info";

export interface CheckEvent {
  id: number;
  title: string;
  startsAt: string | Date;
  endsAt?: string | Date | null;
  kind: string;
  location?: string | null;
  status?: string;
  failReason?: string | null;
  estimatedCost?: number | null;
}

export interface CheckInput {
  trip: {
    id: number;
    name: string;
    startDate: string | Date;
    endDate: string | Date;
    budgetPerPerson: number | null;
  };
  events: CheckEvent[];
  memberCount: number;
  totalSpent: number;
  /** Cặp chuyển tiền chưa tick "đã trả" */
  unpaidTransfers: { fromName: string; toName: string; amount: number }[];
  /** Quyết định đang chờ chốt, nếu có */
  openDecision?: { title: string; pendingNames: string[] } | null;
}

export interface Issue {
  /** Mã ổn định để UI gắn nút hành động, đừng đổi tuỳ tiện */
  code:
    | "event_failed"
    | "event_overlap"
    | "no_stay"
    | "empty_day"
    | "over_budget"
    | "unpaid_transfer"
    | "open_decision"
    | "event_outside_trip";
  level: IssueLevel;
  title: string;
  detail: string;
  /** Sự kiện liên quan, để app cuộn tới hoặc gắn nút "Nhờ Zino tìm lại" */
  eventId?: number;
}

const toTime = (v: string | Date): number => (v instanceof Date ? v.getTime() : Date.parse(v));

/** yyyy-mm-dd theo giờ VN — mọi phép gom ngày trong dự án đều dùng ICT. */
function dayKey(v: string | Date): string {
  const d = new Date(toTime(v) + ICT_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

function formatVnd(n: number): string {
  return `${Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}đ`;
}

/** Mọi ngày trong chuyến, kể cả ngày không có hoạt động nào. */
function tripDays(start: string | Date, end: string | Date): string[] {
  const a = Date.parse(`${dayKey(start)}T00:00:00Z`);
  const b = Date.parse(`${dayKey(end)}T00:00:00Z`);
  const out: string[] = [];
  for (let t = a; t <= b; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function checkTrip(input: CheckInput): Issue[] {
  const issues: Issue[] = [];
  const { trip, events, memberCount, totalSpent, unpaidTransfers, openDecision } = input;

  /* 1. Mục Zino làm hỏng — nặng nhất, vì người dùng đang tưởng mình có chỗ */
  for (const e of events) {
    if (e.status === "failed") {
      issues.push({
        code: "event_failed",
        level: "error",
        title: `"${e.title}" chưa đặt được`,
        detail: e.failReason ?? "Chưa rõ lý do",
        eventId: e.id
      });
    }
  }

  /* 2. Trùng giờ — chỉ tính khi CẢ HAI mục có giờ kết thúc.
        Không có endsAt thì không biết mục đó kéo dài bao lâu; đoán bừa 1-2 tiếng
        rồi báo trùng là kiểu cảnh báo sai làm người dùng mất tin vào cả danh sách. */
  const timed = events
    .filter((e) => e.endsAt)
    .sort((a, b) => toTime(a.startsAt) - toTime(b.startsAt));
  for (let i = 1; i < timed.length; i++) {
    const prev = timed[i - 1];
    const cur = timed[i];
    if (toTime(prev.endsAt!) > toTime(cur.startsAt)) {
      issues.push({
        code: "event_overlap",
        level: "warn",
        title: "Hai hoạt động trùng giờ",
        detail: `"${prev.title}" chưa xong đã tới "${cur.title}"`,
        eventId: cur.id
      });
    }
  }

  /* 3. Sự kiện nằm ngoài khoảng ngày của chuyến — thường là gõ nhầm năm/tháng */
  const from = Date.parse(`${dayKey(trip.startDate)}T00:00:00Z`);
  const to = Date.parse(`${dayKey(trip.endDate)}T23:59:59Z`);
  for (const e of events) {
    const t = Date.parse(`${dayKey(e.startsAt)}T12:00:00Z`);
    if (t < from || t > to) {
      issues.push({
        code: "event_outside_trip",
        level: "warn",
        title: `"${e.title}" nằm ngoài ngày chuyến đi`,
        detail: "Kiểm tra lại ngày giờ của mục này",
        eventId: e.id
      });
    }
  }

  /* 4. Đêm không có chỗ ở. Đêm cuối không tính — hôm đó thường là ngày về. */
  const days = tripDays(trip.startDate, trip.endDate);
  const stayDays = new Set(events.filter((e) => e.kind === "stay").map((e) => dayKey(e.startsAt)));
  for (const d of days.slice(0, -1)) {
    if (!stayDays.has(d)) {
      issues.push({
        code: "no_stay",
        level: days.length > 1 ? "warn" : "info",
        title: `Đêm ${d.slice(8, 10)}/${d.slice(5, 7)} chưa có chỗ ở`,
        detail: "Lịch trình chưa có mục nào loại 'chỗ ở' cho đêm này"
      });
    }
  }

  /* 5. Ngày trống trơn */
  const busyDays = new Set(events.map((e) => dayKey(e.startsAt)));
  for (const d of days) {
    if (!busyDays.has(d)) {
      issues.push({
        code: "empty_day",
        level: "info",
        title: `Ngày ${d.slice(8, 10)}/${d.slice(5, 7)} chưa có hoạt động nào`,
        detail: "Nhờ Zino gợi ý vài chỗ cho ngày này"
      });
    }
  }

  /* 6. Ngân sách */
  if (trip.budgetPerPerson != null && memberCount > 0) {
    const budget = trip.budgetPerPerson * memberCount;
    const planned = events.reduce((s, e) => s + (e.estimatedCost ?? 0), 0);
    if (totalSpent > budget) {
      issues.push({
        code: "over_budget",
        level: "error",
        title: `Đã vượt ngân sách ${formatVnd(totalSpent - budget)}`,
        detail: `Đã tiêu ${formatVnd(totalSpent)} / ${formatVnd(budget)}`
      });
    } else if (totalSpent + planned > budget) {
      // Cảnh báo SỚM: đã tiêu chưa vượt, nhưng cộng cả phần dự kiến thì vượt.
      issues.push({
        code: "over_budget",
        level: "warn",
        title: "Sắp vượt ngân sách",
        detail: `Đã tiêu ${formatVnd(totalSpent)}, còn ${formatVnd(planned)} dự kiến — tổng vượt ${formatVnd(
          totalSpent + planned - budget
        )}`
      });
    }
  }

  /* 7. Quyết định treo — nhóm đang kẹt ở đó, nhắc là đúng việc */
  if (openDecision) {
    issues.push({
      code: "open_decision",
      level: "warn",
      title: `"${openDecision.title}" chưa chốt`,
      detail:
        openDecision.pendingNames.length > 0
          ? `Còn ${openDecision.pendingNames.join(", ")} chưa bình chọn`
          : "Cả nhóm đã bình chọn, chờ người tổ chức chốt"
    });
  }

  /* 8. Nợ chưa trả */
  for (const t of unpaidTransfers) {
    issues.push({
      code: "unpaid_transfer",
      level: "info",
      title: `${t.fromName} chưa chuyển ${formatVnd(t.amount)} cho ${t.toName}`,
      detail: "Tick 'đã trả' ở tab Chi phí khi xong"
    });
  }

  // error → warn → info. Người dùng chỉ đọc 2-3 dòng đầu, nên thứ tự là tất cả.
  const rank: Record<IssueLevel, number> = { error: 0, warn: 1, info: 2 };
  return issues.sort((a, b) => rank[a.level] - rank[b.level]);
}

/** Một câu tóm tắt cho đầu danh sách. */
export function summarize(issues: Issue[]): string {
  if (issues.length === 0) return "Mình soát hết rồi, chuyến này ổn — không thấy vấn đề gì.";
  const errors = issues.filter((i) => i.level === "error").length;
  const warns = issues.filter((i) => i.level === "warn").length;
  const parts: string[] = [];
  if (errors) parts.push(`${errors} việc cần xử lý ngay`);
  if (warns) parts.push(`${warns} chỗ nên xem lại`);
  const rest = issues.length - errors - warns;
  if (rest) parts.push(`${rest} ghi chú`);
  return `Mình soát xong: ${parts.join(", ")}.`;
}

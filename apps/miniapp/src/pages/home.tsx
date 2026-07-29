import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  ExternalLink,
  Images,
  Link2,
  Luggage,
  Sparkles,
  Store,
  Wallet
} from "lucide-react";
import { api, recapPageUrl, type Activity, type Decision } from "../lib/api";
import { DecisionCard } from "../components/decision-card";
import { AUTH_ENABLED, DEBUG_UI } from "../lib/flags";
import { session, type MeResponse } from "../lib/session";
import { fetchZaloUser, openExternal, type ZaloUser } from "../lib/zalo";
import { useRecap } from "../lib/use-trip";
import { countdownLabel, STATUS_LABEL } from "../components/trip-header";
import { TripSwitcher } from "../components/trip-switcher";
import { Badge } from "../components/ui/badge";
import { Card, CardContent } from "../components/ui/card";
import { EmptyState, ErrorState, SectionTitle, SkeletonList } from "../components/states";
import { formatDate, formatVnd } from "../lib/utils";

const ACTIVITY_ICON: Record<string, string> = {
  suggestion: "💡",
  booking: "📌",
  reminder: "⏰",
  note: "📝",
  expense: "🧾",
  plan: "🗺️",
  recap: "🎉"
};

export default function HomePage() {
  const [user, setUser] = useState<ZaloUser | null>(null);
  const { data, loading, error, isEmpty, reload } = useRecap();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);

  useEffect(() => {
    void fetchZaloUser().then(setUser);
    // Phiên là tính năng CỘNG THÊM: không lấy được thì `me` cứ null và mọi thứ
    // chạy y như trước. Không được để đăng nhập biến thành cửa ải chặn đường.
    if (AUTH_ENABLED) void session.me().then(setMe);
  }, []);

  // Nhật ký "Zino đã làm gì" nằm ở /full chứ không có trong recap — tải rời và
  // im lặng khi lỗi: thiếu phần này thì màn hình vẫn dùng được bình thường.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    api
      .full(data.trip.id)
      .then((f) => {
        if (!cancelled) setActivities(f.activities.slice(0, 5));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [data]);

  // Quyết định đang chờ chốt. Tải rời khỏi recap vì nó đổi thường xuyên hơn
  // (mỗi lượt bình chọn) và vì hỏng nó không được kéo sập cả Trang chủ.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    api
      .activeDecision(data.trip.id)
      .then((r) => {
        if (!cancelled) setDecision(r.decision);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [data]);

  /**
   * Nhắc liên kết — hiện với MỌI trường hợp chưa nối, kể cả khi chưa lấy được
   * phiên (`me === null`).
   *
   * Bản đầu chỉ hiện khi đã có phiên, với lý do "đừng nhắc việc user không làm
   * được". Sai: lúc đó "chưa deploy bản mới" và "phiên hỏng" trông y hệt nhau —
   * không ai, kể cả team, phân biệt nổi. Giờ luôn có lối vào, còn /link chịu
   * trách nhiệm nói rõ hỏng ở đâu.
   */
  const linkBanner =
    AUTH_ENABLED && !me?.linked ? (
      <Link
        to="/link"
        className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3.5 py-3 text-sm"
      >
        <Link2 size={16} className="shrink-0 text-accent-foreground" />
        <span className="min-w-0 flex-1">
          <span className="font-medium">Liên kết tài khoản</span>
          <span className="block text-xs text-muted-foreground">
            Để Zino biết bạn là ai trong nhóm — mất 10 giây
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-primary">Liên kết →</span>
      </Link>
    ) : null;

  const greeting = (
    <header className="relative rounded-lg bg-primary p-5 text-primary-foreground">
      <p className="text-sm/relaxed opacity-80">
        Xin chào{me?.member?.displayName ? `, ${me.member.displayName}` : user ? `, ${user.name}` : ""} 👋
      </p>
      <h1 className="mt-1 text-xl font-bold">Zino – Trợ lý nhu cầu của nhóm</h1>
      <p className="mt-2 flex items-center gap-1.5 text-sm opacity-90">
        <Sparkles size={16} /> Nhắn “@Zino” trong nhóm Zalo để lên kế hoạch
      </p>
      {/* Lối vào màn đo danh tính. Đặt trong header vì header hiện ở MỌI nhánh
          của Home (đang tải / lỗi / rỗng), còn trong webview Zalo thì không gõ
          URL tay được. Chỉ hiện khi VITE_DEBUG_UI=true. */}
      {DEBUG_UI && (
        <Link
          to="/debug"
          className="absolute right-3 top-3 rounded-full bg-white/15 px-2 py-1 text-[11px] font-medium"
        >
          🔧 debug
        </Link>
      )}
    </header>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {greeting}
        {linkBanner}
        <SkeletonList rows={2} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {greeting}
        {linkBanner}
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }

  if (isEmpty || !data) {
    return (
      <div className="space-y-4">
        {greeting}
        {linkBanner}
        <EmptyState
          icon={<Luggage size={32} />}
          title="Chưa có chuyến đi nào"
          hint="Nhắn cho Zino trong nhóm Zalo, ví dụ: “Nhóm mình đi Vũng Tàu 12–14/8, 6 người, 3tr/người”."
        />
      </div>
    );
  }

  const { trip, stats, days, settlement } = data;
  const spentRatio =
    stats.budgetTotal && stats.budgetTotal > 0
      ? Math.min(100, Math.round((stats.totalSpent / stats.budgetTotal) * 100))
      : null;
  const nextDay = days.find((d) => new Date(`${d.date}T23:59:59+07:00`).getTime() >= Date.now());
  const txCount = settlement.settlements.length;

  return (
    <div className="space-y-4">
      {greeting}
      {linkBanner}

      {/* Thẻ chuyến đi — đếm ngược + số liệu tóm tắt */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between bg-secondary px-4 py-2">
          <span className="text-xs font-semibold text-secondary-foreground">
            {countdownLabel(trip)}
          </span>
          <Badge variant={trip.status === "done" ? "outline" : "default"}>
            {STATUS_LABEL[trip.status] ?? trip.status}
          </Badge>
        </div>
        <CardContent className="space-y-3 py-3.5">
          <div>
            {/* Trang chủ không dùng TripHeader (thẻ này giàu thông tin hơn), nên
                lối đổi chuyến phải gắn riêng vào đây — nếu không thì đúng cái
                tab người ta mở đầu tiên lại là tab duy nhất không đổi được. */}
            <TripSwitcher currentTripId={trip.id}>
              <h2 className="truncate text-base font-bold leading-tight">{trip.name}</h2>
            </TripSwitcher>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {trip.destination} · {formatDate(trip.startDate)} → {formatDate(trip.endDate)}
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { v: stats.dayCount, l: "ngày" },
              { v: stats.memberCount, l: "người" },
              { v: stats.eventCount, l: "hoạt động" },
              { v: stats.photoCount, l: "ảnh" }
            ].map((s) => (
              <div key={s.l} className="rounded-md bg-muted py-2">
                <p className="text-base font-bold leading-none">{s.v}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{s.l}</p>
              </div>
            ))}
          </div>

          {/* Tiến độ ngân sách — nhìn phát biết còn tiêu được bao nhiêu */}
          {spentRatio !== null && stats.budgetTotal && (
            <div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-muted-foreground">
                  {formatVnd(stats.totalSpent)} / {formatVnd(stats.budgetTotal)}
                </span>
                <span
                  className={
                    stats.budgetRemaining != null && stats.budgetRemaining < 0
                      ? "font-semibold text-rose-600"
                      : "font-semibold text-emerald-600"
                  }
                >
                  {stats.budgetRemaining != null && stats.budgetRemaining >= 0
                    ? `còn ${formatVnd(stats.budgetRemaining)}`
                    : `vượt ${formatVnd(Math.abs(stats.budgetRemaining ?? 0))}`}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${spentRatio >= 100 ? "bg-rose-500" : "bg-primary"}`}
                  style={{ width: `${spentRatio}%` }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Thẻ ĐANG CHỜ CHỐT — wireframe J2 gọi đây là màn quan trọng nhất.
          Đặt ngay dưới thẻ chuyến đi: mở app ra là thấy việc cần làm. */}
      {decision && (decision.status === "open" || decision.status === "tie") && (
        <DecisionCard
          decision={decision}
          members={data.members}
          onChanged={(d) => setDecision(d.status === "decided" ? null : d)}
        />
      )}

      {/* Lối tắt sang các tab — bấm ngay, khỏi mò thanh dưới */}
      <div className="grid grid-cols-4 gap-2">
        {[
          {
            to: "/itinerary",
            icon: CalendarDays,
            label: "Lịch trình",
            sub: `${stats.eventCount} mục`
          },
          {
            to: "/expenses",
            icon: Wallet,
            label: "Chi phí",
            sub: txCount ? `${txCount} giao dịch` : formatVnd(stats.perPerson)
          },
          { to: "/gallery", icon: Images, label: "Kỷ niệm", sub: `${stats.photoCount} ảnh` },
          // Đối tác không còn ở thanh tab dưới — đây là lối vào duy nhất
          { to: "/partners", icon: Store, label: "Đối tác", sub: trip.destination }
        ].map(({ to, icon: Icon, label, sub }) => (
          <Link
            key={to}
            to={to}
            className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card py-3 active:bg-muted"
          >
            <Icon size={18} className="text-primary" />
            <span className="text-xs font-medium">{label}</span>
            <span className="text-[11px] text-muted-foreground">{sub}</span>
          </Link>
        ))}
      </div>

      {/* Sắp tới — chỉ hiện khi lịch trình còn phần chưa qua */}
      {nextDay && nextDay.items.length > 0 && (
        <section className="space-y-2">
          <SectionTitle
            action={
              <Link to="/itinerary" className="text-xs font-medium text-primary">
                Xem tất cả
              </Link>
            }
          >
            {nextDay.label}
          </SectionTitle>
          <Card>
            <CardContent className="divide-y divide-border py-0">
              {nextDay.items.slice(0, 3).map((it) => (
                <div key={it.id} className="flex items-start gap-3 py-2.5">
                  <span className="w-11 shrink-0 text-xs font-semibold text-primary">{it.time}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{it.title}</p>
                    {it.location && (
                      <p className="truncate text-xs text-muted-foreground">📍 {it.location}</p>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Nhật ký Zino — bằng chứng agent có làm việc thật, không phải chatbot suông */}
      {activities.length > 0 && (
        <section className="space-y-2">
          <SectionTitle>Zino đã làm gì</SectionTitle>
          <Card>
            <CardContent className="divide-y divide-border py-0">
              {activities.map((a) => (
                <div key={a.id} className="flex gap-2.5 py-2.5">
                  <span className="text-base leading-none">{ACTIVITY_ICON[a.kind] ?? "✨"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{a.content}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {new Date(a.createdAt).toLocaleString("vi-VN", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Trang tổng kết công khai — link thường, gửi cho ai cũng mở được */}
      <button
        type="button"
        onClick={() => void openExternal(recapPageUrl(trip.id))}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card py-3 text-sm font-medium active:bg-muted"
      >
        <ExternalLink size={16} className="text-primary" />
        Mở trang tổng kết chuyến đi
      </button>

      <div className="pb-2" />
    </div>
  );
}

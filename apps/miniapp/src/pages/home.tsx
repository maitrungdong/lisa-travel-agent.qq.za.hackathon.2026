import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  ExternalLink,
  Images,
  Luggage,
  Sparkles,
  Wallet
} from "lucide-react";
import { api, recapPageUrl, type Activity } from "../lib/api";
import { fetchZaloUser, openExternal, type ZaloUser } from "../lib/zalo";
import { useRecap } from "../lib/use-trip";
import { countdownLabel, STATUS_LABEL } from "../components/trip-header";
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

  useEffect(() => {
    void fetchZaloUser().then(setUser);
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

  const greeting = (
    <header className="rounded-lg bg-primary p-5 text-primary-foreground">
      <p className="text-sm/relaxed opacity-80">Xin chào{user ? `, ${user.name}` : ""} 👋</p>
      <h1 className="mt-1 text-xl font-bold">Zino – Trợ lý nhu cầu của nhóm</h1>
      <p className="mt-2 flex items-center gap-1.5 text-sm opacity-90">
        <Sparkles size={16} /> Nhắn “@Zino” trong nhóm Zalo để lên kế hoạch
      </p>
    </header>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {greeting}
        <SkeletonList rows={2} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {greeting}
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }

  if (isEmpty || !data) {
    return (
      <div className="space-y-4">
        {greeting}
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
            <h2 className="text-lg font-bold leading-tight">{trip.name}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
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

      {/* Lối tắt sang các tab — bấm ngay, khỏi mò thanh dưới */}
      <div className="grid grid-cols-3 gap-2">
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
          { to: "/gallery", icon: Images, label: "Kỷ niệm", sub: `${stats.photoCount} ảnh` }
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

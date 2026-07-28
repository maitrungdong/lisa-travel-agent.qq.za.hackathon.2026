import { useState } from "react";
import { CalendarDays, MapPin } from "lucide-react";
import { useRecap } from "../lib/use-trip";
import { TripHeader } from "../components/trip-header";
import { Card, CardContent } from "../components/ui/card";
import { EmptyState, ErrorState, SkeletonList } from "../components/states";
import { formatVnd } from "../lib/utils";

/** Chấm màu theo loại hoạt động — liếc là biết ngày đó nặng về ăn hay về đi. */
const KIND_DOT: Record<string, string> = {
  flight: "bg-sky-500",
  transport: "bg-sky-500",
  stay: "bg-violet-500",
  food: "bg-amber-500",
  activity: "bg-emerald-500",
  other: "bg-slate-400"
};

export default function ItineraryPage() {
  const { data, loading, error, isEmpty, reload } = useRecap();
  const [activeDay, setActiveDay] = useState<string | null>(null);

  if (loading) return <SkeletonList rows={4} />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (isEmpty || !data) {
    return (
      <EmptyState
        icon={<CalendarDays size={32} />}
        title="Chưa có chuyến đi nào"
        hint="Rủ Zino lên kế hoạch trong nhóm Zalo trước nhé."
      />
    );
  }

  const { trip, days } = data;

  if (days.length === 0) {
    return (
      <div className="space-y-4">
        <TripHeader trip={trip} />
        <EmptyState
          icon={<CalendarDays size={32} />}
          title="Lịch trình đang trống"
          hint="Nhắn “lên lịch trình giúp mình” trong nhóm — Zino research rồi ghi thẳng vào đây."
        />
      </div>
    );
  }

  // Mặc định mở ngày đầu tiên chưa qua, chứ không phải ngày 1 — đang đi ngày 2
  // mà mở app ra thấy lịch ngày 1 thì phải cuộn, đúng lúc không rảnh để cuộn.
  const defaultDay =
    days.find((d) => new Date(`${d.date}T23:59:59+07:00`).getTime() >= Date.now())?.date ??
    days[days.length - 1].date;
  const selected = activeDay ?? defaultDay;
  const day = days.find((d) => d.date === selected) ?? days[0];

  return (
    <div className="space-y-4">
      <TripHeader trip={trip} />

      {/* Chọn ngày — cuộn ngang, khỏi dồn cả chuyến vào một danh sách dài dằng dặc */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d.date}
            type="button"
            onClick={() => setActiveDay(d.date)}
            className={`shrink-0 rounded-full px-3.5 py-2 text-xs font-medium ${
              d.date === selected
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            Ngày {d.index}
            <span className="ml-1.5 opacity-70">{d.label.split(", ")[1]}</span>
          </button>
        ))}
      </div>

      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{day.label}</h2>
        {day.estimatedCost > 0 && (
          <span className="text-xs text-muted-foreground">
            dự kiến {formatVnd(day.estimatedCost)}
          </span>
        )}
      </div>

      <ol className="relative ml-3 space-y-3 border-l-2 border-border pl-5">
        {day.items.map((e) => (
          <li key={e.id} className="relative">
            <span
              className={`absolute -left-[27px] top-3 size-3 rounded-full ring-2 ring-background ${
                KIND_DOT[e.kind] ?? KIND_DOT.other
              }`}
            />
            <Card>
              <CardContent className="space-y-1 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-primary">{e.time}</p>
                  <span className="text-[11px] text-muted-foreground">{e.kindLabel}</span>
                </div>
                <p className="font-medium leading-snug">{e.title}</p>
                {e.location && (
                  <p className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin size={14} className="shrink-0" /> {e.location}
                  </p>
                )}
                {e.note && <p className="text-sm text-muted-foreground">{e.note}</p>}
                {e.estimatedCost != null && e.estimatedCost > 0 && (
                  <p className="text-sm font-medium">≈ {formatVnd(e.estimatedCost)}</p>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
        {day.items.length === 0 && (
          <li className="text-sm text-muted-foreground">Ngày này chưa có hoạt động nào.</li>
        )}
      </ol>

      <p className="pb-4 text-center text-xs text-muted-foreground">
        Nhắn Zino trong nhóm để thêm hoặc đổi lịch — thay đổi hiện ngay ở đây.
      </p>
    </div>
  );
}

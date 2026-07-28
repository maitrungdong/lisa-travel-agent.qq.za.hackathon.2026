import { useEffect, useState } from "react";
import { AlertCircle, CalendarDays, Clock, MapPin, MessageSquareQuote } from "lucide-react";
import { api, type TripEvent } from "../lib/api";
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
  const [events, setEvents] = useState<TripEvent[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const tripId = data?.trip.id;
  // recap đã gom sẵn theo ngày nhưng KHÔNG mang trạng thái booking — lấy thêm
  // từ /events. Tách vậy để không phải sửa payload recap (đang có 16 test bám).
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    api
      .events(tripId)
      .then((rows) => {
        if (!cancelled) setEvents(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  /**
   * "Nhờ Zino" — copy câu đã soạn, KHÔNG tự gửi.
   *
   * Wireframe vẽ nút này prefill thẳng vào ô nhập tin của nhóm. Không làm được:
   * `openChat` của zmp-sdk chỉ nhận type "user" | "oa", không có "group".
   * Nên đường trung thực nhất là copy + bảo người dùng dán vào nhóm.
   */
  async function askZino(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      setCopied(text); // không copy được thì vẫn hiện câu ra để tự chép
    }
  }

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
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-medium leading-snug">{e.title}</p>
                  <StatusBadge status={statusOf(e.id)} />
                </div>
                {e.location && (
                  <p className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin size={14} className="shrink-0" /> {e.location}
                  </p>
                )}
                {e.note && <p className="text-sm text-muted-foreground">{e.note}</p>}
                {e.estimatedCost != null && e.estimatedCost > 0 && (
                  <p className="text-sm font-medium">
                    {statusOf(e.id) === "pending" ? "dự kiến " : ""}
                    {formatVnd(e.estimatedCost)}
                  </p>
                )}

                {/* Lỗi PHẢI hiện kèm đường xử lý — giấu đi thì người dùng đứng
                    ở bến xe mới biết mình không có vé. */}
                {statusOf(e.id) === "failed" && (
                  <div className="space-y-1.5 rounded-lg bg-rose-50 p-2.5">
                    <p className="flex items-start gap-1.5 text-xs text-rose-900">
                      <AlertCircle size={13} className="mt-0.5 shrink-0" />
                      {failReasonOf(e.id) ?? "Không đặt được"}
                    </p>
                    <button
                      type="button"
                      onClick={() => void askZino(`@Zino tìm lại giúp mình "${e.title}" nhé`)}
                      className="flex items-center gap-1 text-xs font-semibold text-rose-900"
                    >
                      <MessageSquareQuote size={12} /> Nhờ Zino tìm lại
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>
          </li>
        ))}
        {day.items.length === 0 && (
          <li className="space-y-2">
            <p className="text-sm text-muted-foreground">Ngày này chưa có hoạt động nào.</p>
            <button
              type="button"
              onClick={() =>
                void askZino(
                  `@Zino gợi ý giúp mình vài chỗ chơi ${day.label.toLowerCase()} ở ${trip.destination} nhé`
                )
              }
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-primary"
            >
              <MessageSquareQuote size={13} /> Nhờ Zino gợi ý
            </button>
          </li>
        )}
      </ol>

      {/* Toast copy — nói thẳng là phải tự dán, không hứa app gửi hộ */}
      {copied && (
        <div className="fixed inset-x-4 bottom-24 z-40 rounded-xl bg-foreground/95 p-3 text-xs text-background shadow-lg">
          <p className="font-semibold">Đã copy câu hỏi</p>
          <p className="mt-0.5 opacity-80">Dán vào nhóm Zalo rồi gửi — Zino sẽ trả lời ở đó.</p>
          <p className="mt-1.5 rounded bg-white/15 p-1.5 font-mono text-[11px] leading-relaxed">
            {copied}
          </p>
        </div>
      )}

      <p className="pb-4 text-center text-xs text-muted-foreground">
        Nhắn Zino trong nhóm để thêm hoặc đổi lịch — thay đổi hiện ngay ở đây.
      </p>
    </div>
  );

  function statusOf(eventId: number): string {
    return events.find((x) => x.id === eventId)?.status ?? "done";
  }
  function failReasonOf(eventId: number): string | null {
    return events.find((x) => x.id === eventId)?.failReason ?? null;
  }
}

/** Ba trạng thái của một mục lịch trình. `done` không cần nhãn — đó là mặc định. */
function StatusBadge({ status }: { status: string }) {
  if (status === "pending") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
        <Clock size={10} /> đang giữ chỗ
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-900">
        <AlertCircle size={10} /> lỗi
      </span>
    );
  }
  return null;
}

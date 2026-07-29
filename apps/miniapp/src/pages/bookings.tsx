import { useEffect, useMemo, useState } from "react";
import { Bed, Bus, Check, Hash, Loader2, Luggage, Ticket, X } from "lucide-react";
import { api, type Booking, type BookingSummary } from "../lib/api";
import { currentActor } from "../lib/actor";
import { useRecap } from "../lib/use-trip";
import { TripHeader } from "../components/trip-header";
import { EmptyState, ErrorState, SkeletonList } from "../components/states";
import { Card, CardContent } from "../components/ui/card";
import { formatVnd } from "../lib/utils";

/**
 * Quản lý đặt chỗ — phòng, vé xe, vé tham quan.
 *
 * Vì sao mọi thứ ở đây là NÚT BẤM TAY chứ không phải tự động: hệ thống không có
 * tích hợp thanh toán nào, và đó là sự thật cố định chứ không phải thiếu sót
 * tạm thời. Nên màn này không giả vờ đang đặt hộ; nó làm đúng một việc — làm sổ
 * theo dõi trung thực để cả nhóm nhìn cùng một trạng thái. Một cái nút thật
 * hơn hẳn một hoạt ảnh "đang đặt phòng…" không dẫn tới đâu.
 */
const KIND_ICON: Record<string, typeof Bed> = {
  stay: Bed,
  transport: Bus,
  ticket: Ticket,
  other: Luggage
};

/** Ba nhóm hiện trên màn. Đã huỷ gom xuống cuối, mờ đi. */
const GROUPS = [
  { key: "to_book", label: "Cần đặt", dot: "bg-orange-500" },
  { key: "booked", label: "Đã đặt, chưa trả tiền", dot: "bg-amber-500" },
  { key: "paid", label: "Xong", dot: "bg-emerald-600" },
  { key: "cancelled", label: "Đã huỷ", dot: "bg-muted-foreground" }
] as const;

const STATUS_CHIP: Record<string, string> = {
  to_book: "bg-orange-50 text-orange-800",
  booked: "bg-amber-50 text-amber-900",
  paid: "bg-emerald-50 text-emerald-800",
  cancelled: "bg-muted text-muted-foreground"
};

const STATUS_LABEL: Record<string, string> = {
  to_book: "Chưa đặt",
  booked: "Đã đặt",
  paid: "Đã trả",
  cancelled: "Đã huỷ"
};

/** Nhãn nút đẩy sang bước kế. Giữ đồng bộ với booking-rules.ts ở API. */
function nextAction(status: string): { label: string; to: string } | null {
  if (status === "to_book") return { label: "Đánh dấu đã đặt", to: "booked" };
  if (status === "booked") return { label: "Đánh dấu đã trả tiền", to: "paid" };
  return null;
}

export default function BookingsPage() {
  const { data, loading, error, reload } = useRecap();
  const [rows, setRows] = useState<Booking[] | null>(null);
  const [summary, setSummary] = useState<BookingSummary | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [refDraft, setRefDraft] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const tripId = data?.trip.id;
  const actor = useMemo(
    () => (data ? currentActor(data.trip.id, data.members) : null),
    [data]
  );

  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    api
      .bookings(tripId)
      .then((r) => {
        if (cancelled) return;
        setRows(r.bookings);
        setSummary(r.summary);
        setListError(null);
      })
      .catch((e: unknown) => {
        // Lỗi PHẢI hiện. Nuốt ở đây thì "API chết" trông y hệt "chưa có đặt chỗ nào".
        if (!cancelled) setListError(e instanceof Error ? e.message : "Không tải được đặt chỗ");
      });
    return () => {
      cancelled = true;
    };
  }, [tripId]);

  function show(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  }

  async function move(b: Booking, to: string) {
    if (!actor) {
      show("Chọn tên bạn ở tab Chi phí trước đã, để Zino ghi đúng người.");
      return;
    }
    setBusyId(b.id);
    try {
      const r = await api.setBookingStatus(b.id, {
        status: to,
        actorZaloId: actor.zaloUserId,
        actorName: actor.displayName
      });
      setRows((cur) => cur?.map((x) => (x.id === b.id ? r.booking : x)) ?? null);
      // Người khác vừa đổi trước — nói ra, đừng để người dùng tưởng mình bấm hụt.
      if (!r.changed) show("Người khác vừa cập nhật mục này rồi.");
      if (tripId) void api.bookingSummary(tripId).then(setSummary).catch(() => undefined);
    } catch (e) {
      show(e instanceof Error ? e.message : "Không đổi được trạng thái");
    } finally {
      setBusyId(null);
    }
  }

  async function saveRef(b: Booking) {
    if (!actor) return;
    setBusyId(b.id);
    try {
      const r = await api.patchBooking(b.id, {
        refCode: refDraft.trim() || null,
        actorZaloId: actor.zaloUserId
      });
      setRows((cur) => cur?.map((x) => (x.id === b.id ? r.booking : x)) ?? null);
      setEditing(null);
    } catch (e) {
      show(e instanceof Error ? e.message : "Không lưu được mã đặt chỗ");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <SkeletonList rows={3} />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;
  if (listError) return <ErrorState message={listError} onRetry={reload} />;
  if (!rows) return <SkeletonList rows={3} />;

  const { trip } = data;

  return (
    <div className="space-y-4">
      <TripHeader trip={trip} />

      {summary && summary.total > 0 && (
        <Card>
          <CardContent className="py-3.5">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold">Đặt chỗ</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {summary.done}/{summary.total} xong
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-600"
                style={{ width: `${summary.percent}%` }}
              />
            </div>
            {/* Nói thẳng giới hạn, ngay chỗ người dùng có thể hiểu nhầm nhất. */}
            <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
              Zino chưa đặt và trả tiền hộ được. Ai đặt xong thì bấm cập nhật để cả nhóm cùng thấy.
            </p>
          </CardContent>
        </Card>
      )}

      {rows.length === 0 && (
        <EmptyState
          icon={<Luggage size={32} />}
          title="Chưa có gì cần đặt chỗ"
          hint="Mục chỗ ở, di chuyển hay vé trong lịch trình sẽ tự xuất hiện ở đây. Nhờ Zino thêm trong nhóm Zalo hoặc ở tab Hỏi Zino."
        />
      )}

      {GROUPS.map((g) => {
        const items = rows.filter((b) => b.status === g.key);
        if (items.length === 0) return null;
        return (
          <section key={g.key} className="space-y-2">
            <div className="flex items-center gap-1.5">
              <span className={`size-1.5 rounded-full ${g.dot}`} />
              <h2 className="text-xs font-semibold text-muted-foreground">{g.label}</h2>
              <span className="text-xs text-muted-foreground">({items.length})</span>
            </div>

            {items.map((b) => {
              const Icon = KIND_ICON[b.kind] ?? Luggage;
              const act = nextAction(b.status);
              const busy = busyId === b.id;
              const done = b.status === "paid";
              return (
                <div
                  key={b.id}
                  className={`rounded-xl border p-3 ${
                    b.status === "to_book" ? "border-border/80 bg-card" : "border-border bg-card"
                  } ${b.status === "cancelled" ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start gap-2.5">
                    <Icon size={19} className="mt-0.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-sm font-medium leading-snug ${
                          done || b.status === "cancelled" ? "line-through" : ""
                        }`}
                      >
                        {b.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[b.provider, b.amount != null ? formatVnd(b.amount) : null]
                          .filter(Boolean)
                          .join(" · ") || "chưa có giá"}
                      </p>
                      {(b.refCode || b.holderName) && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                          {b.refCode && (
                            <>
                              <Hash size={12} />
                              {b.refCode}
                            </>
                          )}
                          {b.refCode && b.holderName && <span>·</span>}
                          {b.holderName && <span>{b.holderName} giữ chỗ</span>}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ${STATUS_CHIP[b.status]}`}
                    >
                      {STATUS_LABEL[b.status]}
                    </span>
                  </div>

                  {editing === b.id ? (
                    <div className="mt-2.5 flex gap-1.5">
                      <input
                        value={refDraft}
                        onChange={(e) => setRefDraft(e.target.value)}
                        placeholder="Mã đặt chỗ, vd HOLD-4417"
                        className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-sm"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void saveRef(b)}
                        className="rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        Lưu
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="rounded-lg border border-border px-2.5 text-xs"
                      >
                        Bỏ
                      </button>
                    </div>
                  ) : (
                    (act || b.status !== "cancelled") && (
                      <div className="mt-2.5 flex gap-1.5">
                        {act && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void move(b, act.to)}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                          >
                            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                            {act.label}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(b.id);
                            setRefDraft(b.refCode ?? "");
                          }}
                          aria-label="Thêm mã đặt chỗ"
                          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border"
                        >
                          <Hash size={14} />
                        </button>
                        {b.status !== "cancelled" && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void move(b, "cancelled")}
                            aria-label="Huỷ đặt chỗ"
                            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border disabled:opacity-50"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </section>
        );
      })}

      {toast && (
        <div className="fixed inset-x-4 bottom-24 z-40 rounded-xl bg-foreground/95 p-3 text-xs text-background shadow-lg">
          {toast}
        </div>
      )}
      {!actor && rows.length > 0 && (
        <p className="pb-2 text-center text-[11px] text-muted-foreground">
          Chọn tên bạn ở tab Chi phí để cập nhật được trạng thái.
        </p>
      )}
      <div className="pb-2" />
    </div>
  );
}

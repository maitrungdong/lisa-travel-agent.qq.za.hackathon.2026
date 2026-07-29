import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Check, ChevronDown } from "lucide-react";
import { loadTrips } from "../lib/active-trip";
import type { TripSummary } from "../lib/api";
import { groupTrips } from "../lib/trip-groups";

/**
 * Đổi chuyến từ bất kỳ tab nào.
 *
 * Vì sao là sheet gắn vào tên chuyến chứ không phải một màn danh sách riêng:
 * app này là tab-shell, thanh tab dưới luôn hiện và `TripHeader` đã nằm sẵn
 * trên đầu mọi tab. Một màn danh sách đứng ngoài shell sẽ phải ẩn/hiện thanh
 * tab và làm mất tab đang mở mỗi lần đổi chuyến. Sheet thì cắm đúng vào chỗ
 * trống có sẵn: đang xem Chi phí, đổi chuyến, vẫn ở Chi phí.
 *
 * Đánh đổi đã biết: mỗi dòng chỉ còn hai dòng chữ nên không đủ chỗ cho badge
 * trạng thái — trạng thái chuyển lên thành tiêu đề nhóm.
 */
/**
 * Ngày gọn — KHÔNG dùng `formatDate` của utils.
 *
 * `formatDate` kèm thứ ("T3, 28/07"), rất hợp cho header nhưng ở đây một dòng
 * phải chứa cả khoảng ngày, số người và số tiền. Thêm hai chữ "T3, " hai lần là
 * dòng bị cắt cụt mất phần tiền — thứ duy nhất giúp phân biệt các chuyến.
 */
function dayMonth(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";
  const vn = new Date(d.getTime() + 7 * 3600_000);
  return `${String(vn.getUTCDate()).padStart(2, "0")}/${String(vn.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** "8,0tr" thay vì "8.000.000 ₫" — cùng lý do độ dài như trên. */
function shortVnd(n: number): string {
  const strip = (s: string) => s.replace(",0", "");
  if (n >= 1_000_000_000) return `${strip((n / 1_000_000_000).toFixed(1).replace(".", ","))}tỷ`;
  if (n >= 1_000_000) return `${strip((n / 1_000_000).toFixed(1).replace(".", ","))}tr`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function TripSwitcher({
  currentTripId,
  children
}: {
  currentTripId: number;
  /** Phần hiển thị tên chuyến — mỗi màn tự quyết cỡ chữ, đây chỉ bọc vùng chạm. */
  children: ReactNode;
}) {
  const [trips, setTrips] = useState<TripSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadTrips()
      .then((r) => !cancelled && setTrips(r))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  // Một chuyến (hoặc chưa biết) thì không có gì để đổi → không mọc mũi tên ra
  // trêu người dùng. Cũng là lý do phải đợi `trips` về mới hiện.
  const canSwitch = !failed && (trips?.length ?? 0) > 1;

  if (!canSwitch) return <>{children}</>;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        // Cố tình KHÔNG đặt aria-label: có nó thì trình đọc màn hình đọc "đổi
        // chuyến đi" và nuốt mất tên chuyến — đúng thông tin quan trọng nhất.
        // Tên chuyến nằm trong children đã là tên gọi của nút rồi.
        className="flex max-w-full items-center gap-1 text-left active:opacity-60"
      >
        <span className="min-w-0">{children}</span>
        <ChevronDown size={16} className="shrink-0 text-primary" />
      </button>
      {open && (
        <TripSheet trips={trips ?? []} currentTripId={currentTripId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function TripSheet({
  trips,
  currentTripId,
  onClose
}: {
  trips: TripSummary[];
  currentTripId: number;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const groups = groupTrips(trips);

  function choose(id: number) {
    onClose();
    if (id === currentTripId) return;
    // `replace` để nút back của Android không lùi qua từng lần đổi chuyến.
    // Thay CẢ query: `?add=1` của màn Chi phí mà sót lại thì đổi chuyến xong
    // form nhập khoản chi lại tự bật lên, chẳng vì lý do gì.
    navigate({ pathname, search: `?trip=${id}` }, { replace: true });
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Đóng"
        onClick={onClose}
        className="absolute inset-0 bg-black/45"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trip-sheet-title"
        className="relative max-h-[70dvh] overflow-y-auto rounded-t-2xl bg-card pb-[env(safe-area-inset-bottom)]"
      >
        <div className="sticky top-0 bg-card pt-2">
          <div className="mx-auto h-1 w-9 rounded-full bg-border" />
          <div className="flex items-center px-4 pb-2.5 pt-2">
            <h2 id="trip-sheet-title" className="text-sm font-semibold">
              Chọn chuyến
            </h2>
            <span className="ml-auto text-xs text-muted-foreground">{trips.length} chuyến</span>
          </div>
          <div className="h-px bg-border" />
        </div>

        <div className="px-4 pb-4">
          {groups.map((g) => (
            <section key={g.key}>
              <h3 className="pb-1 pt-3 text-[11px] font-semibold text-muted-foreground">{g.label}</h3>
              {g.trips.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => choose(t.id)}
                  aria-current={t.id === currentTripId}
                  className="flex w-full items-center gap-2.5 border-b border-border py-2.5 text-left last:border-0 active:bg-muted"
                >
                  <span className="w-4 shrink-0">
                    {t.id === currentTripId && <Check size={16} className="text-primary" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{t.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {dayMonth(t.startDate)} → {dayMonth(t.endDate)} · {t.memberCount} người ·{" "}
                      {t.totalSpent > 0 ? shortVnd(t.totalSpent) : "chưa có chi"}
                    </span>
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

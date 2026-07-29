import { useCallback, useEffect, useRef, useState } from "react";
import { resolveActiveTrip, useTripParam } from "./active-trip";
import { api, type FullTrip, type Recap } from "./api";

/**
 * Trạng thái tải dữ liệu dùng chung cho mọi tab.
 *
 * Vì sao tách ra hook thay vì mỗi màn tự `useEffect` như trước:
 *  1. Bốn màn từng viết lại cùng một đoạn fetch, và mỗi màn nuốt lỗi một kiểu
 *     (`.catch(() => undefined)`) → mạng hỏng thì user chỉ thấy màn trống,
 *     tưởng "chuyến đi chưa có gì" trong khi thật ra là API chết. Trên sân khấu
 *     đó là kiểu lỗi tệ nhất: im lặng và sai.
 *  2. Có `reload()` thì mới đặt được nút "Thử lại" — wifi hội trường chập chờn
 *     là chuyện bình thường.
 */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  /** null = chưa lỗi. "empty" = gọi được API nhưng nhóm chưa có chuyến nào. */
  error: string | null;
  isEmpty: boolean;
  reload: () => void;
}

function useAsync<T>(load: () => Promise<T | "empty">, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEmpty, setEmpty] = useState(false);
  const [tick, setTick] = useState(0);

  // Giữ tham chiếu mới nhất để effect không phải phụ thuộc vào `load`
  // (hàm mới mỗi lần render → sẽ fetch vô hạn).
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loadRef
      .current()
      .then((r) => {
        if (cancelled) return;
        if (r === "empty") {
          setEmpty(true);
          setData(null);
        } else {
          setEmpty(false);
          setData(r);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Không kết nối được máy chủ");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `load` cố tình không nằm trong deps — nó là hàm mới mỗi lần render,
    // đưa vào là fetch vô hạn. Bản mới nhất đã giữ trong loadRef.
  }, [tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, isEmpty, reload };
}

/**
 * Toàn bộ dữ liệu chuyến đi đang hoạt động (1 request).
 *
 * `useTripParam()` nằm trong deps để đổi chuyến ở sheet là tab này tự nạp lại —
 * kể cả tab đang mở sẵn dưới nền.
 */
export function useFullTrip(): AsyncState<FullTrip> {
  const tripParam = useTripParam();
  return useAsync<FullTrip>(async () => {
    const id = await resolveActiveTrip();
    if (!id) return "empty";
    return api.full(id);
  }, [tripParam]);
}

/** Dữ liệu đã gom sẵn theo ngày / hạng mục — dùng cho Trang chủ, Lịch trình, Chi phí. */
export function useRecap(): AsyncState<Recap> {
  const tripParam = useTripParam();
  return useAsync<Recap>(async () => {
    const id = await resolveActiveTrip();
    if (!id) return "empty";
    return api.recap(id);
  }, [tripParam]);
}

/**
 * Số ngày còn lại tới chuyến đi (âm = đã đi rồi, 0 = hôm nay khởi hành).
 * So sánh theo NGÀY giờ VN, không theo giờ — nếu so mốc thời gian thì chuyến
 * khởi hành 8h sáng nay sẽ hiện "còn 0 ngày" lúc 7h và "-1" lúc 9h.
 */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const ictMidnight = (d: Date) => {
    const shifted = new Date(d.getTime() + 7 * 3600_000);
    return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  };
  return Math.round((ictMidnight(new Date(iso)) - ictMidnight(now)) / 86_400_000);
}

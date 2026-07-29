import type { TripSummary } from "./api";

/**
 * Nhóm chuyến đi cho sheet đổi chuyến.
 *
 * Vì sao chia nhóm theo NGÀY chứ không theo cột `status`: `status` do bot đặt
 * và có thể lỡ nhịp (chuyến đã khởi hành nhưng chưa ai nhắn gì để bot đổi sang
 * "ongoing"). Ngày tháng thì luôn đúng, lại khớp với chữ đếm ngược mà
 * `countdownLabel` đã hiện trên đầu mọi tab — hai chỗ nói khác nhau là mất tin.
 *
 * Ngoại lệ duy nhất: `status === "done"` luôn xếp vào "Đã xong". Chuyến bị huỷ
 * giữa chừng thì ngày kết thúc vẫn nằm ở tương lai, mà xếp nó vào "Sắp tới"
 * cạnh badge "Đã xong" thì đọc rất vô lý.
 */
export type TripGroupKey = "ongoing" | "upcoming" | "past";

export interface TripGroup {
  key: TripGroupKey;
  label: string;
  trips: TripSummary[];
}

const LABEL: Record<TripGroupKey, string> = {
  ongoing: "Đang đi",
  upcoming: "Sắp tới",
  past: "Đã xong"
};

/** Số ngày (giờ VN) từ hôm nay tới `iso`. Âm = đã qua, 0 = hôm nay. */
function daysFromToday(iso: string, now: Date): number {
  const ictMidnight = (d: Date) => {
    const shifted = new Date(d.getTime() + 7 * 3600_000);
    return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  };
  return Math.round((ictMidnight(new Date(iso)) - ictMidnight(now)) / 86_400_000);
}

export function tripGroupKey(trip: TripSummary, now: Date = new Date()): TripGroupKey {
  if (trip.status === "done") return "past";
  // Ngày cuối tính trọn vẹn: chuyến kết thúc HÔM NAY vẫn là "đang đi", không
  // phải "đã xong" — người ta còn đang trên đường về, còn nhập nốt hoá đơn.
  if (daysFromToday(trip.endDate, now) < 0) return "past";
  if (daysFromToday(trip.startDate, now) <= 0) return "ongoing";
  return "upcoming";
}

/**
 * Trả về CÁC NHÓM CÓ CHUYẾN, theo thứ tự Đang đi → Sắp tới → Đã xong.
 * Nhóm rỗng bị bỏ hẳn: trong một sheet cao chưa tới nửa màn hình, dòng
 * "chưa có chuyến nào kết thúc" chỉ chiếm chỗ mà không nói thêm điều gì.
 */
export function groupTrips(trips: TripSummary[], now: Date = new Date()): TripGroup[] {
  const buckets: Record<TripGroupKey, TripSummary[]> = { ongoing: [], upcoming: [], past: [] };
  for (const t of trips) buckets[tripGroupKey(t, now)].push(t);

  // Chuyến kết thúc sớm nhất lên trước — nó là chuyến sắp cần chốt sổ.
  buckets.ongoing.sort((a, b) => cmpDate(a.endDate, b.endDate));
  // Gần nhất lên trước.
  buckets.upcoming.sort((a, b) => cmpDate(a.startDate, b.startDate));
  // Mới đi xong lên trước — càng cũ càng ít ai mở lại.
  buckets.past.sort((a, b) => cmpDate(b.endDate, a.endDate));

  return (["ongoing", "upcoming", "past"] as const)
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, label: LABEL[k], trips: buckets[k] }));
}

/** Ngày hỏng (bot ghi sai) bị đẩy xuống cuối thay vì làm sort trả về NaN. */
function cmpDate(a: string, b: string): number {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return ta - tb;
}

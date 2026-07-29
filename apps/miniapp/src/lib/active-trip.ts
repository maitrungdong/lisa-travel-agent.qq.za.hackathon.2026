import { useLocation } from "react-router-dom";
import { api, type TripSummary } from "./api";

/**
 * Chuyến đang mở nằm ở `?trip=<id>` trên URL, không ở state của React.
 *
 * Vì sao URL là nguồn sự thật: nó đã là nguồn sự thật sẵn rồi —
 * `resolveActiveTrip()` đọc nó, và Zino gửi link kèm `?trip=` trong chat nhóm.
 * Thêm một biến state song song nghĩa là có hai chỗ trả lời cùng một câu hỏi,
 * và sớm muộn chúng lệch nhau (bấm back là lệch ngay). Đổi chuyến = điều hướng.
 *
 * Kèm theo đó, mọi hook dữ liệu chỉ cần lấy giá trị này làm dependency thì đổi
 * chuyến là cả 5 tab tự nạp lại, không cần bus sự kiện nào.
 */
export function useTripParam(): string | null {
  const { search } = useLocation();
  // Cố tình KHÔNG phụ thuộc cả chuỗi `search`: `/expenses?add=1` cũng làm nó
  // đổi, mà mở form nhập chi phí thì không việc gì phải tải lại chuyến đi.
  return new URLSearchParams(search).get("trip");
}

/**
 * Danh sách chuyến, nạp một lần cho cả phiên.
 *
 * Header hiện trên đầu mọi tab nên nếu không nhớ kết quả thì mỗi lần chuyển tab
 * lại là một request `/trips`. Danh sách chuyến của một nhóm gần như không đổi
 * trong lúc người ta đang xem, nên nhớ luôn là đủ.
 */
let tripsPromise: Promise<TripSummary[]> | null = null;

export function loadTrips(): Promise<TripSummary[]> {
  if (!tripsPromise) {
    tripsPromise = api.trips().catch((err: unknown) => {
      // Hỏng thì quên đi để lần sau còn thử lại, thay vì nhớ mãi một lời hứa lỗi.
      tripsPromise = null;
      throw err;
    });
  }
  return tripsPromise;
}

/** Gọi khi biết danh sách đã cũ (vd. bot vừa tạo chuyến mới). */
export function invalidateTrips(): void {
  tripsPromise = null;
}

/**
 * Chuyến đi đang xem: ưu tiên `?trip=<id>` trên URL (Zino gửi link kèm id),
 * không có thì lấy chuyến mới nhất.
 *
 * Id trên URL được đối chiếu với danh sách thật trước khi dùng. Link cũ trỏ vào
 * chuyến đã bị xoá là chuyện sẽ xảy ra — nó nằm trong lịch sử chat nhóm mãi mãi.
 * Không kiểm tra thì màn hình chỉ hiện "API 404" kèm nút "Thử lại" bấm bao nhiêu
 * lần cũng vậy, mà lúc đó `TripHeader` chưa render nên cũng không có đường sang
 * chuyến khác. Rơi về chuyến mới nhất thì ít ra còn dùng được app.
 */
export async function resolveActiveTrip(): Promise<number | null> {
  const trips = await loadTrips();
  const fromUrl = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("trip");
  const wanted = Number(fromUrl);
  if (fromUrl && Number.isFinite(wanted) && trips.some((t) => t.id === wanted)) return wanted;
  return trips[0]?.id ?? null;
}

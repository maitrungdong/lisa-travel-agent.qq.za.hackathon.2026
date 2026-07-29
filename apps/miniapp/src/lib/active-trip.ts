import { useLocation } from "react-router-dom";
import { api, type TripSummary } from "./api";
import { pickTripId } from "./trip-select";

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
 * Chuyến đã chọn gần nhất trong phiên này.
 *
 * Vì sao cần, dù URL đã là nguồn sự thật: điều hướng trong app làm RƠI query.
 * `<NavLink to="/itinerary">` của thanh tab dựng URL mới không có `?trip=`, nên
 * chuyển tab là mất chuyến đang chọn và rơi về chuyến mới nhất. Bản đầu tôi
 * chọn URL làm nguồn sự thật mà không rà lại 9 chỗ điều hướng — chính là lỗi này.
 *
 * Có thể đi vá từng chỗ, nhưng chỗ thứ mười thêm vào tuần sau sẽ lại quên. Nên
 * quy tắc đặt ở một chỗ: URL có `?trip=` thì URL thắng; không có thì dùng lại
 * lựa chọn gần nhất; chưa chọn bao giờ mới lấy chuyến mới nhất. Vá link chỉ để
 * URL còn chia sẻ được, không phải để chương trình chạy đúng.
 */
let lastResolved: number | null = null;

/**
 * Query cần gắn vào link nội bộ để URL không bị rỗng nghĩa khi chia sẻ.
 * Trả về "" khi chưa biết chuyến nào — lúc đó `resolveActiveTrip` lo phần đúng.
 */
export function useTripSearch(): string {
  const param = useTripParam();
  if (param) return `?trip=${param}`;
  return lastResolved != null ? `?trip=${lastResolved}` : "";
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
  lastResolved = pickTripId(
    fromUrl,
    lastResolved,
    trips.map((t) => t.id)
  );
  return lastResolved;
}

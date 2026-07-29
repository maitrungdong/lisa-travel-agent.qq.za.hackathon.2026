/**
 * Link mở Mini App vào ĐÚNG một chuyến đi.
 *
 * Gom về một chỗ vì bản cũ dựng link rải rác và dính hai lỗi cùng lúc:
 *
 *  1. `ZINO_MINIAPP_URL` có trong docker-compose nhưng KHÔNG có trong
 *     `.env.example`, nên trên production nó rỗng và mọi link Zino gửi vào nhóm
 *     rơi về trang tổng kết HTML — người dùng bấm vào không hề mở Mini App.
 *  2. Link không mang `?trip=`. Từ khi thêm nút đổi chuyến, không có tham số
 *     này thì app mở CHUYẾN MỚI NHẤT, không phải chuyến vừa bàn trong nhóm.
 *     Nhóm đang chốt chuyến Nha Trang, bấm link ra chuyến Vũng Tàu.
 *
 * Hash route (`#/`) vì Mini App chạy HashRouter — xem apps/miniapp/src/App.tsx.
 */
export function miniAppTripUrl(tripId: number): string | null {
  const raw = (process.env.ZINO_MINIAPP_URL ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    // Chỉ đặt hash, KHÔNG đụng vào path và query.
    //
    // Bản chưa duyệt của Mini App có entry point riêng do Zalo cấp, và nó mang
    // tham số phiên bản ở QUERY. Bản đầu của hàm này nối chuỗi thô nên ra
    // `...?version=5/#/?trip=3` — hash nằm sau query, link chết. Mà lỗi kiểu
    // này chỉ lộ ra khi có người thật bấm vào, không test nào ở tầng dưới bắt
    // được vì chuỗi vẫn "trông đúng".
    u.hash = `/?trip=${tripId}`;
    return u.toString();
  } catch {
    // URL rác thì thà không có link còn hơn gửi vào nhóm một link chết.
    return null;
  }
}

/**
 * Link để Zino gửi vào nhóm: ưu tiên Mini App, không cấu hình thì dùng trang
 * tổng kết web.
 *
 * Vẫn giữ đường lui vì trang tổng kết mở được bằng trình duyệt thường — người
 * ngoài danh sách thử nghiệm Mini App vẫn xem được. Nhưng nay đường lui cũng
 * mang đúng id chuyến, không còn dựa vào "chuyến mới nhất".
 */
export function shareTripUrl(tripId: number): string {
  const app = miniAppTripUrl(tripId);
  if (app) return app;
  const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
  return `${base}/api/trips/${tripId}/recap.html`;
}

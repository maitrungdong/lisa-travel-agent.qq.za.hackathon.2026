/**
 * Chọn chuyến nào đang mở — phần quyết định, tách khỏi `active-trip.ts`.
 *
 * Vì sao ở file riêng: `active-trip.ts` import `api.ts`, mà `api.ts` đọc
 * `import.meta.env` ngay lúc nạp module. Hàm thuần này không cần gì trong đó,
 * và để chung thì mỗi lần muốn kiểm tra một nhánh logic lại phải dựng cả môi
 * trường Vite. Tách ra thì test chỉ là gọi hàm với ba tham số.
 */

/**
 * Thứ tự ưu tiên:
 *  1. `?trip=` trên URL — Zino gửi link kèm id trong chat nhóm, link phải thắng.
 *  2. Lựa chọn gần nhất trong phiên — vì điều hướng trong app LÀM RƠI query.
 *     `<NavLink to="/itinerary">` dựng URL mới không có `?trip=`, nên nếu
 *     không nhớ thì chuyển tab là mất chuyến đang xem. Bug này đã lọt ra
 *     production một lần.
 *  3. Chuyến mới nhất.
 *
 * Mọi id đều đối chiếu với `available` trước khi dùng: link cũ trong lịch sử
 * chat nhóm sống mãi, mà chuyến thì xoá được.
 *
 * @param available id các chuyến, theo đúng thứ tự API trả về (mới nhất trước).
 */
export function pickTripId(
  fromUrl: string | null,
  remembered: number | null,
  available: number[]
): number | null {
  const exists = (id: number | null) => id != null && available.includes(id);

  const wanted = fromUrl ? Number(fromUrl) : NaN;
  if (Number.isFinite(wanted) && exists(wanted)) return wanted;

  if (exists(remembered)) return remembered;

  return available[0] ?? null;
}

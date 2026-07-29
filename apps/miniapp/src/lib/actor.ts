/**
 * "Bạn là ai trong nhóm" — bản tạm, lưu ở máy.
 *
 * Đăng nhập Zalo đang tắt (Zalo App chưa kích hoạt, xem docs/setup/12), nhưng
 * bình chọn và chốt thì bắt buộc phải biết ai đang thao tác. Nên tạm thời để
 * người dùng tự chọn tên mình một lần, cất vào localStorage.
 *
 * Nói thẳng giới hạn: đây KHÔNG phải xác thực. Ai cũng có thể chọn tên người
 * khác. Chốt chặn thật nằm ở server — actor phải là thành viên của chuyến, và
 * chốt phải là người tổ chức. Khi bật lại đăng nhập, chỉ cần đổi hàm
 * `storedActor()` sang đọc từ phiên; mọi nơi gọi nó không phải sửa.
 *
 * ⚠ LƯU THEO TỪNG CHUYẾN. Bản đầu lưu một actor chung cho cả thiết bị, và nó
 * chạy đúng chừng nào app chỉ mở được một chuyến. Từ khi thêm nút đổi chuyến
 * thì hỏng ngay: chọn "Đông" (u1) ở chuyến demo rồi sang chuyến thật — nơi
 * thành viên mang id Zalo hoàn toàn khác — là mọi thao tác bình chọn/chốt đều
 * bị server trả 400 "Bạn không thuộc chuyến đi này". Thành viên là quan hệ
 * THEO TỪNG CHUYẾN, nên khoá lưu cũng phải theo từng chuyến.
 */

const keyFor = (tripId: number) => `zino.actor:${tripId}`;

/** Khoá của bản cũ (một actor cho cả thiết bị). Chỉ dùng để dọn, không đọc lại. */
const LEGACY_KEY = "zino.actor";

export interface Actor {
  zaloUserId: string;
  displayName: string;
  role?: string;
}

/** Đủ dùng cho việc đối chiếu — nhận cả `Member` của API lẫn dữ liệu recap. */
interface MemberLike {
  zaloUserId: string;
  displayName: string;
  role?: string;
}

function storedActor(tripId: number): Actor | null {
  try {
    // Bản cũ có thể đang giữ actor của chuyến khác — dọn luôn, đừng migrate.
    localStorage.removeItem(LEGACY_KEY);
    const raw = localStorage.getItem(keyFor(tripId));
    if (!raw) return null;
    const a = JSON.parse(raw) as Actor;
    return a?.zaloUserId ? a : null;
  } catch {
    return null;
  }
}

/**
 * Actor của chuyến này, ĐÃ đối chiếu với danh sách thành viên hiện tại.
 *
 * Hai thứ lấy lại từ server thay vì tin bản lưu ở máy:
 *  • Không còn trong nhóm → trả null để hỏi lại, thay vì để người dùng bấm rồi
 *    ăn 400.
 *  • `role` đọc lại từ server. Vai trò đổi được ở phía server, mà bản lưu ở máy
 *    không tự biết. Tin bản cũ thì nút "Chốt phương án" hiện ra cho người không
 *    có quyền — bấm vào là 400 "Chỉ người tổ chức mới chốt được".
 *
 * Không truyền `members` thì bỏ qua đối chiếu (dùng cho chỗ chỉ cần biết tên,
 * ví dụ gắn kèm câu hỏi trong tab Chat).
 */
export function currentActor(tripId: number, members?: MemberLike[]): Actor | null {
  const a = storedActor(tripId);
  if (!a) return null;
  if (!members) return a;

  const m = members.find((x) => x.zaloUserId === a.zaloUserId);
  if (!m) return null;
  return { zaloUserId: m.zaloUserId, displayName: m.displayName, role: m.role };
}

export function setActor(tripId: number, a: Actor | null): void {
  try {
    if (a) localStorage.setItem(keyFor(tripId), JSON.stringify(a));
    else localStorage.removeItem(keyFor(tripId));
  } catch {
    /* webview chặn storage — người dùng sẽ phải chọn lại mỗi lần mở */
  }
}

export function isOrganizer(a: Actor | null): boolean {
  return a?.role === "organizer";
}

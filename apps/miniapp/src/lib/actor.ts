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
 * `currentActor()` sang đọc từ phiên; mọi nơi gọi nó không phải sửa.
 */

const KEY = "zino.actor";

export interface Actor {
  zaloUserId: string;
  displayName: string;
  role?: string;
}

export function currentActor(): Actor | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Actor;
    return a?.zaloUserId ? a : null;
  } catch {
    return null;
  }
}

export function setActor(a: Actor | null): void {
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a));
    else localStorage.removeItem(KEY);
  } catch {
    /* webview chặn storage — người dùng sẽ phải chọn lại mỗi lần mở */
  }
}

export function isOrganizer(a: Actor | null): boolean {
  return a?.role === "organizer";
}

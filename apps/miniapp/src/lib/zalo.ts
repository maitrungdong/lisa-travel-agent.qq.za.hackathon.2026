// Wrapper quanh zmp-sdk: gọi được cả trong Zalo lẫn trình duyệt thường
// (dev trên desktop không có bridge native → fallback, không crash).
import { getUserInfo, openChat } from "zmp-sdk/apis";

export interface ZaloUser {
  id: string;
  name: string;
  avatar: string;
}

export async function fetchZaloUser(): Promise<ZaloUser | null> {
  try {
    const { userInfo } = await getUserInfo({ autoRequestPermission: true });
    return { id: userInfo.id, name: userInfo.name, avatar: userInfo.avatar };
  } catch {
    return null; // ngoài môi trường Zalo hoặc user từ chối quyền
  }
}

/**
 * Mở cửa sổ chat với một Official Account BẤT KỲ và điền sẵn nội dung tin nhắn.
 *
 * Đây là cách HỢP LỆ DUY NHẤT để "agent nhắn cho OA khác" — Zalo không có
 * server API nào làm được việc này. Tài liệu Zalo nói rõ: nội dung được điền
 * sẵn, nhưng "việc gửi tin nhắn hay không phụ thuộc vào quyết định của người dùng".
 *
 * Cần zmp-sdk >= 2.5.3. Ngoài môi trường Zalo (dev trên desktop) sẽ trả lỗi —
 * gọi ở đây trả về kết quả có kiểu thay vì ném exception, để UI tự lo fallback.
 */
export async function openPartnerChat(
  oaId: string,
  message: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await openChat({ type: "oa", id: oaId, message });
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error:
        reason.toLowerCase().includes("not supported") || reason.includes("undefined")
          ? "Chức năng này chỉ chạy trong ứng dụng Zalo"
          : reason
    };
  }
}

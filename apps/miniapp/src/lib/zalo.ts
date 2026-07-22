// Wrapper quanh zmp-sdk: gọi được cả trong Zalo lẫn trình duyệt thường
// (dev trên desktop không có bridge native → fallback, không crash).
import { getUserInfo } from "zmp-sdk/apis";

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

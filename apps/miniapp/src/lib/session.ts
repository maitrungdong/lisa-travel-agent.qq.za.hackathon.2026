import { authorize, getAccessToken, getDeviceIdAsync } from "zmp-sdk/apis";

/**
 * Phiên đăng nhập của Mini App.
 *
 * Luồng: `getAccessToken()` (Zalo cấp) → gửi lên server → server tự hỏi Zalo
 * xem token đó của ai → trả về JWT phiên. Client không bao giờ tự khai danh tính.
 *
 * Thiết kế phòng hờ có chủ đích: MỌI bước đều được phép hỏng mà app vẫn chạy.
 * Ngoài Zalo (dev trên desktop), server chưa cấu hình ZALO_APP_SECRET, mạng
 * chập chờn — tất cả đều rơi về `null` và app quay lại chế độ không phiên như
 * trước đây. Đăng nhập là tính năng cộng thêm, không phải cửa ải chặn đường.
 */

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const STORAGE_KEY = "zino.session";
const DEVICE_KEY = "zino.device";

let cached: string | null | undefined;
let inflight: Promise<string | null> | null = null;

/**
 * Lý do lần lấy phiên gần nhất thất bại.
 *
 * Bản đầu nuốt sạch lỗi bằng `catch { return null }` cho "gọn". Kết quả: khi
 * nó hỏng thật, cả người dùng lẫn team chỉ thấy một câu chung chung và phải
 * ngồi đoán — hỏng ở SDK, ở quyền, hay ở server. Giữ lại lý do là rẻ; đoán mò
 * mới đắt.
 */
export interface SessionError {
  stage: "sdk" | "authorize" | "server";
  detail: string;
}
let lastError: SessionError | null = null;

/** true = đang chạy phiên theo thiết bị vì Zalo từ chối cấp access token. */
let deviceMode = false;

export function isDeviceMode(): boolean {
  return deviceMode;
}

export function lastSessionError(): SessionError | null {
  return lastError;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // webview chặn storage — vẫn chạy được, chỉ là mỗi lần mở phải login lại
  }
}

function store(token: string | null): void {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* bỏ qua */
  }
}

/** Token phiên đang có, không gọi mạng. */
export function currentToken(): string | null {
  if (cached === undefined) cached = readStored();
  return cached;
}

/**
 * Đảm bảo có phiên. Trả null nếu không lấy được — caller phải xử lý được null.
 * Gọi nhiều lần song song vẫn chỉ có một request bay đi (`inflight`).
 */
export async function ensureSession(force = false): Promise<string | null> {
  if (!force) {
    const existing = currentToken();
    if (existing) return existing;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const accessToken = await fetchAccessToken();
      // Zalo App chưa kích hoạt (code -1401) thì không có đường nào lấy được
      // danh tính tài khoản. Rơi về phiên theo thiết bị để app vẫn dùng được.
      if (!accessToken) return await loginWithDevice();

      let res: Response;
      try {
        res = await fetch(`${BASE}/auth/zalo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken })
        });
      } catch (err) {
        lastError = { stage: "server", detail: `Không gọi được ${BASE}/auth/zalo — ${describe(err)}` };
        return null;
      }

      if (!res.ok) {
        lastError = { stage: "server", detail: `${BASE}/auth/zalo trả về HTTP ${res.status}` };
        return null;
      }

      const body = (await res.json()) as { token?: string };
      if (!body.token) {
        lastError = { stage: "server", detail: "Server không trả về token phiên" };
        return null;
      }

      lastError = null;
      cached = body.token;
      store(body.token);
      return body.token;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Lấy access token, có bước xin quyền dự phòng.
 *
 * Zalo ghi: từ SDK 2.35.0 app mặc định lấy được access token không cần user
 * xác nhận — NHƯNG "với các Zalo App có nhiều hơn 1 Mini App, hệ thống vẫn yêu
 * cầu người dùng xác nhận". Nên lần đầu hỏng thì gọi `authorize` xin
 * `scope.userInfo` rồi thử lại đúng một lần, thay vì bó tay.
 */
async function fetchAccessToken(): Promise<string | null> {
  try {
    const token = await getAccessToken({});
    if (typeof token === "string" && token) return token;
    lastError = { stage: "sdk", detail: "getAccessToken trả về rỗng" };
  } catch (err) {
    lastError = { stage: "sdk", detail: `getAccessToken lỗi — ${describe(err)}` };
  }

  try {
    await authorize({ scopes: ["scope.userInfo"] });
  } catch (err) {
    lastError = { stage: "authorize", detail: `Xin quyền bị từ chối — ${describe(err)}` };
    return null;
  }

  try {
    const token = await getAccessToken({});
    if (typeof token === "string" && token) {
      lastError = null;
      return token;
    }
    lastError = { stage: "sdk", detail: "Sau khi xin quyền, getAccessToken vẫn rỗng" };
  } catch (err) {
    lastError = { stage: "sdk", detail: `Sau khi xin quyền vẫn lỗi — ${describe(err)}` };
  }
  return null;
}

/**
 * Phiên theo thiết bị — dùng khi Zalo từ chối cấp access token.
 *
 * Nói thẳng điều đang đánh đổi: id này do client sinh, server không xác minh
 * được. Ai cầm điện thoại đã liên kết thì thấy dữ liệu của người đó. Với nhóm
 * bạn thân đi du lịch thì chấp nhận được, và nó giữ cho app dùng được trong
 * lúc chờ kích hoạt Zalo App — thủ tục có thể mất vài ngày.
 *
 * `getDeviceIdAsync` được ưu tiên vì nó ổn định qua các lần cài lại app; không
 * lấy được thì tự sinh uuid và cất trong localStorage.
 */
async function loginWithDevice(): Promise<string | null> {
  let deviceId: string | null = null;
  try {
    const id = await getDeviceIdAsync({});
    if (typeof id === "string" && id.length >= 16 && id !== "unknown") deviceId = id;
  } catch {
    /* rơi xuống nhánh tự sinh */
  }

  if (!deviceId) {
    try {
      deviceId = localStorage.getItem(DEVICE_KEY);
      if (!deviceId) {
        deviceId = crypto.randomUUID().replace(/-/g, "");
        localStorage.setItem(DEVICE_KEY, deviceId);
      }
    } catch {
      lastError = { stage: "sdk", detail: "Không lấy được device id và không ghi được localStorage" };
      return null;
    }
  }

  // Chuẩn hoá về [A-Za-z0-9_-] cho khớp validate phía server
  const safeId = deviceId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
  if (safeId.length < 16) {
    lastError = { stage: "sdk", detail: "Device id quá ngắn sau khi chuẩn hoá" };
    return null;
  }

  try {
    const res = await fetch(`${BASE}/auth/device`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: safeId })
    });
    if (!res.ok) {
      lastError = { stage: "server", detail: `/auth/device trả về HTTP ${res.status}` };
      return null;
    }
    const body = (await res.json()) as { token?: string };
    if (!body.token) {
      lastError = { stage: "server", detail: "/auth/device không trả token" };
      return null;
    }
    // Giữ nguyên lastError của nhánh Zalo để màn liên kết còn nói được lý do
    // vì sao đang chạy ở chế độ thiết bị.
    deviceMode = true;
    cached = body.token;
    store(body.token);
    return body.token;
  } catch (err) {
    lastError = { stage: "server", detail: `Không gọi được /auth/device — ${describe(err)}` };
    return null;
  }
}

/** AppError của zmp-sdk mang `code` — thứ duy nhất tra được trong tài liệu Zalo. */
function describe(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { code?: number; message?: string; api?: string };
    if (e.code !== undefined) return `code ${e.code}${e.message ? `: ${e.message}` : ""}`;
    if (e.message) return e.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

export function clearSession(): void {
  cached = null;
  store(null);
}

/**
 * Gọi API kèm phiên. 401 thì thử lấy phiên mới ĐÚNG MỘT LẦN rồi gọi lại —
 * token hết hạn sau 30 ngày là chuyện bình thường, không nên bắt user làm gì.
 */
export async function authedFetch<T>(path: string, init?: RequestInit): Promise<T | null> {
  const run = async (token: string | null) => {
    return fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {})
      }
    });
  };

  let token = await ensureSession();
  if (!token) return null;

  let res = await run(token);
  if (res.status === 401) {
    clearSession();
    token = await ensureSession(true);
    if (!token) return null;
    res = await run(token);
  }

  if (!res.ok) return null;
  return (await res.json()) as T;
}

export interface MeResponse {
  appUserId: number;
  linked: boolean;
  member: { zaloUserId: string; displayName: string | null } | null;
}

export interface LinkCodeResponse {
  code?: string;
  expiresAt?: string;
  alreadyLinked: boolean;
  member?: { displayName: string | null };
}

export const session = {
  me: () => authedFetch<MeResponse>("/me"),
  linkCode: () => authedFetch<LinkCodeResponse>("/me/link-code", { method: "POST" }),
  myTrips: () =>
    authedFetch<{ linked: boolean; trips: { id: number; name: string }[] }>("/me/trips")
};

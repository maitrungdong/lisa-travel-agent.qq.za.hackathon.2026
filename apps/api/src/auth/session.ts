import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * JWT HS256 tự ký, viết tay bằng node:crypto.
 *
 * Vì sao không dùng thư viện: thêm `jsonwebtoken` là đổi `pnpm-lock.yaml`, mà
 * CI chạy `pnpm install --frozen-lockfile` — lockfile lệch là cả pipeline đỏ.
 * Trong khi thứ cần ở đây chỉ là "ký một object nhỏ rồi verify lại": 40 dòng,
 * dùng đúng primitive có sẵn của Node, không có bề mặt tấn công nào thêm.
 *
 * Phạm vi có ý thức: chỉ HS256, chỉ kiểm `exp`. Không `nbf`, không `aud`,
 * không key rotation. Đủ cho phiên của Mini App, và ai đọc cũng hiểu hết
 * trong một phút.
 */

export interface SessionClaims {
  /** id của app_users */
  sub: number;
  /** id Zalo trả về khi verify access token */
  zid: string;
  /** giây kể từ epoch */
  exp: number;
}

const b64url = (buf: Buffer | string): string =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const fromB64url = (s: string): Buffer =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function sign(data: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(data).digest());
}

export function signSession(claims: Omit<SessionClaims, "exp">, secret: string, ttlDays = 30): string {
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86_400;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ ...claims, exp }));
  return `${header}.${payload}.${sign(`${header}.${payload}`, secret)}`;
}

/** Trả null cho MỌI trường hợp hỏng — caller chỉ cần biết "có phiên hợp lệ hay không". */
export function verifySession(token: string, secret: string): SessionClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;

  const expected = sign(`${header}.${payload}`, secret);
  const a = fromB64url(signature);
  const b = fromB64url(expected);
  // So sánh constant-time: so bằng `===` để lộ độ dài khớp qua thời gian chạy.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(fromB64url(payload).toString("utf8")) as SessionClaims;
    if (typeof claims.sub !== "number" || typeof claims.exp !== "number") return null;
    if (claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

/**
 * Mã ghép đôi 6 chữ số.
 *
 * Không dùng Math.random: mã này được gõ công khai trong nhóm chat và là thứ
 * quyết định "ai là ai" — sinh bằng nguồn ngẫu nhiên yếu thì đoán được.
 */
export function generateLinkCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

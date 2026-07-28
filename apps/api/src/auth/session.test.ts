import { describe, expect, it } from "vitest";
import { generateLinkCode, signSession, verifySession } from "./session";

const SECRET = "secret-cua-server";

describe("JWT phiên", () => {
  it("ký rồi verify lại ra đúng claims", () => {
    const token = signSession({ sub: 42, zid: "3681046936240438345" }, SECRET);
    const claims = verifySession(token, SECRET);
    expect(claims?.sub).toBe(42);
    expect(claims?.zid).toBe("3681046936240438345");
  });

  it("từ chối token ký bằng secret khác", () => {
    const token = signSession({ sub: 1, zid: "x" }, SECRET);
    expect(verifySession(token, "secret-khac")).toBeNull();
  });

  it("từ chối khi payload bị sửa — chữ ký không còn khớp", () => {
    const token = signSession({ sub: 1, zid: "x" }, SECRET);
    const [h, p, s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: 999, zid: "x", exp: 9e9 }))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(p).not.toBe(forged);
    expect(verifySession(`${h}.${forged}.${s}`, SECRET)).toBeNull();
  });

  it("từ chối token đã hết hạn", () => {
    const token = signSession({ sub: 1, zid: "x" }, SECRET, -1); // hết hạn từ hôm qua
    expect(verifySession(token, SECRET)).toBeNull();
  });

  it("không ném lỗi với chuỗi rác", () => {
    for (const rubbish of ["", "abc", "a.b", "a.b.c", "...", "Bearer x.y.z"]) {
      expect(() => verifySession(rubbish, SECRET)).not.toThrow();
      expect(verifySession(rubbish, SECRET)).toBeNull();
    }
  });

  it("secret rỗng vẫn không làm sập verify", () => {
    expect(verifySession("a.b.c", "")).toBeNull();
  });
});

describe("mã ghép đôi", () => {
  it("luôn đúng 6 chữ số, giữ cả số 0 ở đầu", () => {
    for (let i = 0; i < 500; i++) {
      expect(generateLinkCode()).toMatch(/^\d{6}$/);
    }
  });

  it("không lặp lại một cách đáng ngờ", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateLinkCode()));
    // 200 lần bốc trong 1 triệu giá trị — trùng vài cái là bình thường,
    // nhưng dưới 190 giá trị khác nhau thì nguồn ngẫu nhiên có vấn đề.
    expect(seen.size).toBeGreaterThan(190);
  });
});

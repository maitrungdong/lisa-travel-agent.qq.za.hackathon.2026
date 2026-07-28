import { createHmac } from "node:crypto";
import { Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { DB, type Database } from "../db/database.module";
import { appUsers, linkCodes, personLinks } from "../db/schema";
import { generateLinkCode, signSession, verifySession, type SessionClaims } from "./session";

const ZALO_GRAPH_ME = "https://graph.zalo.me/v2.0/me";
const CODE_TTL_MS = 5 * 60 * 1000;

export interface ZaloProfile {
  id: string;
  name?: string;
  avatarUrl?: string;
}

/**
 * Xác thực người dùng Mini App và nối danh tính với thành viên nhóm.
 *
 * Nguyên tắc: client KHÔNG BAO GIỜ khai mình là ai. Nó chỉ đưa access token do
 * Zalo cấp; server tự hỏi Zalo xem token đó của ai. `appsecret_proof` (HMAC-SHA256
 * của token bằng app secret) là bằng chứng request đến từ app thật — Zalo bắt buộc
 * từ 01/01/2024.
 */
@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /** Secret ký phiên. Không cấu hình thì tái dùng AGENT_API_KEY — vẫn là bí mật của server. */
  private get sessionSecret(): string {
    return process.env.SESSION_SECRET || process.env.AGENT_API_KEY || "";
  }

  get configured(): boolean {
    return Boolean(process.env.ZALO_APP_SECRET && this.sessionSecret);
  }

  /** Hỏi Zalo: token này của ai. Lỗi mạng/token sai đều thành 401, không rò chi tiết ra client. */
  async fetchZaloProfile(accessToken: string): Promise<ZaloProfile> {
    const secret = process.env.ZALO_APP_SECRET;
    if (!secret) throw new UnauthorizedException("Server chưa cấu hình ZALO_APP_SECRET");

    const proof = createHmac("sha256", secret).update(accessToken).digest("hex");
    const url = `${ZALO_GRAPH_ME}?fields=id,name,picture`;

    let body: {
      id?: string;
      name?: string;
      error?: number;
      message?: string;
      picture?: { data?: { url?: string } };
    };
    try {
      const res = await fetch(url, {
        headers: { access_token: accessToken, appsecret_proof: proof },
        signal: AbortSignal.timeout(10_000)
      });
      body = (await res.json()) as typeof body;
    } catch (err) {
      this.log.error(`Không gọi được graph.zalo.me: ${String(err)}`);
      throw new UnauthorizedException("Không xác thực được với Zalo");
    }

    if (!body?.id || (body.error && body.error !== 0)) {
      this.log.warn(`Zalo từ chối token: ${body?.error ?? "?"} ${body?.message ?? ""}`);
      throw new UnauthorizedException("Access token không hợp lệ");
    }

    return { id: body.id, name: body.name, avatarUrl: body.picture?.data?.url };
  }

  /** Tạo hoặc cập nhật app_user rồi phát JWT phiên. */
  async loginWithAccessToken(accessToken: string): Promise<{ token: string; appUserId: number }> {
    const profile = await this.fetchZaloProfile(accessToken);

    const [row] = await this.db
      .insert(appUsers)
      .values({
        zaloAppUserId: profile.id,
        displayName: profile.name ?? null,
        avatarUrl: profile.avatarUrl ?? null
      })
      .onConflictDoUpdate({
        target: appUsers.zaloAppUserId,
        set: {
          displayName: profile.name ?? null,
          avatarUrl: profile.avatarUrl ?? null,
          lastSeenAt: new Date()
        }
      })
      .returning();

    return {
      token: signSession({ sub: row.id, zid: profile.id }, this.sessionSecret),
      appUserId: row.id
    };
  }

  /**
   * Phiên theo thiết bị — đường lui khi Zalo App chưa được kích hoạt.
   *
   * Tiền tố `device:` giữ nó nằm chung bảng `app_users` mà vẫn phân biệt được
   * với danh tính Zalo thật. Khi app được kích hoạt, cùng một người sẽ có bản
   * ghi mới theo id Zalo và phải liên kết lại — chấp nhận được, vì đổi lại là
   * dùng được ngay hôm nay.
   */
  async loginWithDeviceId(deviceId: string): Promise<{ token: string; appUserId: number }> {
    const [row] = await this.db
      .insert(appUsers)
      .values({ zaloAppUserId: `device:${deviceId}`, displayName: null })
      .onConflictDoUpdate({
        target: appUsers.zaloAppUserId,
        set: { lastSeenAt: new Date() }
      })
      .returning();

    return {
      token: signSession({ sub: row.id, zid: `device:${deviceId}` }, this.sessionSecret),
      appUserId: row.id
    };
  }

  /** Đọc phiên từ header Authorization. Không có/hỏng/hết hạn đều trả null. */
  readSession(authorization?: string): SessionClaims | null {
    if (!authorization?.startsWith("Bearer ")) return null;
    if (!this.sessionSecret) return null;
    return verifySession(authorization.slice(7).trim(), this.sessionSecret);
  }

  /** Người này đã nối với thành viên nhóm nào chưa. */
  async getLink(appUserId: number) {
    const [row] = await this.db
      .select()
      .from(personLinks)
      .where(eq(personLinks.appUserId, appUserId));
    return row ?? null;
  }

  /**
   * Cấp mã ghép đôi. Còn mã sống thì trả lại đúng mã đó — người dùng mở lại app
   * giữa chừng không nên thấy một mã mới trong khi mã cũ đã gõ dở trong nhóm.
   */
  async issueLinkCode(appUserId: number): Promise<{ code: string; expiresAt: Date }> {
    const now = new Date();
    const [alive] = await this.db
      .select()
      .from(linkCodes)
      .where(
        and(
          eq(linkCodes.appUserId, appUserId),
          isNull(linkCodes.usedAt),
          gt(linkCodes.expiresAt, now)
        )
      )
      .orderBy(desc(linkCodes.createdAt))
      .limit(1);
    if (alive) return { code: alive.code, expiresAt: alive.expiresAt };

    // Va chạm mã 6 số là hiếm nhưng có thật (unique index chặn) → thử vài lần.
    for (let i = 0; i < 5; i++) {
      const code = generateLinkCode();
      const expiresAt = new Date(Date.now() + CODE_TTL_MS);
      try {
        await this.db.insert(linkCodes).values({ code, appUserId, expiresAt });
        return { code, expiresAt };
      } catch {
        continue;
      }
    }
    throw new Error("Không sinh được mã ghép đôi");
  }

  /**
   * Bot gọi hàm này khi thấy mã trong nhóm.
   *
   * `zaloBotUserId` đến TỪ WEBHOOK (`from.id`), không phải từ lời khai của ai —
   * đó là chỗ toàn bộ độ tin cậy của cơ chế này nằm ở.
   */
  async redeemCode(
    code: string,
    zaloBotUserId: string,
    displayName: string,
    conversationId?: number
  ): Promise<{ ok: true; appUserId: number } | { ok: false; reason: string }> {
    const now = new Date();
    const [row] = await this.db
      .select()
      .from(linkCodes)
      .where(and(eq(linkCodes.code, code), isNull(linkCodes.usedAt), gt(linkCodes.expiresAt, now)))
      .limit(1);
    if (!row) return { ok: false, reason: "Mã không đúng hoặc đã hết hạn" };

    // Đánh dấu đã dùng TRƯỚC khi nối: hai người gõ cùng mã thì chỉ người đầu ăn.
    const used = await this.db
      .update(linkCodes)
      .set({ usedAt: now })
      .where(and(eq(linkCodes.id, row.id), isNull(linkCodes.usedAt)))
      .returning();
    if (used.length === 0) return { ok: false, reason: "Mã vừa được dùng bởi người khác" };

    try {
      await this.db
        .insert(personLinks)
        .values({
          appUserId: row.appUserId,
          zaloBotUserId,
          displayName,
          linkedVia: "code",
          conversationId: conversationId ?? null
        })
        .onConflictDoUpdate({
          target: personLinks.appUserId,
          set: { zaloBotUserId, displayName, conversationId: conversationId ?? null }
        });
    } catch {
      // Vướng unique bên phía bot: tài khoản Zalo khác đã nhận là người này rồi.
      return { ok: false, reason: "Thành viên này đã được liên kết với tài khoản khác" };
    }

    return { ok: true, appUserId: row.appUserId };
  }

  /** Có bao nhiêu người đã nối — dùng cho log/chẩn đoán. */
  async linkCount(): Promise<number> {
    const [row] = await this.db.select({ n: sql<number>`count(*)::int` }).from(personLinks);
    return row?.n ?? 0;
  }
}

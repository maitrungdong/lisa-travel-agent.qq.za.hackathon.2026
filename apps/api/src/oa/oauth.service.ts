import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq, lt } from "drizzle-orm";
import { DB, type Database } from "../db/database.module";
import { oauthStates, partnerOas } from "../db/schema";

const OAUTH_BASE = "https://oauth.zaloapp.com/v4/oa";
const OPEN_API = "https://openapi.zalo.me";

/** Access token OA sống 25 GIỜ. Refresh sớm 1 giờ cho an toàn. */
const TOKEN_TTL_MS = 25 * 60 * 60 * 1000;
const REFRESH_MARGIN_MS = 60 * 60 * 1000;
/** authorization_code hiệu lực 10 phút → state không cần sống lâu hơn */
const STATE_TTL_MS = 10 * 60 * 1000;

export interface OaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * OAuth v4 + PKCE cho Zalo OA.
 *
 * Luồng: admin OA mở /oa/connect → màn hình đồng ý của Zalo → callback kèm
 * `code` + `oa_id` → đổi lấy token → app được phép thay mặt OA đó gửi tin.
 *
 * Ba con số dễ sai, đã verify từ tài liệu chính thức:
 *   • access_token   25 GIỜ  (nhiều tài liệu cũ ghi nhầm 1 giờ)
 *   • refresh_token  3 tháng, DÙNG MỘT LẦN — mỗi lần refresh trả token mới,
 *                    ghi đè không kịp là mất quyền, phải uỷ quyền lại từ đầu
 *   • code_verifier  ĐÚNG 43 ký tự, khác nhau mỗi request
 */
@Injectable()
export class OaOAuthService {
  private readonly log = new Logger(OaOAuthService.name);
  private readonly appId = process.env.ZALO_APP_ID ?? "";
  private readonly appSecret = process.env.ZALO_APP_SECRET ?? "";

  constructor(@Inject(DB) private readonly db: Database) {}

  get isConfigured(): boolean {
    return Boolean(this.appId && this.appSecret);
  }

  private get redirectUri(): string {
    const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
    return `${base}/oa/callback`;
  }

  /**
   * Sinh URL màn hình đồng ý. Lưu code_verifier theo `state` để callback dùng lại.
   */
  async buildAuthorizeUrl(): Promise<string> {
    const state = randomUUID();
    const codeVerifier = makeCodeVerifier();

    await this.db.insert(oauthStates).values({ state, codeVerifier });
    // Dọn state cũ — bảng này không được phép phình
    await this.db
      .delete(oauthStates)
      .where(lt(oauthStates.createdAt, new Date(Date.now() - STATE_TTL_MS)));

    const params = new URLSearchParams({
      app_id: this.appId,
      redirect_uri: this.redirectUri,
      code_challenge: makeCodeChallenge(codeVerifier),
      state
    });
    return `${OAUTH_BASE}/permission?${params.toString()}`;
  }

  /** Đổi authorization_code lấy token. Code chỉ dùng được 1 lần, hiệu lực 10 phút. */
  async exchangeCode(code: string, state: string): Promise<OaTokens | null> {
    const row = await this.db.query.oauthStates.findFirst({
      where: eq(oauthStates.state, state)
    });
    if (!row) {
      this.log.warn(`State không tồn tại hoặc đã hết hạn: ${state}`);
      return null;
    }
    await this.db.delete(oauthStates).where(eq(oauthStates.state, state));

    if (Date.now() - row.createdAt.getTime() > STATE_TTL_MS) {
      this.log.warn("State quá hạn 10 phút");
      return null;
    }

    return this.requestToken({
      code,
      app_id: this.appId,
      grant_type: "authorization_code",
      code_verifier: row.codeVerifier
    });
  }

  private async requestToken(body: Record<string, string>): Promise<OaTokens | null> {
    try {
      const res = await fetch(`${OAUTH_BASE}/access_token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          secret_key: this.appSecret
        },
        body: new URLSearchParams(body).toString(),
        signal: AbortSignal.timeout(15_000)
      });

      const json = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: string | number;
        error?: number;
        error_name?: string;
        error_description?: string;
      };

      if (!json.access_token || !json.refresh_token) {
        this.log.error(
          `Đổi token thất bại: ${json.error_name ?? json.error} — ${json.error_description ?? ""}`
        );
        return null;
      }

      const ttl = Number(json.expires_in) > 0 ? Number(json.expires_in) * 1000 : TOKEN_TTL_MS;
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: new Date(Date.now() + ttl)
      };
    } catch (err) {
      this.log.error(`Lỗi gọi access_token: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Lấy access token còn hạn của một OA, tự refresh khi sắp hết.
   *
   * ⚠ refresh_token dùng 1 lần: phải ghi token MỚI xuống DB ngay, nếu process
   * chết giữa chừng là mất quyền vĩnh viễn và merchant phải uỷ quyền lại.
   */
  async getValidToken(partnerId: number): Promise<string | null> {
    const oa = await this.db.query.partnerOas.findFirst({
      where: eq(partnerOas.id, partnerId)
    });
    if (!oa?.accessToken || !oa.refreshToken) return null;

    const stillFresh =
      oa.tokenExpiresAt && oa.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS;
    if (stillFresh) return oa.accessToken;

    this.log.log(`Refresh token cho OA ${oa.oaId}`);
    const tokens = await this.requestToken({
      refresh_token: oa.refreshToken,
      app_id: this.appId,
      grant_type: "refresh_token"
    });

    if (!tokens) {
      // Refresh hỏng → đánh dấu mất kết nối để UI hiện rõ, đừng im lặng
      await this.db
        .update(partnerOas)
        .set({ connected: false })
        .where(eq(partnerOas.id, partnerId));
      this.log.error(`Mất uỷ quyền OA ${oa.oaId} — merchant phải kết nối lại`);
      return null;
    }

    await this.saveTokens(partnerId, tokens);
    return tokens.accessToken;
  }

  async saveTokens(partnerId: number, tokens: OaTokens): Promise<void> {
    await this.db
      .update(partnerOas)
      .set({
        connected: true,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenExpiresAt: tokens.expiresAt,
        connectedAt: new Date()
      })
      .where(eq(partnerOas.id, partnerId));
  }

  /** Lấy hồ sơ OA vừa uỷ quyền — tên, ngành, avatar, số follower. */
  async fetchOaProfile(accessToken: string): Promise<{
    oaid: string;
    name: string;
    oa_alias?: string;
    cate_name?: string;
    avatar?: string;
    num_follower?: number;
    is_verified?: boolean;
  } | null> {
    try {
      const res = await fetch(`${OPEN_API}/v2.0/oa/getoa`, {
        headers: { access_token: accessToken },
        signal: AbortSignal.timeout(15_000)
      });
      const json = (await res.json()) as { error?: number; message?: string; data?: never };
      if (json.error !== 0 || !json.data) {
        this.log.error(`getoa lỗi ${json.error}: ${json.message}`);
        return null;
      }
      return json.data;
    } catch (err) {
      this.log.error(`Lỗi getoa: ${(err as Error).message}`);
      return null;
    }
  }
}

/**
 * code_verifier: ĐÚNG 43 ký tự, đủ hoa/thường/số.
 * Zalo từ chối chuỗi ngắn/dài hơn — đây là chỗ hay sai nhất khi tự implement PKCE.
 */
function makeCodeVerifier(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(43);
  let out = "";
  for (let i = 0; i < 43; i++) out += alphabet[bytes[i] % alphabet.length];
  // Bảo đảm có đủ 3 loại ký tự
  return `Aa1${out.slice(3)}`;
}

/** code_challenge = base64url(SHA256(verifier)), bỏ padding. */
function makeCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

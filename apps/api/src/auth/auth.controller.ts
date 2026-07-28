import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  UnauthorizedException
} from "@nestjs/common";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DB, type Database } from "../db/database.module";
import { members, trips } from "../db/schema";
import { TripsService } from "../trips/trips.service";
import { AuthService } from "./auth.service";

/**
 * Phiên của Mini App + dữ liệu theo người dùng.
 *
 * Lưu ý thiết kế: các route `/trips/*` cũ KHÔNG bị gắn guard. Bot, trang tổng
 * kết và bản Mini App đang chạy ngoài thực địa đều đang gọi chúng; siết lại
 * ngay bây giờ là tự tạo rủi ro chết demo mà không đổi lại được gì. Phần theo
 * người dùng nằm ở các route `/me/*` mới — chưa đăng nhập thì không có gì để
 * lộ, mà đăng nhập rồi thì chỉ thấy chuyến của mình.
 */
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tripsService: TripsService,
    @Inject(DB) private readonly db: Database
  ) {}

  /** Đổi access token của zmp-sdk lấy JWT phiên. */
  @Post("auth/zalo")
  async login(@Body() body: { accessToken?: string }) {
    const token = body?.accessToken?.trim();
    if (!token) throw new BadRequestException("Thiếu accessToken");
    const { token: session } = await this.auth.loginWithAccessToken(token);
    return { token: session };
  }

  /**
   * Đăng nhập theo THIẾT BỊ — đường lui khi Zalo chặn xác thực tài khoản.
   *
   * Bối cảnh: `getAccessToken` trả `-1401 "Zalo app has not been activated"` khi
   * Zalo App cha chưa được kích hoạt trong console. Đó là thủ tục hành chính,
   * có thể mất vài ngày, và nó chặn sạch mọi thứ phía sau.
   *
   * Đánh đổi, nói thẳng: danh tính ở đây do CLIENT sinh ra, server không xác
   * minh được. Ai cầm điện thoại đã liên kết thì thấy dữ liệu của người đó.
   * Với nhóm bạn thân đi du lịch trong kỳ hackathon thì chấp nhận được; khi
   * app được kích hoạt, `/auth/zalo` tự động thắng và đường này ngừng được dùng.
   */
  @Post("auth/device")
  async loginWithDevice(@Body() body: { deviceId?: string }) {
    const raw = body?.deviceId?.trim();
    // Yêu cầu chuỗi đủ dài và đủ ngẫu nhiên — chặn kiểu đoán "device:1", "device:2"
    if (!raw || raw.length < 16 || raw.length > 128 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
      throw new BadRequestException("deviceId không hợp lệ");
    }
    const { token } = await this.auth.loginWithDeviceId(raw);
    return { token, mode: "device" };
  }

  /** Chẩn đoán: server đã đủ cấu hình để xác thực chưa. Không trả secret. */
  @Get("auth/status")
  status() {
    return {
      configured: this.auth.configured,
      missing: [
        process.env.ZALO_APP_SECRET ? null : "ZALO_APP_SECRET",
        process.env.SESSION_SECRET || process.env.AGENT_API_KEY ? null : "SESSION_SECRET"
      ].filter(Boolean)
    };
  }

  /** Tôi là ai, đã nối với thành viên nào chưa. */
  @Get("me")
  async me(@Headers("authorization") authorization?: string) {
    const claims = this.requireSession(authorization);
    const link = await this.auth.getLink(claims.sub);
    return {
      appUserId: claims.sub,
      linked: Boolean(link),
      member: link
        ? { zaloUserId: link.zaloBotUserId, displayName: link.displayName }
        : null
    };
  }

  /** Mã 6 số để gõ vào nhóm. */
  @Post("me/link-code")
  async linkCode(@Headers("authorization") authorization?: string) {
    const claims = this.requireSession(authorization);
    const existing = await this.auth.getLink(claims.sub);
    if (existing) {
      return { alreadyLinked: true, member: { displayName: existing.displayName } };
    }
    const { code, expiresAt } = await this.auth.issueLinkCode(claims.sub);
    return { code, expiresAt: expiresAt.toISOString(), alreadyLinked: false };
  }

  /** Chỉ những chuyến mà tôi là thành viên. */
  @Get("me/trips")
  async myTrips(@Headers("authorization") authorization?: string) {
    const claims = this.requireSession(authorization);
    const link = await this.auth.getLink(claims.sub);
    if (!link) return { linked: false, trips: [] };

    const rows = await this.db
      .select({ tripId: members.tripId })
      .from(members)
      .where(eq(members.zaloUserId, link.zaloBotUserId));
    const ids = rows.map((r) => r.tripId);
    if (ids.length === 0) return { linked: true, trips: [] };

    const list = await this.db
      .select()
      .from(trips)
      .where(inArray(trips.id, ids))
      .orderBy(desc(trips.startDate));
    return { linked: true, trips: list };
  }

  /** Recap của một chuyến, có kiểm tra tôi có trong chuyến đó không. */
  @Get("me/trips/:id/recap")
  async myTripRecap(
    @Param("id", ParseIntPipe) id: number,
    @Headers("authorization") authorization?: string
  ) {
    const claims = this.requireSession(authorization);
    const link = await this.auth.getLink(claims.sub);
    if (!link) throw new UnauthorizedException("Chưa liên kết với thành viên nào");

    const [membership] = await this.db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.tripId, id), eq(members.zaloUserId, link.zaloBotUserId)))
      .limit(1);
    if (!membership) throw new UnauthorizedException("Bạn không thuộc chuyến đi này");

    return this.tripsService.recap(id);
  }

  private requireSession(authorization?: string) {
    const claims = this.auth.readSession(authorization);
    if (!claims) throw new UnauthorizedException("Phiên không hợp lệ hoặc đã hết hạn");
    return claims;
  }
}

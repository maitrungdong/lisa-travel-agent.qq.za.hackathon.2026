import { createHmac, timingSafeEqual } from "node:crypto";
import { Body, Controller, Get, Headers, HttpCode, Logger, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { desc, eq } from "drizzle-orm";
import { Inject } from "@nestjs/common";
import { DB, type Database } from "../db/database.module";
import { conversations, oaLeads, partnerOas } from "../db/schema";
import { JobsService } from "../jobs/jobs.service";
import { normalizeOaEvent, type OaWebhookEvent } from "./oa.client";
import { OaOAuthService } from "./oauth.service";

/**
 * Partner Network — 3 endpoint.
 *
 *   GET  /oa/connect   admin OA bấm vào đây → màn hình đồng ý của Zalo
 *   GET  /oa/callback  Zalo trả về code + oa_id → đổi token, lưu OA
 *   POST /oa/webhook   tin user gửi tới OA đối tác → tạo lead → agent trả lời
 *
 * Xem docs/PARTNER-NETWORK.md để hiểu vì sao luồng này hợp lệ.
 */
@Controller("oa")
export class OaController {
  private readonly log = new Logger(OaController.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly oauth: OaOAuthService,
    private readonly jobs: JobsService
  ) {}

  /** Bước 1 — chuyển hướng admin OA sang màn hình đồng ý của Zalo. */
  @Get("connect")
  async connect(@Res() res: Response): Promise<void> {
    if (!this.oauth.isConfigured) {
      res.status(500).send(page("Chưa cấu hình", "Thiếu ZALO_APP_ID / ZALO_APP_SECRET trên server."));
      return;
    }
    res.redirect(await this.oauth.buildAuthorizeUrl());
  }

  /** Bước 2 — Zalo gọi lại với `code` + `oa_id`. Code chỉ dùng được 1 lần. */
  @Get("callback")
  async callback(
    @Query("code") code: string,
    @Query("oa_id") oaId: string,
    @Query("state") state: string,
    @Res() res: Response
  ): Promise<void> {
    if (!code || !state) {
      res.status(400).send(page("Thiếu tham số", "Zalo không trả về code hoặc state."));
      return;
    }

    const tokens = await this.oauth.exchangeCode(code, state);
    if (!tokens) {
      res.status(400).send(page("Kết nối thất bại", "Không đổi được mã uỷ quyền. Thử lại từ đầu nhé."));
      return;
    }

    // Lấy hồ sơ OA để hiển thị tên thật thay vì chỉ có id
    const profile = await this.oauth.fetchOaProfile(tokens.accessToken);
    const resolvedOaId = profile?.oaid ?? oaId;
    const name = profile?.name ?? `OA ${resolvedOaId}`;

    // OA có thể đã nằm sẵn trong directory (được seed trước) → cập nhật, không nhân bản
    const existing = await this.db.query.partnerOas.findFirst({
      where: eq(partnerOas.oaId, resolvedOaId)
    });

    let partnerId: number;
    if (existing) {
      partnerId = existing.id;
      await this.db
        .update(partnerOas)
        .set({
          name,
          avatarUrl: profile?.avatar ?? existing.avatarUrl,
          deeplink: `https://zalo.me/${resolvedOaId}`
        })
        .where(eq(partnerOas.id, existing.id));
    } else {
      const [row] = await this.db
        .insert(partnerOas)
        .values({
          oaId: resolvedOaId,
          name,
          category: guessCategory(profile?.cate_name),
          city: "Chưa rõ",
          description: profile?.cate_name ?? null,
          avatarUrl: profile?.avatar ?? null,
          deeplink: `https://zalo.me/${resolvedOaId}`
        })
        .returning({ id: partnerOas.id });
      partnerId = row.id;
    }

    await this.oauth.saveTokens(partnerId, tokens);
    this.log.log(`OA "${name}" (${resolvedOaId}) đã gia nhập mạng lưới`);

    res.send(
      page(
        "Kết nối thành công 🎉",
        `<b>${escapeHtml(name)}</b> đã gia nhập mạng lưới Lisa.<br><br>` +
          `Từ giờ khi khách hỏi qua Lisa, OA của bạn sẽ nhận được lead và ` +
          `Lisa trả lời tự động trong vài giây — bằng đúng dữ liệu bạn cung cấp.` +
          `<div class="meta">OA ID: ${escapeHtml(resolvedOaId)}${
            profile?.num_follower ? ` · ${profile.num_follower} người quan tâm` : ""
          }</div>`
      )
    );
  }

  /**
   * Bước 3 — user nhắn cho OA đối tác, Zalo đẩy về đây.
   *
   * Trả 200 ngay rồi mới xử lý, giống webhook Zalo Bot: xử lý đồng bộ mà timeout
   * là Zalo retry, agent trả lời khách hai lần.
   */
  @Post("webhook")
  @HttpCode(200)
  async webhook(
    @Body() body: OaWebhookEvent,
    @Headers("x-zevent-signature") signature?: string
  ): Promise<{ ok: boolean }> {
    if (!verifyOaSignature(body, signature)) {
      this.log.warn("Webhook OA bị từ chối: sai chữ ký");
      return { ok: true };
    }

    void this.ingest(body).catch((err) =>
      this.log.error(`Lỗi xử lý webhook OA: ${(err as Error).message}`)
    );
    return { ok: true };
  }

  private async ingest(raw: OaWebhookEvent): Promise<void> {
    const ev = normalizeOaEvent(raw);
    if (!ev || !ev.text) return;

    const partner = await this.db.query.partnerOas.findFirst({
      where: eq(partnerOas.oaId, ev.oaId)
    });
    if (!partner?.connected) {
      this.log.warn(`Nhận webhook của OA chưa uỷ quyền: ${ev.oaId}`);
      return;
    }

    // Nối lead về hội thoại Lisa gần nhất — đây là chỗ khép vòng lặp.
    // Hackathon quy mô nhỏ nên lấy hội thoại hoạt động gần nhất là đủ chính xác;
    // production nên gắn token định danh vào tin soạn sẵn của draft_oa_inquiry.
    const [recent] = await this.db
      .select({ id: conversations.id, tripId: conversations.activeTripId })
      .from(conversations)
      .orderBy(desc(conversations.lastSeenAt))
      .limit(1);

    const [lead] = await this.db
      .insert(oaLeads)
      .values({
        partnerOaId: partner.id,
        oaUserId: ev.userId,
        conversationId: recent?.id ?? null,
        tripId: recent?.tripId ?? null,
        lastUserMessage: ev.text,
        status: "new"
      })
      .onConflictDoUpdate({
        target: [oaLeads.partnerOaId, oaLeads.oaUserId],
        set: { lastUserMessage: ev.text, status: "new", updatedAt: new Date() }
      })
      .returning({ id: oaLeads.id });

    // dedupeKey theo OA → nhiều lead cùng OA xử lý tuần tự, không đua nhau refresh token
    await this.jobs.enqueue("merchant_reply", { leadId: lead.id }, { dedupeKey: `oa:${ev.oaId}` });
  }

  /** Danh sách OA trong mạng lưới — Mini App và trang dashboard cùng dùng. */
  @Get("network")
  async network() {
    const rows = await this.db.select().from(partnerOas).where(eq(partnerOas.connected, true));
    return {
      count: rows.length,
      partners: rows.map((r) => ({
        oaId: r.oaId,
        name: r.name,
        category: r.category,
        city: r.city,
        avatarUrl: r.avatarUrl,
        connectedAt: r.connectedAt,
        autoReply: r.autoReply,
        hasInventory: Boolean(r.inventoryNote)
      }))
    };
  }
}

/* ------------------------------------------------------------------------- */

/**
 * Zalo ký webhook OA bằng SHA256(appId + data + timestamp + OASecretKey).
 * Chưa cấu hình secret thì không chặn — tiện dev, nhưng production PHẢI có.
 */
function verifyOaSignature(body: OaWebhookEvent, signature?: string): boolean {
  const secret = process.env.ZALO_OA_SECRET;
  if (!secret) return true;
  if (!signature) return false;

  const appId = body.app_id ?? process.env.ZALO_APP_ID ?? "";
  const payload = `${appId}${JSON.stringify(body)}${body.timestamp ?? ""}${secret}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  const a = Buffer.from(signature.replace(/^mac=/, ""));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function guessCategory(cateName?: string): string {
  const c = (cateName ?? "").toLowerCase();
  if (/khách sạn|hotel|resort|homestay|lưu trú/.test(c)) return "HOTEL";
  if (/ăn|uống|nhà hàng|cà phê|food|quán/.test(c)) return "FNB";
  if (/tour|du lịch|lữ hành/.test(c)) return "TOUR";
  if (/xe|vận chuyển|taxi|thuê/.test(c)) return "TRANSPORT";
  return "ACTIVITY";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c
  );
}

/** Trang kết quả tối giản, tự chứa — admin OA mở trên điện thoại. */
function page(title: string, body: string): string {
  return `<!DOCTYPE html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Lisa</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;align-items:center;
justify-content:center;padding:24px;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background:linear-gradient(160deg,#0f766e,#0891b2);color:#0f172a}
.card{background:#fff;border-radius:20px;padding:32px 24px;max-width:420px;width:100%;
box-shadow:0 20px 50px rgba(0,0,0,.2)}
h1{margin:0 0 12px;font-size:22px}p{margin:0;color:#334155}
.meta{margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:13px;color:#64748b}
</style></head><body><div class="card"><h1>${escapeHtml(title)}</h1><p>${body}</p></div></body></html>`;
}

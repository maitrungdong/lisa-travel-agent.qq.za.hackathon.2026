import Anthropic from "@anthropic-ai/sdk";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DB, type Database } from "../db/database.module";
import { oaLeads, partnerOas } from "../db/schema";
import { ZaloClient } from "../zalo/zalo.client";
import { OaClient } from "./oa.client";
import { OaOAuthService } from "./oauth.service";

/**
 * Agent trả lời thay OA đối tác.
 *
 * Nguyên tắc bất di bất dịch: **chỉ trả lời trong phạm vi `inventory_note`**
 * mà merchant tự khai. Không có dữ liệu thì nói không biết và hẹn người thật.
 *
 * Vì sao nghiêm ngặt: đây là tin nhắn gửi đi DƯỚI DANH NGHĨA merchant. Bịa một
 * mức giá là gây thiệt hại thật cho họ. Thà trả lời thiếu còn hơn trả lời sai.
 */
@Injectable()
export class MerchantAgentService {
  private readonly log = new Logger(MerchantAgentService.name);
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly oauth: OaOAuthService,
    private readonly oa: OaClient,
    private readonly zalo: ZaloClient
  ) {}

  /**
   * Xử lý một tin user vừa gửi tới OA đối tác:
   *   1. soạn trả lời từ inventory của merchant
   *   2. gửi trả lời đó qua OA (tin tư vấn, miễn phí, trong cửa sổ 7 ngày)
   *   3. đẩy tóm tắt về nhóm Lisa đã giới thiệu OA này
   */
  async handleLead(leadId: number): Promise<void> {
    const lead = await this.db.query.oaLeads.findFirst({ where: eq(oaLeads.id, leadId) });
    if (!lead) return;

    const partner = await this.db.query.partnerOas.findFirst({
      where: eq(partnerOas.id, lead.partnerOaId)
    });
    if (!partner) return;

    if (!partner.autoReply) {
      this.log.log(`OA ${partner.oaId} tắt auto-reply — bỏ qua lead #${leadId}`);
      return;
    }

    const token = await this.oauth.getValidToken(partner.id);
    if (!token) {
      this.log.warn(`Không có token hợp lệ cho OA ${partner.oaId}`);
      return;
    }

    const reply = await this.draftReply(
      partner.name,
      partner.category,
      partner.inventoryNote,
      lead.lastUserMessage ?? ""
    );
    if (!reply) return;

    const sent = await this.oa.sendText(token, lead.oaUserId, reply);
    if (!sent) return;

    await this.db
      .update(oaLeads)
      .set({ lastReply: reply, status: "replied", updatedAt: new Date() })
      .where(eq(oaLeads.id, leadId));

    await this.notifyLisaGroup(lead.conversationId, partner.name, reply);
  }

  /** Sinh câu trả lời. Trả null nếu không nên gửi gì. */
  private async draftReply(
    oaName: string,
    category: string,
    inventory: string | null,
    userMessage: string
  ): Promise<string | null> {
    if (!userMessage) return null;

    const system = `Bạn đang trả lời tin nhắn khách hàng THAY MẶT "${oaName}" (${categoryLabel(category)}) trên Zalo OA.

# Nguyên tắc TUYỆT ĐỐI
1. CHỈ dùng thông tin trong phần "Dữ liệu cửa hàng" bên dưới. Không có thì nói thẳng
   "để em kiểm tra lại và báo anh/chị ngay ạ" — TUYỆT ĐỐI KHÔNG BỊA giá, phòng trống,
   khuyến mãi hay chính sách.
2. Bạn đang nói với tư cách nhân viên của ${oaName}. Xưng "em", gọi khách là "anh/chị".
3. Ngắn gọn, dưới 600 ký tự. Plain text, KHÔNG markdown.
4. Nếu khách hỏi nhiều ý, trả lời theo thứ tự, đánh số.
5. Kết thúc bằng một câu mời hành động cụ thể (đặt cọc, xem phòng, gọi hotline...).

${
  inventory
    ? `# Dữ liệu cửa hàng\n${inventory}`
    : `# Dữ liệu cửa hàng\n(chưa có) → chỉ chào hỏi lịch sự, ghi nhận yêu cầu và hẹn phản hồi.`
}`;

    try {
      const res = await this.anthropic.messages.create({
        model: process.env.LISA_MERCHANT_MODEL ?? "claude-haiku-4-5-20251001",
        max_tokens: 600,
        system,
        messages: [{ role: "user", content: userMessage }]
      });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      return text || null;
    } catch (err) {
      this.log.error(`Merchant agent lỗi: ${(err as Error).message}`);
      return null;
    }
  }

  /** Đẩy kết quả ngược về nhóm Lisa — đây là chỗ vòng lặp khép lại. */
  private async notifyLisaGroup(
    conversationId: number | null,
    oaName: string,
    reply: string
  ): Promise<void> {
    if (!conversationId) return;

    const conv = await this.db.query.conversations.findFirst({
      where: (c, { eq: e }) => e(c.id, conversationId)
    });
    if (!conv) return;

    const summary = reply.length > 400 ? `${reply.slice(0, 400)}…` : reply;
    await this.zalo.sendRaw(
      conv.zaloChatId,
      `📩 ${oaName} vừa trả lời:\n\n"${summary}"\n\nCần mình chốt luôn không?`
    );
  }
}

function categoryLabel(category: string): string {
  const map: Record<string, string> = {
    HOTEL: "khách sạn",
    TOUR: "công ty tour",
    FNB: "nhà hàng",
    TRANSPORT: "dịch vụ vận chuyển",
    ACTIVITY: "khu vui chơi"
  };
  return map[category] ?? "doanh nghiệp du lịch";
}

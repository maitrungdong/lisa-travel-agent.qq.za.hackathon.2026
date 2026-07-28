import { and, eq, ilike, or, sql } from "drizzle-orm";
import { activities, partnerOas } from "../../db/schema";
import { S, schema, type ToolDef } from "./types";

/**
 * TƯƠNG TÁC HỆ SINH THÁI ZALO OA.
 *
 * ⚠ Sự thật kỹ thuật cần nhớ (đã verify từ tài liệu Zalo):
 *   • Zalo KHÔNG có API tìm kiếm/directory Official Account
 *   • Zalo KHÔNG có API để server gửi tin tới OA khác
 *   • Mọi thư viện làm được điều đó (zca-js, zlapi…) đều giả lập tài khoản cá
 *     nhân → VI PHẠM ToS, rủi ro khoá tài khoản. Không dùng.
 *
 * Đường hợp lệ duy nhất: Mini App SDK `openChat({type:"oa", id, message})` —
 * mở đúng cửa sổ chat với OA và ĐIỀN SẴN nội dung; quyền bấm Gửi thuộc về user.
 * Tài liệu Zalo ghi rõ: "việc gửi tin nhắn hay không phụ thuộc vào quyết định
 * của người dùng."
 *
 * Nên directory OA ở đây do team tự seed — hợp lệ, minh bạch, và là cách duy nhất.
 */
export const partnerTools: ToolDef[] = [
  {
    name: "search_partner_oa",
    description:
      "Tìm Official Account đối tác du lịch (khách sạn, tour, nhà hàng, xe) trong mạng lưới của Zino. " +
      "Dùng khi user cần tìm chỗ ở, chỗ ăn, tour, phương tiện. " +
      "Kết quả là các OA thật trên Zalo mà user có thể nhắn tin trực tiếp.",
    input_schema: schema(
      {
        city: S.str('Thành phố, vd "Đà Nẵng"'),
        category: S.enum(
          ["HOTEL", "TOUR", "FNB", "TRANSPORT", "ACTIVITY"],
          "Loại đối tác cần tìm"
        ),
        keyword: S.str('Từ khoá lọc thêm, vd "gần biển", "hồ bơi", "hải sản"'),
        limit: S.int("Số kết quả tối đa, mặc định 3")
      },
      []
    ),
    handler: async (input, ctx) => {
      const limit = Math.min(Math.max(Number(input.limit) || 3, 1), 8);
      const filters = [];

      if (input.city) filters.push(ilike(partnerOas.city, `%${input.city}%`));
      if (input.category) filters.push(eq(partnerOas.category, input.category));
      if (input.keyword) {
        filters.push(
          or(
            ilike(partnerOas.name, `%${input.keyword}%`),
            ilike(partnerOas.description, `%${input.keyword}%`),
            ilike(partnerOas.tags, `%${input.keyword}%`)
          )!
        );
      }

      const rows = await ctx.db
        .select()
        .from(partnerOas)
        .where(filters.length ? and(...filters) : sql`true`)
        .limit(limit);

      if (rows.length === 0) {
        return {
          ok: true,
          results: [],
          hint:
            "Chưa có đối tác nào khớp trong mạng lưới. Hãy dùng web_search để gợi ý " +
            "lựa chọn phổ biến, và nói thật với user là chưa kết nối OA cho khu vực này."
        };
      }

      return {
        ok: true,
        count: rows.length,
        results: rows.map((r) => ({
          oa_id: r.oaId,
          name: r.name,
          category: r.category,
          city: r.city,
          description: r.description,
          price_hint: r.priceHint,
          tags: r.tags?.split(",").map((t) => t.trim()) ?? [],
          zalo_link: r.deeplink ?? `https://zalo.me/${r.oaId}`
        })),
        next_step:
          "Hỏi user chọn chỗ nào, rồi gọi draft_oa_inquiry để soạn sẵn câu hỏi gửi cho OA đó."
      };
    }
  },

  {
    name: "draft_oa_inquiry",
    description:
      "Soạn sẵn tin nhắn hỏi một OA đối tác (hỏi giá, đặt phòng, đặt bàn) và tạo link mở chat. " +
      "Zino soạn hộ — user chỉ việc đọc lại và bấm Gửi. " +
      "Gọi sau khi user đã chọn một OA từ kết quả search_partner_oa. " +
      "Viết tin nhắn ĐẦY ĐỦ: ngày, số người, nhu cầu cụ thể, ngân sách, và các câu hỏi rõ ràng.",
    input_schema: schema(
      {
        oa_id: S.str("OA id lấy từ kết quả search_partner_oa"),
        message: S.str(
          "Nội dung tin nhắn hoàn chỉnh gửi cho OA. Lịch sự, đầy đủ thông tin, " +
            "đánh số các câu hỏi. Đây là tin user sẽ gửi đi nên viết ở ngôi của user."
        )
      },
      ["oa_id", "message"]
    ),
    handler: async (input, ctx) => {
      const oa = await ctx.db.query.partnerOas.findFirst({
        where: eq(partnerOas.oaId, input.oa_id)
      });

      const message = String(input.message).slice(0, 1500);
      const encoded = encodeURIComponent(message);

      if (ctx.tripId) {
        await ctx.db.insert(activities).values({
          tripId: ctx.tripId,
          kind: "booking",
          content: `Soạn tin hỏi ${oa?.name ?? input.oa_id}`
        });
      }

      return {
        ok: true,
        oa_name: oa?.name ?? "Đối tác",
        message,
        /** Mini App gọi zmp-sdk openChat với 3 tham số này */
        openchat_params: { type: "oa", id: input.oa_id, message },
        /** Màn Concierge Handoff trong Mini App */
        handoff_url: `${ctx.publicBaseUrl}/miniapp/#/handoff?oa=${input.oa_id}&msg=${encoded}`,
        /** Fallback khi không mở được Mini App: user mở trang OA rồi dán tin */
        fallback_deeplink: oa?.deeplink ?? `https://zalo.me/${input.oa_id}`,
        instruction_for_user:
          "Gửi cho user cả đoạn tin đã soạn (để họ đọc/sửa) VÀ link mở chat. " +
          "Nói rõ: bạn chỉ cần bấm Gửi, mình không tự gửi thay bạn."
      };
    }
  }
];

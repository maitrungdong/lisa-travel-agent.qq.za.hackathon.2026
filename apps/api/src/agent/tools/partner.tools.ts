import { and, eq, ilike, or, sql } from "drizzle-orm";
import { framed } from "../../common/image-frame";
import { activities, partnerOas } from "../../db/schema";
import { S, schema, type ToolDef } from "./types";

/** Tắt thẻ ảnh khẩn cấp: ZINO_OPTION_CARDS=0 → present_option rơi về thẻ text */
function cardsEnabled(): boolean {
  return process.env.ZINO_OPTION_CARDS !== "0";
}

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
      "⚠ LUÔN GỌI TOOL NÀY TRƯỚC khi web_search mỗi khi user cần chỗ ở, chỗ ăn, tour, phương tiện — " +
      "đối tác trong hệ sinh thái Zalo được ưu tiên giới thiệu trước. " +
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

      // "Toàn quốc" = hãng bay, nhà xe, nền tảng vé — phục vụ mọi thành phố.
      // Lọc cứng theo city sẽ loại oan Vietjet/Vexere khi user hỏi "xe đi Nha Trang".
      if (input.city) {
        filters.push(
          or(ilike(partnerOas.city, `%${input.city}%`), eq(partnerOas.city, "Toàn quốc"))!
        );
      }
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
          zalo_link: r.deeplink ?? `https://zalo.me/${r.oaId}`,
          image_url: r.avatarUrl
        })),
        next_step:
          "Chọn 2-3 OA hợp nhất. Nếu cần giá/đánh giá mới thì web_search về ĐÚNG những nơi này " +
          "(không tìm chỗ khác ngoài danh sách khi danh sách đã đủ). " +
          "Rồi gọi present_option cho TỪNG nơi — mỗi nơi một thẻ, truyền image_url và zalo_link nhận được ở đây. " +
          "Cuối cùng nhắn một tin chốt: mình nghiêng phương án nào, vì sao, mời nhóm nhắn số để chọn."
      };
    }
  },

  {
    name: "present_option",
    /**
     * Thẻ phương án — khuôn Template 1A/1B, docs/ZALO-MESSAGE-TEMPLATES.md.
     *
     * VÌ SAO BACKEND DỰNG CAPTION thay vì để model tự viết: model mỗi lần một
     * kiểu — lúc có nguồn lúc không, lúc 5 gạch đầu dòng lúc 1. Khuôn cứng ở
     * đây là thứ giữ cho ba thẻ liền nhau nhìn như MỘT bộ. Model chỉ cung cấp
     * dữ kiện, không cung cấp bố cục.
     */
    description:
      "Gửi MỘT thẻ giới thiệu phương án (khách sạn/quán/tour/xe) vào nhóm — có ảnh, giá, " +
      "điểm nổi bật và link Zalo OA. Gọi một lần cho MỖI phương án, tối đa 3 thẻ một lượt. " +
      "Dữ liệu lấy từ search_partner_oa (image_url, zalo_link) + web_search (giá, đánh giá). " +
      "Thẻ được gửi TỰ ĐỘNG sau câu trả lời của bạn — đừng lặp lại nội dung thẻ trong lời nói, " +
      "chỉ cần một tin chốt ngắn: nghiêng phương án nào, mời nhóm nhắn số.",
    input_schema: schema(
      {
        name: S.str('Tên nơi chốn, vd "Sheraton Nha Trang Hotel & Spa"'),
        price_line: S.str('Dòng giá + tình trạng, vd "2.850.000đ/đêm · 28–30/07 còn phòng"'),
        bullets: S.arr(
          { type: "string" },
          "1-3 điểm nổi bật, mỗi cái một câu ngắn. Quá 3 sẽ bị cắt."
        ),
        zalo_link: S.str("Link OA từ search_partner_oa, vd https://zalo.me/123..."),
        image_url: S.str("image_url từ search_partner_oa, hoặc URL ảnh https khác. Bỏ trống = thẻ chữ."),
        source: S.str('Nguồn thông tin giá, vd "Booking.com · 29/07". Bỏ trống nếu chỉ từ danh bạ đối tác.'),
        emoji: S.str("Emoji mở đầu theo loại: 🏨 chỗ ở, 🍜 quán ăn, 🚌 xe, ✈️ bay, 🏄 hoạt động. Mặc định 📍")
      },
      ["name", "price_line", "bullets"]
    ),
    handler: async (input, ctx) => {
      const name = String(input.name ?? "").trim();
      const price = String(input.price_line ?? "").trim();
      if (!name || !price) return { ok: false, error: "Thiếu name hoặc price_line" };

      const emoji = String(input.emoji ?? "📍").trim() || "📍";
      const bullets = ((input.bullets ?? []) as string[])
        .map((b) => String(b).trim())
        .filter(Boolean)
        .slice(0, 3);
      const link = String(input.zalo_link ?? "").trim();
      const source = String(input.source ?? "").trim();
      const img = String(input.image_url ?? "").trim();

      // Khuôn 1A: caption dưới ảnh (Zalo cắt ở 1000 ký tự nên khuôn phải gọn)
      const lines = [
        `${emoji} ${name}`,
        price,
        "",
        ...bullets.map((b) => `• ${b}`)
      ];
      if (link) lines.push("", `💬 Nhắn OA: ${link.replace(/^https?:\/\//, "")}`);
      if (source) lines.push("", `Nguồn: ${source}`);
      const caption = lines.join("\n").slice(0, 1000);

      if (img && /^https?:\/\//i.test(img) && cardsEnabled()) {
        // Ép khung 16:9 để mọi thẻ trong loạt cùng tỷ lệ — xem common/image-frame.ts
        ctx.pushCard(framed(img, "card"), caption);
      } else {
        // Khuôn 1B: thẻ chữ có khung kẻ, bù độ "nổi" khi không có ảnh
        const bar = "━".repeat(18);
        ctx.pushFollowUp([bar, `${emoji} ${name.toUpperCase()}`, bar, caption.split("\n").slice(1).join("\n")].join("\n"));
      }

      return {
        ok: true,
        queued: true,
        card: img ? "photo" : "text",
        message:
          "Thẻ sẽ tự gửi sau lời bạn nói. KHÔNG kể lại nội dung thẻ — chỉ chốt ngắn gọn " +
          "mình nghiêng cái nào và mời nhóm nhắn số."
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

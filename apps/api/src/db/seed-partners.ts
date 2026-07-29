import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { partnerOas } from "./schema";

/**
 * Seed danh bạ OA đối tác.
 *
 * ⚠ VÌ SAO PHẢI TỰ SEED: Zalo không có API tìm kiếm Official Account.
 * Không có endpoint nào tra OA theo tên/ngành/địa điểm — `oa/getoa` chỉ trả về
 * OA của chính app mình. Nên "discovery" hợp lệ duy nhất là directory tự dựng.
 *
 * ⚠ Phần lớn oa_id dưới đây là DỮ LIỆU MẪU. Chỉ `themalibuhotel` là OA THẬT
 * (đã xác thực) → dùng đúng nó cho khoảnh khắc openChat trên sân khấu.
 * Bấm "Mở chat" với oa_id giả sẽ báo không tìm thấy OA.
 *
 * Lấy oa_id thật: mở OA trên Zalo → ⋯ → Chia sẻ → Sao chép liên kết
 * → phần sau `zalo.me/` chính là oa_id (số hoặc alias, cả hai đều dùng được).
 *
 * Chạy: pnpm --filter api exec tsx src/db/seed-partners.ts
 */
const PARTNERS = [
  // ── Nha Trang ────────────────────────────────────────────────────────
  // Thêm vì tab "Hỏi Zino" có tool `search_stays` tra đúng bảng này theo điểm
  // đến của chuyến, mà chuyến Nha Trang đang chạy thật thì danh bạ lại rỗng —
  // hỏi chỗ ở là Zino trả về "chưa có đối tác ở đó".
  // ⚠ oa_id ở đây là MẪU. Bấm "Mở chat" sẽ báo không tìm thấy OA.
  {
    oaId: "demo-oa-hostel-nhatrang",
    name: "Nhà nghỉ dorm gần Bãi Sau",
    category: "HOTEL",
    city: "Nha Trang",
    description: "Dorm 6-8 giường và phòng tập thể, khu Trần Phú, đi bộ ra biển 3 phút",
    priceHint: "150k–250k/giường/đêm",
    tags: "giá rẻ,gần biển,cho nhóm đông,ba lô"
  },
  {
    oaId: "demo-oa-homestay-nhatrang",
    name: "Homestay nguyên căn Vĩnh Hải",
    category: "HOTEL",
    city: "Nha Trang",
    description: "Nhà nguyên căn 3 phòng ngủ, có bếp và phòng khách chung, cách biển 10 phút đi bộ",
    priceHint: "1,2tr–1,8tr/đêm cả căn",
    tags: "nguyên căn,có bếp,cho nhóm đông,tụ tập"
  },
  {
    oaId: "demo-oa-hotel-trancphu-nhatrang",
    name: "Khách sạn 3 sao Trần Phú",
    category: "HOTEL",
    city: "Nha Trang",
    description: "Phòng đôi và phòng gia đình view biển, có ăn sáng, lễ tân 24/7",
    priceHint: "700k–1,1tr/phòng/đêm",
    tags: "view biển,có ăn sáng,3 sao,cho gia đình"
  },
  {
    oaId: "demo-oa-resort-baidai-nhatrang",
    name: "Resort Bãi Dài",
    category: "HOTEL",
    city: "Nha Trang",
    description: "Resort ven biển Bãi Dài, hồ bơi vô cực, xa trung tâm 25km — hợp nghỉ dưỡng",
    priceHint: "2,5tr–4tr/phòng/đêm",
    tags: "resort,hồ bơi,nghỉ dưỡng,yên tĩnh"
  },

  // ── Vũng Tàu — THÀNH PHỐ DEMO CHÍNH ──────────────────────────────────
  // Malibu là OA THẬT, đã xác thực → dùng cho khoảnh khắc openChat trên sân khấu.
  // Mấy dòng còn lại vẫn là mẫu; thay dần bằng OA thật khi tìm được.
  {
    oaId: "themalibuhotel", // ✅ THẬT — https://zalo.me/themalibuhotel
    name: "Khách sạn Malibu Vũng Tàu",
    category: "HOTEL",
    city: "Vũng Tàu",
    description:
      "Khách sạn 5 sao kiến trúc châu Âu, gần 200 phòng, hồ bơi - spa - pool bar tầng 5&6",
    priceHint: "liên hệ để có giá tốt",
    tags: "gần biển,hồ bơi,spa,5 sao,cho gia đình,cho doanh nhân"
  },
  {
    oaId: "demo-oa-ganhhao-vungtau",
    name: "Hải sản Gành Hào",
    category: "FNB",
    city: "Vũng Tàu",
    description: "Nhà hàng hải sản view biển Bãi Sau, phục vụ nhóm đông",
    priceHint: "250k–500k/người",
    tags: "hải sản,view biển,nhóm đông"
  },
  {
    oaId: "demo-oa-banhkhot-vungtau",
    name: "Bánh khọt Gốc Vú Sữa",
    category: "FNB",
    city: "Vũng Tàu",
    description: "Bánh khọt đặc sản Vũng Tàu, quán lâu năm",
    priceHint: "60k–120k/người",
    tags: "đặc sản,ăn sáng,giá rẻ"
  },
  {
    oaId: "demo-oa-canho-vungtau",
    name: "Ca nô ra Côn Đảo",
    category: "TOUR",
    city: "Vũng Tàu",
    description: "Tàu cao tốc Vũng Tàu – Côn Đảo, đặt vé theo nhóm",
    priceHint: "660k–990k/người/lượt",
    tags: "biển,đảo,cao tốc"
  },
  {
    oaId: "demo-oa-xemay-vungtau",
    name: "Thuê xe máy Vũng Tàu",
    category: "TRANSPORT",
    city: "Vũng Tàu",
    description: "Giao xe tận khách sạn, xe số và tay ga",
    priceHint: "120k–180k/ngày",
    tags: "xe máy,giao tận nơi,theo ngày"
  },
  {
    oaId: "demo-oa-hodo-vungtau",
    name: "Tour Hồ Tràm – Bình Châu",
    category: "TOUR",
    city: "Vũng Tàu",
    description: "Tour trong ngày suối nước nóng Bình Châu, có xe đưa đón",
    priceHint: "550k–750k/người",
    tags: "suối nước nóng,trong ngày,có xe đón"
  },

  // ── Đà Nẵng ──────────────────────────────────────────────────────────
  {
    oaId: "demo-oa-sunrise-danang",
    name: "Sunrise Resort Đà Nẵng",
    category: "HOTEL",
    city: "Đà Nẵng",
    description: "Resort 4 sao mặt biển Mỹ Khê, hồ bơi vô cực, buffet sáng",
    priceHint: "1.8tr–3.2tr/đêm",
    tags: "gần biển,hồ bơi,buffet sáng,cho gia đình"
  },
  {
    oaId: "demo-oa-mangarden-danang",
    name: "Man Garden Homestay",
    category: "HOTEL",
    city: "Đà Nẵng",
    description: "Homestay sân vườn gần cầu Rồng, phòng dorm và phòng đôi",
    priceHint: "350k–900k/đêm",
    tags: "giá rẻ,trung tâm,cho nhóm bạn,homestay"
  },
  {
    oaId: "demo-oa-bemannhahang",
    name: "Hải sản Bé Mặn",
    category: "FNB",
    city: "Đà Nẵng",
    description: "Quán hải sản bình dân nổi tiếng, phục vụ nhóm đông",
    priceHint: "200k–400k/người",
    tags: "hải sản,nhóm đông,bình dân"
  },
  {
    oaId: "demo-oa-banxeodung",
    name: "Bánh xèo Bà Dưỡng",
    category: "FNB",
    city: "Đà Nẵng",
    description: "Bánh xèo, nem lụi đặc sản Đà Nẵng",
    priceHint: "60k–120k/người",
    tags: "đặc sản,ăn vặt,giá rẻ"
  },
  {
    oaId: "demo-oa-batrangtour",
    name: "Bà Nà Hills Tour",
    category: "TOUR",
    city: "Đà Nẵng",
    description: "Tour Bà Nà Hills, Cầu Vàng — vé cáp treo + xe đưa đón",
    priceHint: "850k–1.1tr/người",
    tags: "cầu vàng,cáp treo,có xe đón"
  },
  {
    oaId: "demo-oa-culaochamtour",
    name: "Cù Lao Chàm Speedboat",
    category: "TOUR",
    city: "Đà Nẵng",
    description: "Tour lặn ngắm san hô Cù Lao Chàm trong ngày",
    priceHint: "550k–750k/người",
    tags: "biển,lặn biển,trong ngày"
  },
  {
    oaId: "demo-oa-xanhsm-danang",
    name: "Thuê xe máy Đà Nẵng 24h",
    category: "TRANSPORT",
    city: "Đà Nẵng",
    description: "Thuê xe máy giao tận nơi, xe số và tay ga",
    priceHint: "120k–200k/ngày",
    tags: "xe máy,giao tận nơi,theo ngày"
  },
  {
    oaId: "demo-oa-carrental-danang",
    name: "Thuê xe 7-16 chỗ Đà Nẵng",
    category: "TRANSPORT",
    city: "Đà Nẵng",
    description: "Xe có tài xế, đưa đón sân bay và tour trong ngày",
    priceHint: "900k–2.5tr/ngày",
    tags: "xe 7 chỗ,có tài xế,đón sân bay,nhóm đông"
  },

  // ── Hội An ───────────────────────────────────────────────────────────
  {
    oaId: "demo-oa-anantara-hoian",
    name: "Riverside Boutique Hội An",
    category: "HOTEL",
    city: "Hội An",
    description: "Khách sạn ven sông Thu Bồn, đi bộ 5 phút tới phố cổ",
    priceHint: "1.2tr–2.4tr/đêm",
    tags: "phố cổ,ven sông,lãng mạn"
  },
  {
    oaId: "demo-oa-comgahoian",
    name: "Cơm gà Bà Buội",
    category: "FNB",
    city: "Hội An",
    description: "Cơm gà Hội An gia truyền trong phố cổ",
    priceHint: "50k–90k/người",
    tags: "đặc sản,phố cổ,giá rẻ"
  },
  {
    oaId: "demo-oa-thuyenhoian",
    name: "Thả đèn hoa đăng Hội An",
    category: "ACTIVITY",
    city: "Hội An",
    description: "Thuyền đêm sông Hoài, thả hoa đăng cầu may",
    priceHint: "150k–250k/thuyền",
    tags: "buổi tối,lãng mạn,check-in"
  },

  // ── Đà Lạt ───────────────────────────────────────────────────────────
  {
    oaId: "demo-oa-pinehill-dalat",
    name: "Pine Hill Villa Đà Lạt",
    category: "HOTEL",
    city: "Đà Lạt",
    description: "Villa nguyên căn view đồi thông, bếp riêng, BBQ",
    priceHint: "2tr–4tr/đêm nguyên căn",
    tags: "villa,nhóm đông,bbq,view đồi"
  },
  {
    oaId: "demo-oa-lauga-dalat",
    name: "Lẩu gà lá é Tao Ngộ",
    category: "FNB",
    city: "Đà Lạt",
    description: "Lẩu gà lá é đặc sản Đà Lạt, quán đông buổi tối",
    priceHint: "150k–250k/người",
    tags: "đặc sản,ấm,nhóm đông"
  },
  {
    oaId: "demo-oa-sanmaydalat",
    name: "Tour săn mây Cầu Đất",
    category: "TOUR",
    city: "Đà Lạt",
    description: "Đón 4h sáng săn mây đồi chè Cầu Đất, kèm ảnh",
    priceHint: "300k–450k/người",
    tags: "săn mây,dậy sớm,chụp ảnh"
  },

  // ── Phú Quốc ─────────────────────────────────────────────────────────
  {
    oaId: "demo-oa-seashell-phuquoc",
    name: "Seashell Beach Phú Quốc",
    category: "HOTEL",
    city: "Phú Quốc",
    description: "Khách sạn bãi Trường, hồ bơi hướng biển, gần chợ đêm",
    priceHint: "1.5tr–3tr/đêm",
    tags: "gần biển,hồ bơi,chợ đêm"
  },
  {
    oaId: "demo-oa-4daophuquoc",
    name: "Tour 4 đảo Phú Quốc",
    category: "TOUR",
    city: "Phú Quốc",
    description: "Cano 4 đảo, lặn ngắm san hô, câu cá, ăn trưa trên đảo",
    priceHint: "500k–800k/người",
    tags: "biển,lặn biển,cano,ăn trưa"
  },

  // ── Hà Nội / Sapa ────────────────────────────────────────────────────
  {
    oaId: "demo-oa-oldquarter-hanoi",
    name: "Old Quarter Hotel Hà Nội",
    category: "HOTEL",
    city: "Hà Nội",
    description: "Khách sạn phố cổ Hà Nội, gần hồ Hoàn Kiếm",
    priceHint: "700k–1.5tr/đêm",
    tags: "phố cổ,trung tâm,đi bộ"
  },
  {
    oaId: "demo-oa-buncha-hanoi",
    name: "Bún chả Hương Liên",
    category: "FNB",
    city: "Hà Nội",
    description: "Bún chả nổi tiếng, quán Obama từng ghé",
    priceHint: "60k–100k/người",
    tags: "đặc sản,nổi tiếng,giá rẻ"
  },
  {
    oaId: "demo-oa-sapatrek",
    name: "Sapa Trekking Bản Cát Cát",
    category: "TOUR",
    city: "Sapa",
    description: "Trek bản làng 1 ngày cùng hướng dẫn viên người H'Mông",
    priceHint: "400k–650k/người",
    tags: "trekking,văn hoá,trong ngày"
  },
  {
    oaId: "demo-oa-limousine-sapa",
    name: "Limousine Hà Nội – Sapa",
    category: "TRANSPORT",
    city: "Hà Nội",
    description: "Xe limousine 9 chỗ đón tận nơi, đi Sapa 5h",
    priceHint: "350k–500k/người",
    tags: "limousine,đón tận nơi,đường dài"
  }
] as const;

async function main(): Promise<void> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? "postgres://zino:zino@localhost:5432/zino"
  });
  const db = drizzle(pool);

  let inserted = 0;
  for (const p of PARTNERS) {
    const res = await db
      .insert(partnerOas)
      .values({ ...p, deeplink: `https://zalo.me/${p.oaId}` })
      .onConflictDoNothing({ target: partnerOas.oaId })
      .returning({ id: partnerOas.id });
    if (res.length) inserted++;
  }

  console.log(`✅ Seed xong: ${inserted} mới / ${PARTNERS.length} tổng`);
  console.log(
    "⚠️  Nhớ thay oa_id demo bằng oa_id THẬT trước khi demo — " +
      "lấy từ URL zalo.me/<oa_id> của OA công khai hoặc OA test của team."
  );
  await pool.end();
}

void main();

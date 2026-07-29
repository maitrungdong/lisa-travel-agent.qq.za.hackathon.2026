/**
 * Chuẩn hoá khung ảnh cho thẻ Zalo — qua image proxy, KHÔNG cần thư viện native.
 *
 * VÌ SAO CẦN: Zalo `sendPhoto` chỉ nhận URL và hiển thị đúng tỷ lệ ảnh gốc.
 * Ảnh OA lấy từ web thì mỗi cái một khung — cái ngang, cái dọc, cái vuông —
 * ba thẻ khách sạn cạnh nhau nhìn như chợ. Ép về CÙNG một khung là thứ làm
 * loạt thẻ trông "có thiết kế", quan trọng hơn cả độ phân giải.
 *
 * VÌ SAO wsrv.nl mà không phải sharp: sharp là native binary — thêm nó là đổi
 * Docker build trên VPS ngay trước hạn nộp. wsrv.nl (images.weserv.nl) chạy
 * trên Cloudflare, resize qua query param, có cache CDN, không cài gì.
 * Đánh đổi: phụ thuộc dịch vụ ngoài lúc demo. Chấp nhận được vì có đường lui —
 * mọi hàm ở đây hỏng thì caller cứ dùng URL gốc, thẻ xấu đi chứ không vỡ.
 *
 * Sau Demo Day muốn tự chủ: thay ruột `framed()` bằng endpoint sharp nội bộ,
 * chữ ký hàm giữ nguyên.
 */

const PROXY = (process.env.ZINO_IMAGE_PROXY ?? "https://wsrv.nl").replace(/\/+$/, "");

/** Ba khung dùng trong template — xem docs/ZALO-MESSAGE-TEMPLATES.md */
export const FRAMES = {
  /** Thẻ phương án (Template 1A): 16:9 nằm ngang, khung "feed" quen mắt */
  card: { w: 1200, h: 675 },
  /** Ảnh đại diện OA / thumbnail trong list */
  thumb: { w: 400, h: 400 },
  /** Gallery dọc kiểu poster (lịch trình ngày, món ăn) */
  tall: { w: 1080, h: 1350 }
} as const;

export type FrameKind = keyof typeof FRAMES;

/**
 * URL ảnh đã ép khung. `fit=cover` cắt giữa cho đầy khung — không méo, không
 * viền đen. `output=jpg` vì Zalo đôi khi từ chối webp.
 */
export function framed(src: string, kind: FrameKind = "card"): string {
  if (!src || !/^https?:\/\//i.test(src)) return src;
  // Ảnh đã đi qua proxy rồi thì thôi — bọc hai lần chỉ thêm một tầng hỏng
  if (src.startsWith(PROXY)) return src;
  const { w, h } = FRAMES[kind];
  const q = new URLSearchParams({
    url: src,
    w: String(w),
    h: String(h),
    fit: "cover",
    output: "jpg",
    q: "82"
  });
  return `${PROXY}/?${q}`;
}

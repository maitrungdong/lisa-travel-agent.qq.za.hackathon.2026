/**
 * Đọc mã QR thanh toán (VietQR / EMVCo) thành dữ liệu điền sẵn vào form chi phí.
 *
 * Vì sao tự parse thay vì gọi dịch vụ: chuỗi QR đã nằm sẵn trong tay sau khi
 * `scanQRCode` trả về, và định dạng EMVCo là TLV đơn giản (tag 2 ký tự · độ dài
 * 2 ký tự · giá trị). Gửi nó lên server để bóc tách chỉ thêm một vòng mạng và
 * một điểm hỏng, trong khi mã QR thanh toán chứa thông tin tài khoản của người
 * dùng — càng ít nơi đi qua càng tốt.
 *
 * Hàm thuần, có test: đây là chỗ sai một ký tự là số tiền lệch 10 lần.
 */

export interface QrPayment {
  /** Số tiền (VND). null = QR không ghi sẵn số tiền, người dùng tự nhập. */
  amount: number | null;
  /** Nội dung chuyển khoản / mô tả — dùng làm tên khoản chi */
  description: string | null;
  /** Tên người/đơn vị nhận */
  merchantName: string | null;
  merchantCity: string | null;
  /** Mã ngân hàng (BIN) và số tài khoản, nếu đọc được */
  bankBin: string | null;
  accountNumber: string | null;
  /** false = không phải QR thanh toán (link, wifi, text thường…) */
  isPayment: boolean;
  /** Chuỗi gốc, giữ lại để ghi vào ghi chú khi cần đối chiếu */
  raw: string;
}

interface Tlv {
  tag: string;
  value: string;
}

/**
 * Bóc chuỗi EMVCo thành danh sách TLV.
 * Gặp dữ liệu hỏng thì DỪNG và trả về phần đã đọc được, không ném lỗi — một mã
 * QR bẩn không được phép làm sập màn hình đang mở camera.
 */
export function parseTlv(s: string): Tlv[] {
  const out: Tlv[] = [];
  let i = 0;
  while (i + 4 <= s.length) {
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(len)) break;
    const value = s.slice(i + 4, i + 4 + len);
    if (value.length < len) break; // độ dài khai lớn hơn dữ liệu thật
    out.push({ tag, value });
    i += 4 + len;
  }
  return out;
}

const find = (list: Tlv[], tag: string): string | null =>
  list.find((t) => t.tag === tag)?.value ?? null;

/** CRC16/CCITT-FALSE — EMVCo dùng đúng biến thể này cho tag 63. */
export function crc16(s: string): string {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Chuỗi có đúng là QR thanh toán và chưa bị sửa không. */
export function verifyChecksum(raw: string): boolean {
  const idx = raw.lastIndexOf("6304");
  if (idx < 0 || raw.length < idx + 8) return false;
  return crc16(raw.slice(0, idx + 4)) === raw.slice(idx + 4, idx + 8).toUpperCase();
}

export function parsePaymentQr(raw: string): QrPayment {
  const empty: QrPayment = {
    amount: null,
    description: null,
    merchantName: null,
    merchantCity: null,
    bankBin: null,
    accountNumber: null,
    isPayment: false,
    raw
  };

  const s = raw.trim();
  // QR thanh toán luôn mở đầu bằng payload format indicator "000201".
  // Không có thì đây là link/wifi/text — trả về sớm thay vì đoán mò.
  if (!s.startsWith("00")) return empty;

  const top = parseTlv(s);
  if (top.length === 0) return empty;

  const amountRaw = find(top, "54");
  const amount = amountRaw ? Math.round(Number(amountRaw)) : null;

  // Tag 62 chứa dữ liệu bổ sung; 08 trong đó là nội dung chuyển khoản.
  const additional = find(top, "62");
  const description = additional ? find(parseTlv(additional), "08") : null;

  // Tài khoản nằm trong 38 (VietQR) hoặc 26-27 (một số ví). Bên trong 38:
  //   00 = "A000000727" (mã tổ chức), 01 = { 00 = BIN, 01 = số tài khoản }
  let bankBin: string | null = null;
  let accountNumber: string | null = null;
  for (const tag of ["38", "26", "27"]) {
    const merchant = find(top, tag);
    if (!merchant) continue;
    const inner = parseTlv(merchant);
    const acc = find(inner, "01");
    if (acc) {
      const accInner = parseTlv(acc);
      bankBin = find(accInner, "00");
      accountNumber = find(accInner, "01");
      if (accountNumber) break;
    }
  }

  return {
    amount: amount != null && Number.isFinite(amount) && amount > 0 ? amount : null,
    description: description?.trim() || null,
    merchantName: find(top, "59")?.trim() || null,
    merchantCity: find(top, "60")?.trim() || null,
    bankBin,
    accountNumber,
    isPayment: true,
    raw: s
  };
}

/**
 * Gợi ý tên khoản chi từ mã QR.
 *
 * Thứ tự ưu tiên có chủ ý: nội dung chuyển khoản > tên đơn vị nhận. Người ta gõ
 * "Com trua 3 nguoi" vào nội dung, còn tên đơn vị thường là "CTY TNHH ..." —
 * cái đầu mô tả khoản chi, cái sau mô tả pháp nhân.
 */
export function suggestTitle(qr: QrPayment): string {
  return qr.description || qr.merchantName || "Thanh toán QR";
}

import { describe, expect, it } from "vitest";
import { crc16, parsePaymentQr, parseTlv, suggestTitle, verifyChecksum } from "./qr";

/** Dựng chuỗi TLV cho gọn: tlv("54", "150000") → "5406150000" */
const tlv = (tag: string, value: string) =>
  `${tag}${String(value.length).padStart(2, "0")}${value}`;

/** VietQR tối giản: có tài khoản, số tiền, nội dung, tên đơn vị. */
function buildVietQr(opts: { amount?: string; desc?: string; name?: string } = {}) {
  const account = tlv("00", "A000000727") + tlv("01", tlv("00", "970415") + tlv("01", "113366668888"));
  let body =
    tlv("00", "01") +
    tlv("01", "12") +
    tlv("38", account) +
    tlv("53", "704") +
    (opts.amount ? tlv("54", opts.amount) : "") +
    tlv("58", "VN") +
    (opts.name ? tlv("59", opts.name) : "") +
    tlv("60", "HANOI") +
    (opts.desc ? tlv("62", tlv("08", opts.desc)) : "");
  body += "6304";
  return body + crc16(body);
}

describe("parseTlv", () => {
  it("bóc đúng tag và giá trị", () => {
    expect(parseTlv(tlv("54", "150000"))).toEqual([{ tag: "54", value: "150000" }]);
  });

  it("đọc nhiều trường liên tiếp", () => {
    const r = parseTlv(tlv("00", "01") + tlv("53", "704"));
    expect(r.map((x) => x.tag)).toEqual(["00", "53"]);
  });

  it("dữ liệu cụt thì dừng, KHÔNG ném lỗi", () => {
    expect(() => parseTlv("5410123")).not.toThrow();
    expect(parseTlv("5410123")).toEqual([]);
  });

  it("chuỗi rác trả về rỗng thay vì đoán", () => {
    expect(parseTlv("hello world")).toEqual([]);
  });
});

describe("crc16 / verifyChecksum", () => {
  it("checksum của QR tự dựng phải hợp lệ", () => {
    expect(verifyChecksum(buildVietQr({ amount: "150000" }))).toBe(true);
  });

  it("sửa một ký tự là checksum sai ngay", () => {
    const q = buildVietQr({ amount: "150000" });
    const tampered = q.replace("150000", "1500000");
    expect(verifyChecksum(tampered)).toBe(false);
  });

  it("chuỗi không phải QR thanh toán → false, không ném lỗi", () => {
    expect(verifyChecksum("https://example.com")).toBe(false);
  });
});

describe("parsePaymentQr", () => {
  it("đọc được số tiền, nội dung, tên và số tài khoản", () => {
    const r = parsePaymentQr(
      buildVietQr({ amount: "150000", desc: "Com trua 3 nguoi", name: "QUAN AN NGON" })
    );
    expect(r.isPayment).toBe(true);
    expect(r.amount).toBe(150_000);
    expect(r.description).toBe("Com trua 3 nguoi");
    expect(r.merchantName).toBe("QUAN AN NGON");
    expect(r.bankBin).toBe("970415");
    expect(r.accountNumber).toBe("113366668888");
  });

  it("QR không ghi sẵn số tiền → amount null để người dùng tự nhập", () => {
    const r = parsePaymentQr(buildVietQr({ desc: "Chuyen khoan" }));
    expect(r.amount).toBeNull();
    expect(r.isPayment).toBe(true);
  });

  it("số tiền 0 hoặc âm coi như không có", () => {
    expect(parsePaymentQr(buildVietQr({ amount: "0" })).amount).toBeNull();
  });

  it("link thường không bị nhận nhầm là QR thanh toán", () => {
    const r = parsePaymentQr("https://zalo.me/s/123/");
    expect(r.isPayment).toBe(false);
    expect(r.amount).toBeNull();
  });

  it("giữ lại chuỗi gốc để đối chiếu", () => {
    const q = buildVietQr({ amount: "1000" });
    expect(parsePaymentQr(q).raw).toBe(q);
  });

  it("chuỗi rỗng không làm sập", () => {
    expect(() => parsePaymentQr("")).not.toThrow();
    expect(parsePaymentQr("").isPayment).toBe(false);
  });
});

describe("suggestTitle", () => {
  it("ưu tiên nội dung chuyển khoản hơn tên pháp nhân", () => {
    const r = parsePaymentQr(
      buildVietQr({ desc: "Com trua 3 nguoi", name: "CTY TNHH ABC" })
    );
    expect(suggestTitle(r)).toBe("Com trua 3 nguoi");
  });

  it("không có nội dung thì lấy tên đơn vị", () => {
    expect(suggestTitle(parsePaymentQr(buildVietQr({ name: "QUAN AN NGON" })))).toBe("QUAN AN NGON");
  });

  it("không có gì thì vẫn ra tên dùng được", () => {
    expect(suggestTitle(parsePaymentQr(buildVietQr({})))).toBe("Thanh toán QR");
  });
});

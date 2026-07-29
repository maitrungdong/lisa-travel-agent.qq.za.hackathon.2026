import { describe, expect, it } from "vitest";
import { messageFromBody } from "./api-error";

const PATH = "/decisions/2/decide";

describe("messageFromBody", () => {
  /**
   * Đây là lỗi đã gặp thật: bấm "Chốt phương án" trên Mini App ra 400, nhưng
   * người dùng chỉ thấy "API 400: /decisions/2/decide" nên không biết phải làm
   * gì. Server nói rất rõ lý do — phải để câu đó đi tới màn hình.
   */
  it("giữ nguyên câu server giải thích", () => {
    expect(messageFromBody(400, { statusCode: 400, message: "Bạn không thuộc chuyến đi này" }, PATH)).toBe(
      "Bạn không thuộc chuyến đi này"
    );
    expect(
      messageFromBody(400, { statusCode: 400, message: "Chỉ người tổ chức mới chốt được" }, PATH)
    ).toBe("Chỉ người tổ chức mới chốt được");
  });

  it("body zod: lấy issue đầu tiên kèm tên trường", () => {
    const body = {
      statusCode: 400,
      message: [{ code: "too_small", message: "String must contain at least 1 character(s)", path: ["zaloUserId"] }]
    };
    expect(messageFromBody(400, body, PATH)).toBe(
      "Dữ liệu gửi lên không hợp lệ: String must contain at least 1 character(s) (zaloUserId)"
    );
  });

  it("issue không có path thì không thêm ngoặc rỗng", () => {
    const body = { message: [{ message: "Required" }] };
    expect(messageFromBody(400, body, PATH)).toBe("Dữ liệu gửi lên không hợp lệ: Required");
  });

  it("mảng chuỗi (ValidationPipe mặc định) cũng đọc được", () => {
    expect(messageFromBody(400, { message: ["optionId must be a positive number"] }, PATH)).toBe(
      "Dữ liệu gửi lên không hợp lệ: optionId must be a positive number"
    );
  });

  it("body không dùng được thì giữ path để còn lần ra chỗ hỏng", () => {
    expect(messageFromBody(502, null, PATH)).toBe(`Máy chủ từ chối (502) — ${PATH}`);
    expect(messageFromBody(500, {}, PATH)).toBe(`Máy chủ từ chối (500) — ${PATH}`);
    expect(messageFromBody(400, { message: "   " }, PATH)).toBe(`Máy chủ từ chối (400) — ${PATH}`);
    expect(messageFromBody(400, { message: [] }, PATH)).toBe(`Máy chủ từ chối (400) — ${PATH}`);
  });

  it("KHÔNG lộ mã trạng thái vào câu khi server đã nói rõ — người dùng không cần con số", () => {
    expect(messageFromBody(403, { message: "Chỉ người tổ chức mới chốt được" }, PATH)).not.toContain(
      "403"
    );
  });
});

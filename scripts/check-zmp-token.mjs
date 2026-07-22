#!/usr/bin/env node
/**
 * Kiểm tra ZMP_TOKEN (JWT do Zalo cấp) còn hạn hay không.
 *
 * Vì sao cần: zmp-cli chỉ báo "Token Invalid!" khi deploy thất bại — thông báo
 * này rất dễ bị hiểu nhầm thành lỗi mạng/lỗi build. Kiểm tra trước giúp pipeline
 * fail sớm với thông điệp rõ ràng.
 *
 * Exit code:
 *   0 = token còn hạn (có thể kèm warning nếu sắp hết hạn)
 *   1 = token thiếu / sai định dạng / đã hết hạn
 */

const WARN_DAYS = Number(process.env.ZMP_TOKEN_WARN_DAYS ?? 7);
const token = process.env.ZMP_TOKEN;

const fail = (msg) => {
  console.error(`::error title=ZMP token::${msg}`);
  process.exit(1);
};

if (!token) {
  fail("Thiếu secret ZMP_TOKEN. Xem docs/ky-thuat/ci-cd-zalo-mini-app.md mục 'Lấy credential'.");
}

const parts = token.split(".");
if (parts.length !== 3) {
  fail("ZMP_TOKEN không phải JWT hợp lệ (cần 3 phần ngăn cách bởi dấu chấm).");
}

let payload;
try {
  payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
} catch {
  fail("Không decode được payload của ZMP_TOKEN.");
}

if (typeof payload.exp !== "number") {
  console.log("::warning title=ZMP token::Token không có claim `exp`, bỏ qua kiểm tra hạn dùng.");
  process.exit(0);
}

const expiresAt = new Date(payload.exp * 1000);
const msLeft = expiresAt.getTime() - Date.now();
const daysLeft = msLeft / 86_400_000;

if (msLeft <= 0) {
  fail(
    `ZMP_TOKEN đã hết hạn lúc ${expiresAt.toISOString()}. ` +
      "Lấy token mới tại developers.zalo.me > Công cụ > API Explorer > Lấy Access Token, " +
      "rồi cập nhật secret ZMP_TOKEN của environment tương ứng."
  );
}

if (daysLeft < WARN_DAYS) {
  console.log(
    `::warning title=ZMP token sắp hết hạn::Còn ${daysLeft.toFixed(1)} ngày ` +
      `(hết hạn ${expiresAt.toISOString()}). Nên rotate secret sớm.`
  );
}

console.log(`ZMP_TOKEN hợp lệ, còn ${daysLeft.toFixed(1)} ngày (hết hạn ${expiresAt.toISOString()}).`);

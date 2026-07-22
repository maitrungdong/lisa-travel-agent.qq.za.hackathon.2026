#!/usr/bin/env node
/**
 * Gác cổng dung lượng bundle trước khi upload lên Zalo.
 *
 * Zalo Mini App được định vị là "web app gọn nhẹ chạy trong super app" và có
 * giới hạn dung lượng khi deploy. Con số chính xác Zalo có thể thay đổi theo
 * thời điểm — vì vậy script này dùng ngưỡng cấu hình được (MAX_BUNDLE_MB) thay
 * vì hardcode. Mặc định 8MB để còn biên an toàn.
 *
 * Ý nghĩa thực tế: bundle phình lên là lỗi thường gặp nhất khiến deploy fail
 * hoặc app mở chậm trong webview. Chặn ở CI rẻ hơn chặn ở lúc demo.
 */

import { statSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.BUNDLE_DIR;
const maxMb = Number(process.env.MAX_BUNDLE_MB ?? 8);

if (!dir) {
  console.error("::error title=Bundle size::Thiếu biến BUNDLE_DIR.");
  process.exit(1);
}

if (!existsSync(dir)) {
  console.error(`::error title=Bundle size::Không tìm thấy thư mục '${dir}'.`);
  process.exit(1);
}

/** @returns {{total: number, files: Array<{path: string, size: number}>}} */
function walk(target) {
  let total = 0;
  const files = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const full = join(target, entry.name);
    if (entry.isDirectory()) {
      const sub = walk(full);
      total += sub.total;
      files.push(...sub.files);
    } else if (entry.isFile()) {
      const { size } = statSync(full);
      total += size;
      files.push({ path: full, size });
    }
  }
  return { total, files };
}

const { total, files } = walk(dir);
const totalMb = total / 1024 / 1024;

const biggest = files.sort((a, b) => b.size - a.size).slice(0, 10);
console.log(`Tổng dung lượng '${dir}': ${totalMb.toFixed(2)} MB / ngưỡng ${maxMb} MB`);
console.log("10 file lớn nhất:");
for (const f of biggest) {
  console.log(`  ${(f.size / 1024).toFixed(0).padStart(8)} KB  ${f.path}`);
}

// Ghi vào job summary để reviewer thấy ngay trên PR/run.
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  const rows = biggest.map((f) => `| \`${f.path}\` | ${(f.size / 1024).toFixed(0)} KB |`).join("\n");
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `\n### Bundle size\n\n**${totalMb.toFixed(2)} MB** / ngưỡng ${maxMb} MB\n\n| File | Size |\n| --- | --- |\n${rows}\n`
  );
}

if (totalMb > maxMb) {
  console.error(
    `::error title=Bundle quá lớn::${totalMb.toFixed(2)} MB vượt ngưỡng ${maxMb} MB. ` +
      "Cân nhắc code-splitting, lazy-load ảnh, hoặc đưa asset lên CDN ngoài."
  );
  process.exit(1);
}

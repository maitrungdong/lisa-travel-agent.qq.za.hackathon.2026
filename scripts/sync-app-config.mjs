#!/usr/bin/env node
/**
 * Đồng bộ app-config.json theo asset THỰC TẾ trong thư mục build.
 *
 * Vì sao cần: `zmp deploy --existing` không đọc index.html — nó nạp asset theo
 * danh sách khai trong app-config.json (listSyncJS / listCSS). Khai lệch một
 * chữ là màn trắng, và lỗi chỉ lộ ra sau khi đã deploy xong, không phải lúc build.
 *
 * Tự quét thay vì khai tay thì đổi tên file, đổi hash, thêm/bớt CSS đều tự đúng.
 *
 * Chạy sau mỗi lần build:
 *   node ../../scripts/sync-app-config.mjs        (cwd = apps/miniapp)
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = process.env.ZMP_OUTPUT_DIR ?? "www";
const CONFIG = "app-config.json";

const die = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

if (!existsSync(CONFIG)) die(`Không thấy ${CONFIG} — cwd phải là thư mục gốc Mini App.`);
if (!existsSync(OUT_DIR)) die(`Không thấy thư mục build '${OUT_DIR}'. Chạy build trước.`);

/** Liệt kê file theo đuôi, trả path tương đối so với outDir (dùng '/' kể cả trên Windows). */
function collect(ext) {
  const found = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (entry.name.toLowerCase().endsWith(ext)) found.push(rel);
    }
  };
  walk(OUT_DIR, "");
  return found.sort();
}

const js = collect(".js");
const css = collect(".css");

if (js.length === 0) {
  die(`Không tìm thấy file .js nào trong '${OUT_DIR}'. Build thất bại?`);
}

const config = JSON.parse(readFileSync(CONFIG, "utf8"));
config.listSyncJS = js;
config.listCSS = css;
config.listAsyncJS = config.listAsyncJS ?? [];

writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);

console.log(`✅ Đã cập nhật ${CONFIG}`);
console.log(`   listSyncJS: ${js.join(", ")}`);
console.log(`   listCSS   : ${css.length ? css.join(", ") : "(không có — CSS có thể đã inline vào JS)"}`);

if (css.length === 0) {
  console.warn(
    "⚠️  Không có file CSS riêng. Nếu app hiện ra không có style, kiểm tra\n" +
      "   build.cssCodeSplit trong vite.config.ts."
  );
}

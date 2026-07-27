#!/usr/bin/env node
/**
 * Wrapper non-interactive cho `zmp deploy`.
 *
 * Bối cảnh kỹ thuật (đã kiểm chứng bằng cách đọc source zmp-cli@4.0.3):
 *
 * 1. `zmp login` ghi APP_ID và ZMP_TOKEN vào file `.env` ở thư mục gốc project
 *    (utils/env.js + config/index.js đọc lại 2 key này). Nghĩa là trong CI ta
 *    KHÔNG cần chạy `zmp login` — chỉ cần ghi sẵn `.env` là đủ. Đây là cách duy
 *    nhất chạy được headless vì `zmp login` mặc định yêu cầu quét QR.
 *
 * 2. `zmp deploy` hỗ trợ các flag:
 *      -p, --passive              chế độ non-interactive (bỏ prompt)
 *      -e, --existing             deploy project có sẵn (bỏ qua build của zmp,
 *                                 dùng khi bạn tự build bằng Vite/webpack)
 *      -t, --testing              đánh dấu version status = TESTING
 *      -m, --desc <message>       mô tả phiên bản
 *      -o, --outputDir <output>   thư mục upload, mặc định `www`
 *      -M, --mode <m>             env mode
 *
 * 3. Version status:
 *      DEVELOPMENT (mặc định) — không hiện trong Quản lý phiên bản, bị ghi đè
 *                               mỗi lần deploy. Dùng cho môi trường dev.
 *      TESTING                 — được đánh số và lưu lại, có thể gửi xét duyệt
 *                               rồi phát hành. Dùng cho staging/release.
 *
 * 4. `zmp deploy` KHÔNG publish lên production. Publish phải qua xét duyệt của
 *    Zalo (thủ công trên console, hoặc Partner Open API nếu bạn là đối tác giải
 *    pháp đã ký hợp tác).
 */

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, readFileSync, appendFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const {
  ZMP_APP_ID,
  ZMP_TOKEN,
  ZMP_OUTPUT_DIR = "www",
  ZMP_VERSION_STATUS = "development",
  ZMP_DESCRIPTION = "",
  ZMP_CLI_BIN = "zmp",
  GITHUB_OUTPUT,
} = process.env;

const die = (msg) => {
  console.error(`::error title=zmp deploy::${msg}`);
  process.exit(1);
};

if (!ZMP_APP_ID) die("Thiếu ZMP_APP_ID.");
if (!ZMP_TOKEN) die("Thiếu ZMP_TOKEN.");
if (!ZMP_DESCRIPTION.trim()) die("Thiếu mô tả phiên bản (ZMP_DESCRIPTION) — Zalo bắt buộc trường này.");

const status = ZMP_VERSION_STATUS.toLowerCase();
if (!["development", "testing"].includes(status)) {
  die(`ZMP_VERSION_STATUS phải là 'development' hoặc 'testing', nhận được '${ZMP_VERSION_STATUS}'.`);
}

if (!existsSync("app-config.json")) {
  die("Không tìm thấy app-config.json ở thư mục hiện tại — đây không phải thư mục gốc của Zalo Mini App.");
}

const outDir = resolve(ZMP_OUTPUT_DIR);
if (!existsSync(outDir) || readdirSync(outDir).length === 0) {
  die(`Thư mục build '${ZMP_OUTPUT_DIR}' không tồn tại hoặc rỗng. Chạy build trước khi deploy.`);
}

// zmp-cli đọc credential từ .env ở project root.
//
// ⚠ Cùng file .env này Vite cũng dùng cho các biến VITE_*. Ghi đè trắng sẽ xoá
// VITE_API_BASE_URL — lần build sau im lặng trỏ về URL trong .env.example.
// Nên giữ lại mọi dòng KHÔNG phải credential, chỉ thay APP_ID/ZMP_TOKEN.
const keep = existsSync(".env")
  ? readFileSync(".env", "utf8")
      .split("\n")
      .filter((l) => l.trim() && !/^\s*(APP_ID|ZMP_TOKEN)\s*=/.test(l))
  : [];

writeFileSync(".env", [`APP_ID=${ZMP_APP_ID}`, `ZMP_TOKEN=${ZMP_TOKEN}`, ...keep, ""].join("\n"), {
  mode: 0o600
});

const args = ["deploy", "--passive", "--existing", "--outputDir", ZMP_OUTPUT_DIR, "--desc", ZMP_DESCRIPTION];
if (status === "testing") args.push("--testing");

console.log(`Deploying app ${ZMP_APP_ID} (status=${status}) từ '${ZMP_OUTPUT_DIR}'...`);

const result = spawnSync(ZMP_CLI_BIN, args, {
  stdio: ["ignore", "pipe", "pipe"],
  encoding: "utf8",
  env: { ...process.env, CI: "true" },
});

const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";

// Không in thẳng stderr/stdout mà lọc token phòng trường hợp CLI echo ra.
const redact = (s) => s.replaceAll(ZMP_TOKEN, "***");
process.stdout.write(redact(stdout));
process.stderr.write(redact(stderr));

if (result.status !== 0) {
  if (/Token\s*Invalid|permission_denied|Permission denied/i.test(stdout + stderr)) {
    die("Zalo từ chối token. Token đã hết hạn hoặc không thuộc đúng Mini App ID. Rotate secret ZMP_TOKEN.");
  }
  die(`zmp deploy thất bại với exit code ${result.status}.`);
}

const version = (stdout.match(/Version:\s*([^\s]+)/i) ?? [])[1] ?? "";
if (GITHUB_OUTPUT) {
  appendFileSync(GITHUB_OUTPUT, `version=${version}\n`);
}

console.log(`Deploy thành công${version ? ` — version ${version}` : ""}.`);

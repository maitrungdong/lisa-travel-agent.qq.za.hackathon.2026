#!/usr/bin/env node
/**
 * demo-rehearsal.mjs — diễn thử kịch bản demo bằng webhook giả.
 *
 *     node scripts/demo-rehearsal.mjs
 *     TURN_WAIT=40 node scripts/demo-rehearsal.mjs      # chờ lâu hơn mỗi lượt
 *     CHAT=grp_test_2 node scripts/demo-rehearsal.mjs   # nhóm giả khác
 *
 * CÁCH LÀM: POST thẳng vào `/zalo/webhook` với payload đúng hình dạng Zalo Bot
 * API. Đi qua toàn bộ đường thật — verify secret, chuẩn hoá, hàng đợi, agent,
 * tool, Postgres. Chỉ có nguồn tin là giả.
 *
 * ⚠ TỐN TIỀN THẬT. Mỗi lượt là một lần gọi model. Kịch bản này 6 lượt.
 *
 * ⚠ GHI DB THẬT. Dùng `chatId` riêng (mặc định `grp_rehearsal`) nên chuyến tạo
 * ra không dính vào nhóm demo. Muốn dọn thì xoá theo `zalo_group_id` đó.
 *
 * Zino sẽ cố gửi trả lời về `chatId` giả và Zalo từ chối — log hiện WARN. Đó là
 * bình thường: thứ ta kiểm là DẤU VẾT TRONG DB, không phải tin nhắn.
 */

const BASE = (process.env.BASE ?? "https://zah-35.123c.vn/api").replace(/\/+$/, "");
const SECRET = process.env.ZALO_WEBHOOK_SECRET ?? "";
const CHAT = process.env.CHAT ?? "grp_rehearsal";
const TURN_WAIT = Number(process.env.TURN_WAIT ?? 30) * 1000;

const C = { g: "\x1b[32m", y: "\x1b[33m", r: "\x1b[31m", c: "\x1b[36m", d: "\x1b[2m", o: "\x1b[0m" };
const ok = (s) => console.log(`  ${C.g}✓${C.o} ${s}`);
const bad = (s) => console.log(`  ${C.r}✗${C.o} ${s}`);
const warn = (s) => console.log(`  ${C.y}!${C.o} ${s}`);
const step = (s) => console.log(`\n${C.c}${s}${C.o}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ba nhân vật trong script demo. */
const MINH = { id: "u_minh", name: "Minh" };
const LAN = { id: "u_lan", name: "Lan" };
const TU = { id: "u_tu", name: "Tú" };

/**
 * Zalo LUÔN chèn tên bot vào đầu tin nhắn nhóm gửi cho bot — không có mảng
 * `mentions` nào cả. `stripBotMention` ở backend gỡ nó ra. Giả lập đúng như
 * vậy, nếu không thì test dễ dãi hơn thực tế.
 */
const MENTION = process.env.ZALO_BOT_NAME
  ? `@${process.env.ZALO_BOT_NAME} `
  : "@Bot ZINO - Trợ lý nhu cầu ";

let seq = Date.now();

async function send(who, text) {
  const body = {
    event_name: "message.text.received",
    message: {
      message_id: `rehearsal_${seq++}`,
      date: Math.floor(Date.now() / 1000),
      chat: { id: CHAT, chat_type: "group" },
      from: { id: who.id, display_name: who.name, is_bot: false },
      text: MENTION + text
    }
  };

  const res = await fetch(`${BASE}/zalo/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(SECRET ? { "x-bot-api-secret-token": SECRET } : {})
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`webhook trả ${res.status} — kiểm BASE và secret`);
  console.log(`  ${C.d}${who.name}: ${text}${C.o}`);
}

async function api(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

/* ------------------------------------------------------------------ */

/**
 * Kịch bản, bám theo `docs/ZINO - Demo Script v4.md`.
 *
 * `wait` là số giây chờ SAU tin đó. Lượt đầu lâu hơn vì cache lạnh; lượt đề
 * xuất lâu nhất vì Zino phải research trước khi có giá.
 */
const SCRIPT = [
  { who: MINH, text: "ơi. Giúp tao lên kế hoạch đi Vũng Tàu 28–30/07, 3 người (tao + Lan + Tú), budget 9 triệu.", wait: 1.5 },
  { who: LAN, text: "Muốn khách sạn gần biển, sáng dậy nhìn ra biển.", wait: 0.3 },
  { who: TU, text: "Giá chủ yếu. Max 3 triệu một người.", wait: 1 },
  { who: LAN, text: "chốt A đi", wait: 1 },
  { who: LAN, text: "tao vừa ăn hải sản 450k ở Gành Hào, chia 3 nhé", wait: 1 },
  { who: MINH, text: "chuyến xong rồi, chia tiền đi", wait: 1 }
];

async function main() {
  console.log(`\n${C.c}Diễn thử kịch bản demo${C.o}`);
  console.log(`  API   : ${BASE}`);
  console.log(`  Nhóm  : ${CHAT}  ${C.d}(giả — không đụng nhóm demo)${C.o}`);
  console.log(`  Chờ   : ${TURN_WAIT / 1000}s mỗi lượt`);
  if (!SECRET) warn("Không có ZALO_WEBHOOK_SECRET — chỉ chạy được nếu server cũng chưa đặt");

  const health = await api("/health");
  if (!health) {
    bad("Không gọi được /health — sai BASE hoặc API chưa chạy");
    process.exit(1);
  }
  ok("API sống");

  const before = (await api("/trips")) ?? [];
  const beforeIds = new Set((Array.isArray(before) ? before : []).map((t) => t.id));

  for (const [i, s] of SCRIPT.entries()) {
    step(`Lượt ${i + 1}/${SCRIPT.length}`);
    await send(s.who, s.text);
    const wait = Math.round(TURN_WAIT * s.wait);
    console.log(`  ${C.d}chờ ${Math.round(wait / 1000)}s...${C.o}`);
    await sleep(wait);
  }

  /* ---------------- Nghiệm thu ---------------- */

  step("Nghiệm thu — đọc lại dấu vết trong DB");

  const after = (await api("/trips")) ?? [];
  const list = Array.isArray(after) ? after : [];
  const trip = list.find((t) => !beforeIds.has(t.id)) ?? list[0];

  if (!trip) {
    bad("Không thấy chuyến nào mới — create_trip chưa chạy");
    process.exit(1);
  }
  ok(`Chuyến #${trip.id}: ${trip.name ?? "(không tên)"} → ${trip.destination ?? "?"}`);

  const decisions = await api(`/trips/${trip.id}/decisions`);
  const ds = Array.isArray(decisions) ? decisions : (decisions?.data ?? []);
  if (!ds.length) {
    bad("Không có đề xuất nào — propose_options chưa chạy");
  } else {
    const d = ds[0];
    ok(`Đề xuất "${d.title}" · ${d.options?.length ?? "?"} phương án`);
    if (d.status === "decided") {
      ok(`Đã CHỐT — record_decision chạy đúng${d.decidedByName ? ` (${d.decidedByName} chốt)` : ""}`);
    } else {
      bad(`Còn ở trạng thái "${d.status}" — record_decision KHÔNG được gọi`);
      warn("Đây là thứ cần sửa: Zino chưa chốt được từ chat");
    }
  }

  const recap = await api(`/trips/${trip.id}/recap`);
  if (recap) {
    const s = JSON.stringify(recap);
    s.includes("450") ? ok("Có khoản 450k trong sổ chi") : bad("Không thấy khoản 450k — add_expense chưa chạy");
    /(settle|chia|balance|owe)/i.test(s) ? ok("Recap có phần chia tiền") : warn("Recap chưa thấy phần chia tiền");
  } else {
    warn(`Không đọc được /trips/${trip.id}/recap`);
  }

  console.log(`\n${C.d}Xem log chi tiết:${C.o}`);
  console.log(`  ssh -p 2222 zah19-team35@118.102.2.135 "docker logs --since 15m lisa-api-1 2>&1 | grep -E '▶|◀|job#'"`);
  console.log(`\n${C.d}Dọn dữ liệu diễn thử:${C.o}`);
  console.log(`  DELETE FROM conversations WHERE zalo_chat_id = '${CHAT}';  -- cascade theo FK\n`);
}

main().catch((e) => {
  bad(e.message);
  process.exit(1);
});

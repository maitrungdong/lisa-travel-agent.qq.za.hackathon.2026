#!/usr/bin/env node
/**
 *  spike-v4.mjs — chạy thử `v4_outcome_agent` đúng như OutcomeService sẽ chạy.
 *
 *  Khác `spike-managed-agent.mjs` ở hai điểm quyết định:
 *    • gửi PLAIN TEXT, không bọc JSON — đúng §4.1 của bản handoff v4
 *    • NHIỀU LƯỢT trong CÙNG MỘT session — vì lịch sử hội thoại là working
 *      memory duy nhất của v4 (§5), và "Chọn 2" chỉ hiểu được nếu nó vào đúng
 *      session đã hiển thị hai lựa chọn
 *
 *  Bốn câu hỏi cần trả lời TRƯỚC khi bật cờ trên production:
 *    1. Brain có thật sự được gọi khi gõ `BẮT ĐẦU RESEARCH` không?
 *    2. Environment có chặn Brain ra web không? (cái đang dùng chỉ mở
 *       demandapi-mcp.booking.com — xem mục 2 của spike-managed-agent)
 *    3. Một lượt có research mất bao lâu → chốt ZINO_OUTCOME_TIMEOUT_MS
 *    4. `Chọn 2` có được hiểu đúng trong cùng session không?
 *
 *  Dùng — chỉ cần API key và agent id:
 *      export ZINO_AGENT_API_KEY='sk-ant-...'
 *      node scripts/spike-v4.mjs agent_<OUTCOME_ID>
 *
 *  Environment: thiếu thì script TỰ TẠO một cái mạng không giới hạn và in ra
 *  dòng để dán vào .env. Có sẵn `ZINO_AGENT_ENV_ID` thì dùng lại, nhưng cảnh
 *  báo nếu nó bị bó host — vì Brain bị chặn mạng sẽ TREO chứ không báo lỗi.
 *
 *      NEW_ENV=1  node scripts/spike-v4.mjs agent_...   # ép tạo env mới
 *      VERBOSE=1  ...                                    # in mọi event kèm mốc giây
 *      ZINO_OUTCOME_TIMEOUT_MS=900000 ...                # nới trần khi đo Brain
 *      MSGS='câu 1|câu 2|Chọn 2' ...                     # kịch bản riêng
 *
 *  Mỗi lượt tốn tiền thật, lượt research tốn đáng kể. Chạy có chủ đích.
 */

const API = process.env.ANTHROPIC_API_BASE ?? "https://api.anthropic.com";
const BETA = process.env.ZINO_MANAGED_AGENTS_BETA ?? "managed-agents-2026-04-01";
const KEY = process.env.ZINO_AGENT_API_KEY || process.env.ANTHROPIC_API_KEY || "";
const ENV_ID = process.env.ZINO_AGENT_ENV_ID || process.env.ENV_ID || "";
const AGENT_ID = process.argv[2] || process.env.ZINO_AGENT_OUTCOME_ID || "";
const TIMEOUT_MS = Number(process.env.ZINO_OUTCOME_TIMEOUT_MS || 240_000);

/** Kịch bản mặc định = smoke test §14 của bản handoff */
const MSGS = (
  process.env.MSGS ??
  [
    "Đi Nha Trang 7 người, khoảng 5 triệu/người",
    "Đi từ TP.HCM, 2 ngày 1 đêm cuối tuần này, thiên về nghỉ dưỡng",
    "BẮT ĐẦU RESEARCH",
    "Chọn 2"
  ].join("|")
)
  .split("|")
  .filter(Boolean);

if (!KEY) die("Thiếu ZINO_AGENT_API_KEY");
if (!AGENT_ID) die("Thiếu agent id — truyền tham số hoặc đặt ZINO_AGENT_OUTCOME_ID");
// ENV_ID cố ý KHÔNG bắt buộc: resolveEnv() tự tạo nếu thiếu. Bắt buộc nó chỉ
// đẩy người dùng đi chạy một dòng curl dài, mà đó đúng là thứ script này sinh
// ra để thay thế.

const H = {
  "x-api-key": KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": BETA,
  "content-type": "application/json"
};

async function req(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : {};
}

/**
 * Một lượt: mở stream TRƯỚC rồi mới gửi tin — đúng thứ tự driver thật dùng, để
 * không mất event nào phát ra trước khi kịp lắng nghe.
 */
async function turn(sessionId, text) {
  const started = Date.now();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);

  const stream = await fetch(`${API}/v1/sessions/${sessionId}/events/stream`, {
    headers: { ...H, accept: "text/event-stream" },
    signal: abort.signal
  });
  if (!stream.ok || !stream.body) throw new Error(`stream ${stream.status}`);

  await req("POST", `/v1/sessions/${sessionId}/events`, {
    events: [{ type: "user.message", content: [{ type: "text", text }] }]
  });

  const reader = stream.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out = "";
  let tools = 0;
  const toolNames = new Set();
  let firstEventMs = 0;

  /**
   * Theo dõi ĐỘ IM LẶNG, không phải tổng thời gian.
   *
   * Lượt research chết ở ~81s mà không có tool call nào là triệu chứng khớp với
   * "Brain bị chặn mạng rồi treo": stream không đứt hẳn, chỉ ngừng phát event.
   * Phân biệt được hai ca — server còn thở nhưng agent không tiến, và server
   * ngắt kết nối — quyết định đi sửa environment hay sửa transport.
   */
  let lastEventAt = started;
  const hb = setInterval(() => {
    const total = ((Date.now() - started) / 1000).toFixed(0);
    const quiet = ((Date.now() - lastEventAt) / 1000).toFixed(0);
    process.stdout.write(`      … ${total}s (im lặng ${quiet}s)          \r`);
  }, 5_000);

  try {
    outer: for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const p = line.slice(5).trim();
        if (!p || p === "[DONE]") continue;
        let ev;
        try {
          ev = JSON.parse(p);
        } catch {
          continue;
        }
        if (!firstEventMs) firstEventMs = Date.now() - started;
        lastEventAt = Date.now();

        // VERBOSE=1 → in MỌI event kèm mốc thời gian. Đây là cách duy nhất biết
        // agent đứng lại ở đâu khi nó im lặng mà không báo lỗi.
        if (process.env.VERBOSE === "1") {
          const at = ((Date.now() - started) / 1000).toFixed(1);
          const extra =
            ev.type === "agent.tool_use" || ev.type === "agent.mcp_tool_use"
              ? ` → ${ev.name ?? ev.tool_name ?? "?"}`
              : ev.type === "agent.tool_result" || ev.type === "agent.mcp_tool_result"
                ? ` ← ${JSON.stringify(ev.content ?? ev.result ?? "").slice(0, 160)}`
                : "";
          console.log(`      [${at}s] ${ev.type}${extra}`);
        }

        switch (ev.type) {
          case "agent.message": {
            const t = Array.isArray(ev.content)
              ? ev.content.map((b) => b?.text ?? "").join("")
              : String(ev.content ?? "");
            if (t.trim()) out = t;
            break;
          }
          // MCP dùng event RIÊNG, đếm thiếu thì tưởng agent không gọi gì
          case "agent.tool_use":
          case "agent.mcp_tool_use":
            tools++;
            if (ev.name || ev.tool_name) toolNames.add(ev.name ?? ev.tool_name);
            break;
          /**
           * Sub-agent chạy trong THREAD RIÊNG, tool call của nó không phát ra
           * trên stream này. Nên "0 tool call" KHÔNG có nghĩa là Brain không
           * chạy — đếm luôn việc giao thread mới là bằng chứng đáng tin hơn.
           */
          case "session.thread_created":
          case "agent.thread_message_sent":
            tools++;
            toolNames.add("→ sub-agent (Brain)");
            break;
          case "session.error":
            throw new Error(`session.error: ${JSON.stringify(ev.error ?? ev).slice(0, 300)}`);
          case "session.status_idle":
            break outer;
        }
      }
    }
  } catch (err) {
    // Phân biệt "tôi cắt" với "server ngắt" — hai nguyên nhân, hai chỗ sửa.
    // Và KHÔNG vứt text đã gom: lượt research nào cũng đắt, mất output vì hết
    // giờ là mất luôn manh mối agent đang làm gì.
    const total = ((Date.now() - started) / 1000).toFixed(1);
    const quiet = ((Date.now() - lastEventAt) / 1000).toFixed(1);
    const mine = abort.signal.aborted;
    if (out.trim()) {
      console.log(`\n      ── text agent đã kịp nói trước khi đứt ──\n${out}\n`);
    }
    throw new Error(
      `${err.message} · sau ${total}s, im lặng ${quiet}s trước khi đứt · ` +
        `${mine ? `TÔI cắt (timeout ${TIMEOUT_MS / 1000}s)` : "SERVER hoặc transport ngắt"}`
    );
  } finally {
    clearInterval(hb);
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
  }

  return { out, tools, toolNames: [...toolNames], ms: Date.now() - started, firstEventMs };
}

function die(m) {
  console.error(`✘ ${m}`);
  process.exit(1);
}

/**
 * Tìm hoặc tạo environment — thay cho một dòng curl dài dằng dặc.
 *
 * Ba đường, theo thứ tự ưu tiên:
 *   NEW_ENV=1        → luôn tạo mới, mạng không giới hạn
 *   có ZINO_AGENT_ENV_ID → dùng lại, nhưng CẢNH BÁO nếu nó bị bó host
 *   không có gì      → tự tạo, khỏi hỏi
 *
 * Vì sao cảnh báo quan trọng: environment quyết định Brain có ra được web hay
 * không, mà khi bị chặn nó KHÔNG báo lỗi — nó treo. Đã mất một lượt 240 giây
 * để phát hiện điều đó, nên thà ồn ào ngay từ đầu.
 */
async function resolveEnv() {
  const wantNew = process.env.NEW_ENV === "1";

  if (!wantNew && ENV_ID) {
    const env = await req("GET", `/v1/environments/${ENV_ID}`).catch(() => null);
    if (env) {
      const net = env.config?.networking ?? {};
      const hosts = net.allowed_hosts ?? null;
      console.log(`  dùng sẵn: ${ENV_ID} · type=${net.type ?? "?"}`);
      console.log(`  allowed_hosts: ${hosts ? JSON.stringify(hosts) : "(không giới hạn)"}`);
      if (net.type === "limited" && (hosts ?? []).length <= 2) {
        console.log("  ⚠ Mạng bị bó hẹp. Brain cần tra cứu web mở — nhiều khả năng bị chặn và TREO.");
        console.log("     Tạo cái mới bằng: NEW_ENV=1 node scripts/spike-v4.mjs <agent_id>");
      }
      return ENV_ID;
    }
    console.log(`  ✘ ${ENV_ID} không đọc được — tạo cái mới`);
  }

  /**
   * `networking.type` là field BẮT BUỘC, và tài liệu không nói rõ giá trị nào
   * nghĩa là "không giới hạn". Dò lần lượt thay vì đoán một phát rồi hỏng.
   *
   * An toàn: request sai trả 400 và KHÔNG tạo environment nào, nên thử nhiều
   * lần không để lại rác. Đường cuối là `limited` với danh sách host rộng —
   * kém hơn nhưng chạy được, và in rõ để biết mình đang ở đường nào.
   */
  const base = {
    allow_mcp_servers: true,
    allow_package_managers: true
  };
  const candidates = [
    { label: "unrestricted", networking: { type: "unrestricted", ...base } },
    { label: "open", networking: { type: "open", ...base } },
    { label: "full", networking: { type: "full", ...base } },
    { label: "none", networking: { type: "none", ...base } },
    {
      label: "limited + host rộng (đường lui)",
      networking: {
        type: "limited",
        ...base,
        allowed_hosts: (
          process.env.ALLOWED_HOSTS ??
          "demandapi-mcp.booking.com,*.booking.com,*.google.com,*.bing.com,*.tripadvisor.com,*.agoda.com,*.traveloka.com,*.vietnamairlines.com,*.vexere.com,*.klook.com"
        )
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      }
    }
  ];

  const name = `zino-v4-${new Date().toISOString().slice(0, 16).replace(/[:T-]/g, "")}`;
  let created = null;
  let usedLabel = "";

  for (const c of candidates) {
    try {
      created = await req("POST", "/v1/environments", {
        name,
        config: { type: "cloud", networking: c.networking }
      });
      usedLabel = c.label;
      break;
    } catch (err) {
      const short = String(err.message).slice(0, 120).replace(/\s+/g, " ");
      console.log(`  · type="${c.networking.type}" không dùng được — ${short}`);
    }
  }

  if (!created) die("Không tạo được environment với bất kỳ networking.type nào — xem lỗi ở trên");

  const net = created.config?.networking ?? {};
  console.log(`  ✓ vừa tạo: ${created.id}  (networking.type = ${usedLabel})`);
  console.log(`     hosts: ${JSON.stringify(net.allowed_hosts ?? "(không giới hạn)")}`);
  if (net.type === "limited") {
    console.log("  ⚠ Vẫn là `limited`. Brain chỉ ra được các host trong danh sách trên.");
    console.log("     Thiếu host nào thì thêm: ALLOWED_HOSTS='a.com,b.com' NEW_ENV=1 node scripts/spike-v4.mjs ...");
  }
  console.log(`\n  Dùng lại về sau — dán dòng này vào /opt/zino/.env:`);
  console.log(`     ZINO_AGENT_ENV_ID=${created.id}\n`);
  return created.id;
}

/* ------------------------------------------------------------------ */

const main = async () => {
  console.log("═══ Agent ═══");
  const agent = await req("GET", `/v1/agents/${AGENT_ID}`);
  console.log(`  ${agent.name} · ${agent.model?.id} · effort=${agent.model?.effort?.type}`);
  console.log(`  tools: ${JSON.stringify(agent.tools ?? [])}`);

  console.log("\n═══ Environment ═══");
  const envId = await resolveEnv();

  console.log("\n═══ Session (dùng chung cho MỌI lượt — đây là điểm mấu chốt) ═══");
  const session = await req("POST", "/v1/sessions", {
    agent: AGENT_ID,
    environment_id: envId,
    title: `spike-v4 ${new Date().toISOString()}`
  });
  console.log(`  ${session.id}`);

  const timings = [];
  let brainSeen = false;

  for (const [i, msg] of MSGS.entries()) {
    console.log(`\n${"─".repeat(72)}`);
    console.log(`▶ Lượt ${i + 1}/${MSGS.length}: ${msg}`);
    let r;
    try {
      r = await turn(session.id, msg);
    } catch (err) {
      console.log(`  ✘ ${err.message}`);
      break;
    }

    timings.push({ msg, ms: r.ms, tools: r.tools });
    if (r.tools > 0) brainSeen = true;

    console.log(
      `  ${(r.ms / 1000).toFixed(1)}s · event đầu ${(r.firstEventMs / 1000).toFixed(1)}s` +
        ` · ${r.out.length} ký tự · ${r.tools} tool${r.toolNames.length ? ` (${r.toolNames.join(", ")})` : ""}`
    );
    const looksJson = r.out.trim().startsWith("{");
    console.log(`  định dạng: ${looksJson ? "⚠ JSON — v4 phải là plain text" : "✓ plain text"}`);
    console.log("─".repeat(72));
    console.log(r.out);
  }

  console.log(`\n${"═".repeat(72)}`);
  console.log("═══ Kết luận ═══");
  for (const [i, t] of timings.entries()) {
    console.log(`  lượt ${i + 1}: ${(t.ms / 1000).toFixed(1)}s · ${t.tools} tool · ${t.msg.slice(0, 40)}`);
  }
  const slowest = Math.max(...timings.map((t) => t.ms), 0);
  console.log(`\n  lượt chậm nhất : ${(slowest / 1000).toFixed(1)}s`);
  console.log(`  → đặt ZINO_OUTCOME_TIMEOUT_MS ≥ ${Math.ceil((slowest * 1.5) / 1000) * 1000}`);
  console.log(
    `  Brain có chạy  : ${brainSeen ? "✓ có (thấy tool call)" : "✘ KHÔNG thấy tool call nào"}`
  );
  if (!brainSeen) {
    console.log("     Không có tool call ở lượt BẮT ĐẦU RESEARCH nghĩa là một trong ba:");
    console.log("     • Outcome Agent chưa được gắn đúng Brain ID lúc import");
    console.log("     • Brain bị environment chặn mạng nên không gọi được gì");
    console.log("     • Agent quyết định không cần research (đọc lại output xem nó nói gì)");
  }

  console.log("\n═══ Dọn ═══");
  await req("DELETE", `/v1/sessions/${session.id}`).catch(() => {});
  console.log(`  đã xoá ${session.id}`);
};

main().catch((e) => die(e.message));

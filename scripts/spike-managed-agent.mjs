#!/usr/bin/env node
/**
 *  spike-managed-agent.mjs — gọi thử MỘT agent trên Claude Managed Agents.
 *
 *  Mục đích: trả lời ba câu hỏi mà tài liệu KHÔNG trả lời được, trước khi
 *  bật ZINO_PIPELINE_ENABLED=1 và tin vào managed-agent.driver.ts.
 *
 *    1. Đường dẫn REST có đúng như suy đoán không? (/v1/agents, /v1/sessions...)
 *    2. Event stream có hình dạng gì? agent.message.content là string hay mảng?
 *    3. Dựng sandbox mất bao lâu? → quyết định ZINO_STAGE_B_TIMEOUT_MS
 *
 *  và câu hỏi đắt nhất về mặt sản phẩm:
 *
 *    4. Offer Scout trả về OFFER THẬT (có giá, có tên chỗ) hay bài blog du lịch?
 *
 *  Dùng:
 *      export ANTHROPIC_API_KEY='sk-ant-...'
 *      node scripts/spike-managed-agent.mjs agent_01MxRs...
 *
 *      AGENT_ID=agent_01... ENV_ID=env_01... node scripts/spike-managed-agent.mjs
 *
 *  Không ghi gì vào DB, không đụng vào bot đang chạy. Tự xoá session khi xong.
 */

const API = process.env.ANTHROPIC_API_BASE ?? "https://api.anthropic.com";
const BETA = process.env.ZINO_MANAGED_AGENTS_BETA ?? "managed-agents-2026-04-01";
const KEY = process.env.ZINO_AGENT_API_KEY || process.env.ANTHROPIC_API_KEY || "";
const AGENT_ID = process.argv[2] ?? process.env.AGENT_ID ?? "";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 600_000);
/** In mọi loại event, kể cả span.* và agent.thinking. Tắt bằng VERBOSE=0 */
const VERBOSE = process.env.VERBOSE !== "0";
/** Giữ lại để in hướng dẫn đọc kết quả nếu client timeout trước agent */
let LAST_SESSION = "";

if (!KEY) die("Thiếu ZINO_AGENT_API_KEY (hoặc ANTHROPIC_API_KEY)");
if (!AGENT_ID) die("Thiếu agent_id. Dùng: node scripts/spike-managed-agent.mjs <agent_id>");

const H = {
  "x-api-key": KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": BETA,
  "content-type": "application/json"
};

/* Payload đúng contract stage B trong backend.md: truyền NGUYÊN output của A,
   không bóc field. Đây là một output A giả nhưng hợp lý cho tình huống thật. */
const PAYLOAD = {
  alignment_result: {
    status: "ready_for_scout",
    message_to_user: null,
    brief: {
      destination: "Đà Lạt",
      origin: "TP.HCM",
      start_date: "2026-08-08",
      end_date: "2026-08-10",
      pax: 4,
      budget_per_person_vnd: 3_000_000,
      transport_preference: "xe khách"
    },
    decision_spec: {
      must_have: ["chỗ ở gần trung tâm", "không dậy trước 7h"],
      nice_to_have: ["quán cà phê view đẹp", "đồ ăn địa phương"],
      weights: { cost: 0.4, convenience: 0.35, experience: 0.25 }
    },
    shopping_list: [
      { slot: "lodging", nights: 2, pax: 4 },
      { slot: "intercity_transport", legs: ["SGN→DLI", "DLI→SGN"], pax: 4 },
      { slot: "food", meals: 6 }
    ]
  },
  trace_id: "spike-" + Date.now(),
  reference_date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }),
  source_inputs: [],
  parsed_offers: []
};

/* ------------------------------------------------------------------ */

const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";

async function req(method, path, body) {
  const url = `${API}${path}`;
  const res = await fetch(url, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text().catch(() => "");
  console.log(`  ${method} ${path} → ${res.status}`);
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 400)}`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return text;
  }
}

async function main() {
  console.log("═══ 1. Agent có tồn tại không, cấu hình gì ═══");
  let agent;
  try {
    agent = await req("GET", `/v1/agents/${AGENT_ID}`);
    console.log(`  name   : ${agent.name ?? "(không có)"}`);
    console.log(`  model  : ${JSON.stringify(agent.model ?? agent.model_id ?? "?")}`);
    console.log(`  tools  : ${JSON.stringify(agent.tools ?? "(không thấy field tools)")}`);
    console.log(`  prompt : ${String(agent.system ?? agent.system_prompt ?? "").length} ký tự`);
  } catch (e) {
    console.log(`  ✗ ${e.message}`);
    console.log("  → Đường dẫn /v1/agents/{id} SAI. Dùng `ant beta:agents list` để đối chiếu.");
  }

  console.log("\n═══ 2. Environment ═══");
  let envId = process.env.ENV_ID ?? process.env.ZINO_AGENT_ENV_ID ?? "";

  if (envId) {
    console.log(`  dùng sẵn: ${envId}`);
    const env = await req("GET", `/v1/environments/${envId}`).catch(() => null);
    if (env) console.log(`  networking: ${JSON.stringify(env.config?.networking ?? "?")}`);
  } else {
    /**
     * KHÔNG nhặt environment đầu danh sách.
     *
     * Đã dính một lần: env có sẵn là `limited` với allow_mcp_servers mặc định
     * false → session create trả 400 vì chặn MCP server của agent. Cấu hình
     * mạng của environment người khác tạo là thứ không kiểm soát được, nên tự
     * tạo một cái biết rõ.
     */
    const hosts = (process.env.MCP_HOSTS ?? "demandapi-mcp.booking.com")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const created = await req("POST", "/v1/environments", {
      name: `zino-spike-${Date.now()}`,
      config: {
        type: "cloud",
        networking: {
          type: "limited",
          allowed_hosts: hosts,
          // Agent có mcp_toolset → thiếu cờ này là session create 400 ngay
          allow_mcp_servers: true,
          allow_package_managers: true
        }
      }
    });
    envId = created.id;
    console.log(`  vừa tạo: ${envId}  (allow_mcp_servers=true, hosts=${hosts.join(",")})`);
  }

  console.log("\n═══ 3. Tạo session ═══");
  const tSession = Date.now();
  const session = await req("POST", "/v1/sessions", {
    agent: AGENT_ID,
    environment_id: envId,
    title: "Zino spike Offer Scout"
  });
  LAST_SESSION = session.id;
  console.log(`  session ${session.id} · ${((Date.now() - tSession) / 1000).toFixed(1)}s`);

  console.log("\n═══ 4. Mở stream rồi gửi payload ═══");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  const tFirst = { at: 0 };

  const stream = await fetch(`${API}/v1/sessions/${session.id}/events/stream`, {
    headers: { ...H, accept: "text/event-stream" },
    signal: abort.signal
  });
  console.log(`  GET /events/stream → ${stream.status}`);
  if (!stream.ok || !stream.body) {
    console.log(await stream.text().catch(() => ""));
    throw new Error("Không mở được stream");
  }

  await req("POST", `/v1/sessions/${session.id}/events`, {
    events: [{ type: "user.message", content: [{ type: "text", text: JSON.stringify(PAYLOAD) }] }]
  });

  console.log("\n═══ 5. Event nhận được ═══");
  const seen = new Map();
  let last = "";
  let tools = 0;

  const reader = stream.body.getReader();
  const dec = new TextDecoder();
  let buf = "";

  /**
   * Nhịp tim: cứ 15s im lặng thì báo một dòng.
   *
   * Không có nó thì "agent đang nghĩ" và "stream đã chết" trông giống hệt
   * nhau — đúng cái bẫy đã dính ở lần chạy trước.
   */
  let lastEventAt = Date.now();
  const heartbeat = setInterval(() => {
    const quiet = ((Date.now() - lastEventAt) / 1000).toFixed(0);
    if (Number(quiet) >= 15) console.log(`  [${el()}] … im lặng ${quiet}s`);
  }, 15_000);

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

      seen.set(ev.type, (seen.get(ev.type) ?? 0) + 1);
      lastEventAt = Date.now();
      if (!tFirst.at) {
        tFirst.at = Date.now();
        console.log(`  event đầu tiên sau ${el()}  ← ĐÂY LÀ COLD START`);
      }

      // In MỌI event lạ — không có dòng này thì không phân biệt được
      // "agent đang làm việc" với "stream chết"
      if (
        VERBOSE &&
        ![
          "agent.message",
          "agent.tool_use",
          "agent.mcp_tool_use",
          "session.error",
          "session.status_idle"
        ].includes(ev.type)
      ) {
        console.log(`  [${el()}] · ${ev.type}`);
      }

      if (ev.type === "agent.message") {
        const txt = Array.isArray(ev.content)
          ? ev.content.map((b) => b?.text ?? "").join("")
          : String(ev.content ?? "");
        if (txt.trim()) last = txt;
        console.log(`  [${el()}] agent.message · ${txt.length} ký tự`);
      } else if (ev.type === "agent.tool_use" || ev.type === "agent.mcp_tool_use") {
        tools++;
        const kind = ev.type === "agent.mcp_tool_use" ? "MCP" : "tool";
        console.log(`  [${el()}] ${kind}: ${ev.name ?? ev.server_name ?? "?"}`);
      } else if (ev.type === "session.error") {
        console.log(`  [${el()}] session.error: ${JSON.stringify(ev).slice(0, 300)}`);
      } else if (ev.type === "session.status_idle") {
        console.log(`  [${el()}] idle · stop_reason=${ev.stop_reason ?? "?"}`);
        break outer;
      }
    }
  }
  clearTimeout(timer);
  clearInterval(heartbeat);
  await reader.cancel().catch(() => {});

  console.log("\n  các loại event: " + JSON.stringify(Object.fromEntries(seen)));

  console.log("\n═══ 6. Output cuối cùng ═══");
  console.log("─".repeat(70));
  console.log(last.slice(0, 4000));
  console.log("─".repeat(70));

  console.log("\n═══ 7. Kết luận ═══");
  console.log(`  tổng thời gian     : ${el()}`);
  console.log(`  số lần gọi tool    : ${tools}   ${tools ? "" : "← KHÔNG gọi tool nào!"}`);

  const parsed = tryJson(last);
  if (!parsed) {
    console.log("  JSON               : ✗ KHÔNG parse được");
    console.log("  → driver phải dựa vào lớp sửa lỗi. Cân nhắc siết prompt của agent.");
  } else {
    console.log("  JSON               : ✓");
    console.log(`  status             : ${parsed.status ?? "(THIẾU)"}`);
    const ok = ["needs_source_data", "needs_user_input", "ready_for_composer", "blocked"];
    if (!ok.includes(parsed.status)) console.log(`  → status không thuộc [${ok.join(", ")}]`);
    console.log(
      `  message_to_user    : ${
        parsed.message_to_user === undefined
          ? "(THIẾU — backend sẽ không gửi được gì cho user!)"
          : parsed.message_to_user === null
            ? "null"
            : `${String(parsed.message_to_user).length} ký tự`
      }`
    );
    const offers = parsed.offers;
    console.log(`  offers             : ${Array.isArray(offers) ? offers.length + " cái" : "(không có)"}`);
    if (Array.isArray(offers) && offers.length) {
      console.log("\n  Offer đầu tiên — ĐỌC KỸ, đây là thứ quyết định demo:");
      console.log("  " + JSON.stringify(offers[0], null, 2).split("\n").join("\n  "));
    }
  }

  console.log("\n═══ 8. Dọn ═══");
  await req("DELETE", `/v1/sessions/${session.id}`).catch((e) => console.log("  " + e.message));
}

function tryJson(s) {
  const t = String(s).trim();
  for (const cand of [t, t.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], sliceBraces(t)]) {
    if (!cand) continue;
    try {
      const v = JSON.parse(cand.trim());
      if (v && typeof v === "object") return v;
    } catch {}
  }
  return null;
}
function sliceBraces(t) {
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  return a >= 0 && b > a ? t.slice(a, b + 1) : null;
}
function die(m) {
  console.error("✗ " + m);
  process.exit(1);
}

main().catch((e) => {
  console.error("\n✗ " + e.message);
  if (LAST_SESSION) {
    /**
     * Timeout ở phía CLIENT không giết session — agent vẫn chạy tiếp trên
     * hạ tầng Anthropic. Lịch sử event lưu server-side nên đọc lại được sau,
     * đây là cách biết B thật sự mất bao lâu và trả về gì.
     */
    console.error("\nSession vẫn còn sống. Đọc lại kết quả sau vài phút:");
    console.error(`  curl -s "${API}/v1/sessions/${LAST_SESSION}/events" \\
    -H "x-api-key: \$ZINO_AGENT_API_KEY" \\
    -H "anthropic-version: 2023-06-01" \\
    -H "anthropic-beta: ${BETA}" | python3 -m json.tool | tail -60`);
    console.error(`\nXoá khi xong:  curl -X DELETE "${API}/v1/sessions/${LAST_SESSION}" ...`);
  }
  process.exit(1);
});

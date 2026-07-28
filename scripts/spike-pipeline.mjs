#!/usr/bin/env node
/**
 *  spike-pipeline.mjs — chạy CẢ pipeline A → B → C → D trên agent thật.
 *
 *  Dùng đúng contract mà pipeline.service.ts dùng, nên kết quả ở đây dự đoán
 *  được hành vi khi bật ZINO_PIPELINE_ENABLED=1. Khác biệt duy nhất: không
 *  đụng Postgres, không gửi Zalo, in ra terminal.
 *
 *  Trả lời ba câu chưa biết:
 *    1. A/C/D có tuân thủ contract {status, message_to_user} không?
 *    2. Tổng thời gian A+B+C là bao nhiêu? (= thời gian nhóm Zalo phải chờ)
 *    3. C có hiểu đúng price.unit của B không? B trả "per_trip" cho 2 phòng
 *       2 đêm — C tính nhầm là toàn bộ ngân sách lệch.
 *
 *  Dùng:
 *      export ZINO_AGENT_API_KEY='sk-ant-...'
 *      export ENV_ID='env_01CTFnw7x6MGZ73LugRhxZds'
 *      node scripts/spike-pipeline.mjs
 *
 *      # A hỏi lại thì trả lời sẵn, ngăn cách bằng |
 *      ANSWERS='xe khách|dậy sớm thoải mái' node scripts/spike-pipeline.mjs
 *
 *      MSG='lên plan Nha Trang 20-22/9, 6 người, 4 triệu/người' \
 *        node scripts/spike-pipeline.mjs
 *
 *  Mỗi lượt tốn tiền thật (session-hour + token). Chạy có chủ đích.
 */

const API = process.env.ANTHROPIC_API_BASE ?? "https://api.anthropic.com";
const BETA = process.env.ZINO_MANAGED_AGENTS_BETA ?? "managed-agents-2026-04-01";
const KEY = process.env.ZINO_AGENT_API_KEY || process.env.ANTHROPIC_API_KEY || "";
const ENV_ID = process.env.ENV_ID || process.env.ZINO_AGENT_ENV_ID || "";
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 300_000);

const AGENTS = {
  A: process.env.ZINO_AGENT_A_ID || "agent_01TBZcBWYjQQvbUmmgHCm55i",
  B: process.env.ZINO_AGENT_B_ID || "agent_01MxRs3gzVcUztzi9T9RY2mM",
  C: process.env.ZINO_AGENT_C_ID || "agent_01RxtjwNTz566xXYUkAitL7E",
  D: process.env.ZINO_AGENT_D_ID || "agent_016LbnSe4VpuveKisxwNZSB4"
};
const NAME = { A: "Trip Alignment", B: "Offer Scout", C: "Composer", D: "Packager" };

const USER_MSG =
  process.env.MSG ?? "@bot lên plan Đà Lạt 8-10/8, 4 người, khoảng 3 triệu mỗi đứa";
const ANSWERS = (process.env.ANSWERS ?? "").split("|").filter(Boolean);
const OWNER = { id: "p1", name: "Đông" };
const TRACE = "spike-" + Date.now();

if (!KEY) die("Thiếu ZINO_AGENT_API_KEY");
if (!ENV_ID) die("Thiếu ENV_ID (environment có allow_mcp_servers=true)");

const H = {
  "x-api-key": KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": BETA,
  "content-type": "application/json"
};

const STATUSES = {
  A: ["needs_user_input", "ready_for_scout", "blocked"],
  B: ["needs_source_data", "needs_user_input", "ready_for_composer", "blocked"],
  C: ["options_ready", "blocked"],
  D: ["needs_owner_confirm", "package_ready", "blocked"]
};

const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
const sessions = {};
const timings = [];

/* ------------------------------------------------------------------ */

async function req(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return text;
  }
}

/** Gọi một stage. Tái dùng session nếu stage đó đã có — giống driver thật. */
async function callStage(stage, payload) {
  const started = Date.now();
  if (!sessions[stage]) {
    const s = await req("POST", "/v1/sessions", {
      agent: AGENTS[stage],
      environment_id: ENV_ID,
      title: `Zino ${stage} · ${TRACE}`
    });
    sessions[stage] = s.id;
  }
  const sid = sessions[stage];
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let mcp = 0;
  let tools = 0;
  let out = "";

  try {
    const stream = await fetch(`${API}/v1/sessions/${sid}/events/stream`, {
      headers: { ...H, accept: "text/event-stream" },
      signal: abort.signal
    });
    if (!stream.ok || !stream.body) throw new Error(`stream ${stream.status}`);

    await req("POST", `/v1/sessions/${sid}/events`, {
      events: [{ type: "user.message", content: [{ type: "text", text }] }]
    });

    const reader = stream.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let lastAt = Date.now();
    const hb = setInterval(() => {
      const q = ((Date.now() - lastAt) / 1000).toFixed(0);
      if (Number(q) >= 20) process.stdout.write(`     … ${q}s\r`);
    }, 10_000);

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
        lastAt = Date.now();
        if (ev.type === "agent.message") {
          const txt = Array.isArray(ev.content)
            ? ev.content.map((b) => b?.text ?? "").join("")
            : String(ev.content ?? "");
          if (txt.trim()) out = txt;
        } else if (ev.type === "agent.mcp_tool_use") mcp++;
        else if (ev.type === "agent.tool_use") tools++;
        else if (ev.type === "session.error")
          throw new Error(`session.error ${JSON.stringify(ev).slice(0, 200)}`);
        else if (ev.type === "session.status_idle") break outer;
      }
    }
    clearInterval(hb);
    await reader.cancel().catch(() => {});
  } finally {
    clearTimeout(timer);
  }

  const ms = Date.now() - started;
  timings.push({ stage, ms, mcp, tools, chars: out.length });
  const parsed = parseOut(stage, out);
  console.log(
    `  ${stage} ${NAME[stage]} · ${(ms / 1000).toFixed(1)}s · ${out.length} ký tự` +
      ` · MCP ${mcp} · tool ${tools} → ${parsed?.status ?? "JSON HỎNG"}`
  );
  if (!parsed) {
    console.log("  ─── raw ───\n" + out.slice(0, 1500));
    throw new Error(`Stage ${stage} không trả JSON hợp lệ`);
  }
  if (!STATUSES[stage].includes(parsed.status)) {
    console.log(`  ⚠ status "${parsed.status}" không thuộc [${STATUSES[stage].join(", ")}]`);
  }
  if (parsed.message_to_user === undefined) {
    console.log("  ⚠ THIẾU message_to_user — backend sẽ không gửi được gì cho user");
  }
  if (parsed.message_to_user) {
    console.log("  ┌─ gửi lên Zalo ─────────────────────────────");
    for (const l of String(parsed.message_to_user).split("\n")) console.log("  │ " + l);
    console.log("  └────────────────────────────────────────────");
  }
  return parsed;
}

/* ------------------------------------------------------------------ */

async function main() {
  console.log(`Pipeline spike · trace ${TRACE}`);
  console.log(`Tin nhắn: "${USER_MSG}"\n`);

  /* ---- A, lặp tối đa 4 lượt nếu nó hỏi lại ---- */
  let a = await callStage("A", {
    mode: "group",
    trigger: "bot_mention",
    trace_id: TRACE,
    actor: { ...OWNER, role: "owner" },
    roles: { owner: OWNER.id, payer: null, members: [OWNER.id] },
    user_message: USER_MSG,
    answers: [],
    current_state: {},
    pending_question: null
  });

  let round = 0;
  while (a.status === "needs_user_input" && round < 4) {
    const ans = ANSWERS[round];
    if (!ans) {
      console.log(
        `\n⏸ A còn hỏi. Chạy lại với câu trả lời:\n` +
          `   ANSWERS='<trả lời 1>|<trả lời 2>' node scripts/spike-pipeline.mjs\n`
      );
      return cleanup();
    }
    console.log(`\n  ← trả lời: "${ans}"`);
    a = await callStage("A", ans); // cùng session, A đã giữ ngữ cảnh
    round++;
  }
  if (a.status !== "ready_for_scout") return stop("A", a);

  /* ---- B, retry 1 lần nếu thiếu nguồn ---- */
  console.log("");
  let b = await callStage("B", {
    alignment_result: a,
    trace_id: TRACE,
    reference_date: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }),
    source_inputs: [],
    parsed_offers: []
  });

  if (b.status === "needs_source_data") {
    console.log("  ← nhắc B tự dùng công cụ (giống buildScoutNudge trong backend)");
    b = await callStage(
      "B",
      "Không có source_inputs từ bên ngoài và sẽ không có. Hãy TỰ lấy dữ liệu " +
        "bằng công cụ của bạn (MCP booking, web_search) để lấp unfilled_slots. " +
        "Lấy được bao nhiêu trả bấy nhiêu. Trả đúng JSON schema như trước."
    );
  }
  if (b.status !== "ready_for_composer") return stop("B", b);

  const offers = Array.isArray(b.offers) ? b.offers : [];
  console.log(`  → ${offers.length} offer, tier: ${JSON.stringify(tierCount(offers))}`);

  /* ---- C ---- */
  console.log("");
  const c = await callStage("C", {
    alignment_result: a,
    sourcing_result: b,
    trace_id: TRACE,
    geo_matrix: {},
    n_variants: 3
  });
  if (c.status !== "options_ready") return stop("C", c);

  const variants = Array.isArray(c.variants) ? c.variants : [];
  console.log(`  → ${variants.length} variant: ${variants.map(candId).join(", ")}`);
  checkBudget(a, variants);

  /* ---- D ---- */
  const pick = candId(variants[0]);
  console.log(`\n  ← owner chọn "${pick}"`);
  const d = await callStage("D", {
    reference_time: new Date().toISOString(),
    mode: "group",
    trace_id: TRACE,
    selection: { candidate_id: pick, selected_by: OWNER.id, selected_by_role: "owner" },
    sourcing_result: b,
    planning_result: c,
    policy: {
      dry_run: true,
      max_money_at_risk: 0,
      per_action_cap: null,
      allowed_action_types: [
        "send_inquiry",
        "prefill_booking",
        "share_for_approval",
        "add_to_calendar"
      ],
      roles: { owner: OWNER.id, payer: OWNER.id }
    }
  });

  const cards = d.package?.cards;
  console.log(`  → ${Array.isArray(cards) ? cards.length : 0} card`);

  summary();
  await cleanup();
}

/* ------------------------------------------------------------------ */

function candId(v) {
  return v?.candidate_id ?? v?.id ?? "?";
}

function tierCount(offers) {
  const m = {};
  for (const o of offers) m[o?.channel_tier ?? "?"] = (m[o?.channel_tier ?? "?"] ?? 0) + 1;
  return m;
}

/**
 * B trả price.unit = "per_trip" cho 2 phòng 2 đêm. Nếu C đọc nhầm thành
 * per_person thì tổng chi phí lệch 4 lần — kiểm thô bằng cách so tổng của
 * variant với ngân sách trong brief.
 */
function checkBudget(a, variants) {
  const perPerson = a?.brief?.budget_per_person_vnd;
  const pax = a?.brief?.pax;
  if (!perPerson || !pax) return;
  const budget = perPerson * pax;
  for (const v of variants) {
    const total = v?.total_cost?.amount ?? v?.total_estimated_cost ?? v?.total_cost;
    if (typeof total !== "number") continue;
    const ratio = total / budget;
    const flag = ratio > 1.5 || ratio < 0.2 ? "  ⚠ LỆCH NGƯỠNG — kiểm price.unit" : "";
    console.log(
      `     ${candId(v)}: ${total.toLocaleString("vi-VN")}₫ / ngân sách ` +
        `${budget.toLocaleString("vi-VN")}₫ (${(ratio * 100).toFixed(0)}%)${flag}`
    );
  }
}

function summary() {
  console.log("\n═══ Tổng kết ═══");
  let total = 0;
  for (const t of timings) {
    total += t.ms;
    console.log(
      `  ${t.stage} ${NAME[t.stage].padEnd(16)} ${(t.ms / 1000).toFixed(1).padStart(6)}s` +
        `  ${String(t.chars).padStart(6)} ký tự  MCP ${t.mcp}`
    );
  }
  const wait = timings.filter((t) => ["A", "B", "C"].includes(t.stage)).reduce((s, t) => s + t.ms, 0);
  console.log(`  ${"".padEnd(18)} ${"─".repeat(7)}`);
  console.log(`  tổng cả 4 stage    ${(total / 1000).toFixed(1).padStart(6)}s`);
  console.log(
    `  NHÓM ZALO PHẢI CHỜ ${(wait / 1000).toFixed(1).padStart(6)}s  ← A+B+C, từ lúc nhờ tới lúc thấy phương án`
  );
  if (wait > 120_000) console.log("  ⚠ Quá 2 phút. Giảm effort của agent, cắt số offer/variant.");
}

function stop(stage, out) {
  console.log(`\n⏹ Dừng ở ${stage}: status=${out.status}`);
  return summary(), cleanup();
}

async function cleanup() {
  for (const id of Object.values(sessions)) {
    await req("DELETE", `/v1/sessions/${id}`).catch(() => {});
  }
  console.log(`\nĐã xoá ${Object.keys(sessions).length} session.`);
}

function parseOut(stage, s) {
  const t = String(s).trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  for (const cand of [t, t.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], a >= 0 && b > a ? t.slice(a, b + 1) : null]) {
    if (!cand) continue;
    try {
      const v = JSON.parse(cand.trim());
      if (v && typeof v === "object") return v;
    } catch {}
  }
  return null;
}

function die(m) {
  console.error("✗ " + m);
  process.exit(1);
}

main().catch(async (e) => {
  console.error("\n✗ " + e.message);
  summary();
  console.error("\nSession còn sống (không xoá để bạn đọc lại):");
  for (const [k, v] of Object.entries(sessions)) console.error(`  ${k}: ${v}`);
  process.exit(1);
});

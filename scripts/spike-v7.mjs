#!/usr/bin/env node
/**
 *  spike-v7.mjs — chạy thử hệ ba agent v7: Intake → (deliver | Brain → Finalizer).
 *
 *  Dùng ĐÚNG contract mà v7.service.ts dùng, nên kết quả ở đây dự đoán được
 *  hành vi khi bật ZINO_V7_ENABLED=1. Khác biệt duy nhất: không đụng Postgres,
 *  không gửi Zalo.
 *
 *  Bốn câu hỏi cần trả lời TRƯỚC khi bật cờ:
 *    1. Ba agent có tuân thủ contract {status, route.target, message_to_user}?
 *    2. Cổng Brain (§6.9) có được Intake tôn trọng — 5 điều kiện đủ cả?
 *    3. Intake có TỪ CHỐI "ok làm đi" và chỉ nhận đúng "BẮT ĐẦU RESEARCH"?
 *    4. Brain mất bao lâu? → quyết định ZINO_BRAIN_TIMEOUT_MS
 *
 *  Dùng:
 *      export ZINO_AGENT_API_KEY='sk-ant-...'
 *      export ENV_ID='env_01...'
 *      export ZINO_AGENT_INTAKE_ID=agent_... ZINO_AGENT_BRAIN_ID=agent_... \
 *             ZINO_AGENT_FINALIZER_ID=agent_...
 *      node scripts/spike-v7.mjs
 *
 *      # kịch bản riêng, mỗi lượt ngăn bằng |
 *      MSGS='Bali mùa hè|Lên plan Bali cho 4 người|TP.HCM, 3 ngày 2 đêm, ngân sách cân bằng|ok làm đi|BẮT ĐẦU RESEARCH' \
 *        node scripts/spike-v7.mjs
 *
 *  Mỗi lượt tốn tiền thật. Chạy có chủ đích.
 */

const API = process.env.ANTHROPIC_API_BASE ?? "https://api.anthropic.com";
const BETA = process.env.ZINO_MANAGED_AGENTS_BETA ?? "managed-agents-2026-04-01";
const KEY = process.env.ZINO_AGENT_API_KEY || process.env.ANTHROPIC_API_KEY || "";
const ENV_ID = process.env.ENV_ID || process.env.ZINO_AGENT_ENV_ID || "";

const AGENTS = {
  INTAKE: process.env.ZINO_AGENT_INTAKE_ID || "",
  BRAIN: process.env.ZINO_AGENT_BRAIN_ID || "",
  FINALIZER: process.env.ZINO_AGENT_FINALIZER_ID || ""
};
const TIMEOUT = { INTAKE: 60_000, BRAIN: 600_000, FINALIZER: 120_000 };

/** Kịch bản mặc định = 5 case quan trọng nhất trong §12 */
const MSGS = (
  process.env.MSGS ??
  [
    "Bali mùa hè", // §9.1 ambiguous seed → KHÔNG được gọi Brain
    "Lên plan Bali cho 4 người", // §9.3 thiếu blocker → hỏi lại
    "Từ TP.HCM, 3 ngày 2 đêm, ngân sách cân bằng", // §9.4 đủ brief → xin trigger
    "ok làm đi", // §9.6 PHẢI bị từ chối
    "BẮT ĐẦU RESEARCH" // §9.5 → Brain + Finalizer
  ].join("|")
)
  .split("|")
  .filter(Boolean);

const ACTOR = { id: "p1", name: "Đông", role: null };
const STATUSES = {
  INTAKE: [
    "delivered",
    "gathering",
    "brainstorming",
    "awaiting_owner_confirmation",
    "ready_for_brain",
    "cancelled",
    "blocked"
  ],
  BRAIN: ["needs_user_input", "ready_for_finalizer", "blocked"],
  FINALIZER: ["ready", "blocked"]
};

for (const [k, v] of Object.entries(AGENTS)) if (!v) die(`Thiếu ZINO_AGENT_${k}_ID`);
if (!KEY) die("Thiếu ZINO_AGENT_API_KEY");
if (!ENV_ID) die("Thiếu ENV_ID");

const H = {
  "x-api-key": KEY,
  "anthropic-version": "2023-06-01",
  "anthropic-beta": BETA,
  "content-type": "application/json"
};

const sessions = {};
const timings = [];
let thinState = {};
let brainRuns = 0;

/* ------------------------------------------------------------------ */

async function req(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: H,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const t = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${t.slice(0, 300)}`);
  try {
    return t ? JSON.parse(t) : {};
  } catch {
    return t;
  }
}

async function callAgent(agent, payload) {
  const started = Date.now();
  // Giống driver thật: BRAIN luôn session mới, hai con kia tái dùng
  const reuse = agent === "BRAIN" ? null : sessions[agent];
  const sid =
    reuse ??
    (await req("POST", "/v1/sessions", {
      agent: AGENTS[agent],
      environment_id: ENV_ID,
      title: `spike-v7 ${agent}`
    }).then((s) => s.id));
  sessions[agent] = sid;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT[agent]);
  let out = "";
  let tools = 0;

  try {
    const stream = await fetch(`${API}/v1/sessions/${sid}/events/stream`, {
      headers: { ...H, accept: "text/event-stream" },
      signal: abort.signal
    });
    if (!stream.ok || !stream.body) throw new Error(`stream ${stream.status}`);

    await req("POST", `/v1/sessions/${sid}/events`, {
      events: [{ type: "user.message", content: [{ type: "text", text: JSON.stringify(payload) }] }]
    });

    const reader = stream.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let lastAt = Date.now();
    const hb = setInterval(() => {
      const q = ((Date.now() - lastAt) / 1000).toFixed(0);
      if (Number(q) >= 20) process.stdout.write(`      … ${agent} ${q}s\r`);
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
        } else if (ev.type === "agent.tool_use" || ev.type === "agent.mcp_tool_use") tools++;
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
  timings.push({ agent, ms, tools });
  const parsed = parse(out);
  console.log(
    `    ${agent.padEnd(9)} ${(ms / 1000).toFixed(1).padStart(6)}s · tool ${tools} → ` +
      (parsed?.status ?? "JSON HỎNG")
  );
  if (!parsed) {
    console.log("    ─── raw ───\n" + out.slice(0, 1200));
    throw new Error(`${agent} không trả JSON`);
  }
  if (!STATUSES[agent].includes(parsed.status)) {
    console.log(`    ⚠ status "${parsed.status}" ngoài enum [${STATUSES[agent].join(", ")}]`);
  }
  return parsed;
}

/* ------------------------------------------------------------------ */

async function main() {
  console.log("Spike v7 · 3 agent · " + MSGS.length + " lượt\n");

  for (const [i, msg] of MSGS.entries()) {
    console.log(`\n━━━ Lượt ${i + 1}: "${msg}"`);

    const intake = await callAgent("INTAKE", {
      user_message: msg,
      reference_time: new Date().toISOString(),
      actor: ACTOR,
      thin_state: thinState
    });

    thinState = merge(thinState, intake.state_patch);

    // Kiểm cổng Brain đúng như validateIntake trong backend (§6.9)
    const target = intake.route?.target;
    const h = intake.handoff ?? {};
    if (target === "deliver") {
      if (typeof intake.message_to_user !== "string" || !intake.message_to_user.trim()) {
        console.log("    ⛔ deliver nhưng message_to_user rỗng — backend sẽ chặn");
      } else say(intake.message_to_user);
      continue;
    }
    if (target !== "brain") {
      console.log(`    ⛔ route.target lạ: ${JSON.stringify(target)}`);
      continue;
    }

    const gate = [
      [intake.message_to_user === null, "message_to_user phải null"],
      [h.brief_complete === true, "brief_complete"],
      [Array.isArray(h.missing_blockers) && h.missing_blockers.length === 0, "missing_blockers=[]"],
      [h.owner_confirmation === "confirmed", "owner_confirmation=confirmed"],
      [typeof h.scope_summary === "string" && h.scope_summary.trim(), "scope_summary"]
    ].filter(([ok]) => !ok);
    if (gate.length) {
      console.log("    ⛔ CỔNG BRAIN HỞ: " + gate.map(([, m]) => m).join(", "));
      console.log("       backend sẽ ném V7ValidationError và gửi tin fallback");
      continue;
    }

    console.log("    ✓ cổng Brain đủ 5 điều kiện");
    brainRuns++;
    const brain = await callAgent("BRAIN", { intake_result: intake, thin_state: thinState });
    thinState = merge(thinState, brain.state_patch);
    for (const f of ["draft_message_to_user", "evidence", "quality"]) {
      if (brain[f] === undefined) console.log(`    ⚠ Brain thiếu \`${f}\` — backend sẽ chặn`);
    }

    const fin = await callAgent("FINALIZER", { brain_result: brain });
    thinState = merge(thinState, fin.state_patch);
    if (!fin.reply_contract) console.log("    ⚠ Finalizer thiếu `reply_contract` — backend sẽ chặn");
    say(fin.message_to_user);
  }

  console.log("\n═══ Tổng kết ═══");
  for (const t of timings) {
    console.log(`  ${t.agent.padEnd(9)} ${(t.ms / 1000).toFixed(1).padStart(6)}s · tool ${t.tools}`);
  }
  const brainMs = timings.filter((t) => t.agent === "BRAIN").map((t) => t.ms);
  if (brainMs.length) {
    const worst = Math.max(...brainMs);
    console.log(`\n  Brain lâu nhất: ${(worst / 1000).toFixed(1)}s`);
    console.log(`  → đặt ZINO_BRAIN_TIMEOUT_MS=${Math.ceil((worst * 2) / 10000) * 10000}`);
  }
  console.log(`  Số lần Brain chạy: ${brainRuns}/${MSGS.length} lượt`);
  if (brainRuns > 1) {
    console.log("  ⚠ Brain chạy nhiều hơn một lần — kiểm lại xem Intake có gọi oan không (§2.3)");
  }

  console.log("\n═══ thin_state cuối ═══");
  console.log(JSON.stringify(thinState, null, 2).slice(0, 2500));

  for (const id of Object.values(sessions)) await req("DELETE", `/v1/sessions/${id}`).catch(() => {});
  console.log(`\nĐã xoá ${Object.keys(sessions).length} session.`);
}

/* ------------------------------------------------------------------ */

function say(msg) {
  if (!msg) return;
  console.log("    ┌─ Zalo ─────────────────────────────");
  for (const l of String(msg).split("\n")) console.log("    │ " + l);
  console.log("    └────────────────────────────────────");
  if (String(msg).length > 2000) console.log(`    ⚠ ${msg.length} ký tự — sẽ bị cắt thành nhiều tin`);
}

/** Giống applyStatePatch trong backend: object đệ quy, array thay thế, null xoá */
function merge(cur, patch) {
  const obj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  const base = obj(cur) ? cur : {};
  if (!obj(patch)) return { ...base };
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else if (Array.isArray(v)) out[k] = v;
    else if (obj(v)) out[k] = merge(obj(out[k]) ? out[k] : {}, v);
    else out[k] = v;
  }
  return out;
}

function parse(s) {
  const t = String(s).trim();
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  for (const c of [t, t.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], a >= 0 && b > a ? t.slice(a, b + 1) : null]) {
    if (!c) continue;
    try {
      const v = JSON.parse(c.trim());
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
  console.error("Session còn sống:", JSON.stringify(sessions));
  process.exit(1);
});

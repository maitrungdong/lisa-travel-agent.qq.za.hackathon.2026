const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));

const rapid = read("1_IMPORT_FIRST_RAPID_BRAIN.json");
const expert = read("2_IMPORT_SECOND_RESEARCH_BRAIN.json");
const outcome = read("3_REPLACE_BRAIN_IDS_THEN_IMPORT_OUTCOME_AGENT.json");
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};
const customNames = (agent) =>
  agent.tools.filter((tool) => tool.type === "custom").map((tool) => tool.name);
const sorted = (items) => [...items].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

assert(rapid.name === "v4_rapid_brain", "Rapid name mismatch");
assert(rapid.model?.id === "claude-sonnet-5", "Rapid must use Sonnet");
assert(rapid.model?.effort === "low", "Rapid effort must be low");
assert(rapid.system.length < 6000, "Rapid prompt must stay below 6k chars");
assert(
  same(customNames(rapid), ["search_partner_oa"]),
  "Rapid must expose only search_partner_oa as custom tool"
);
assert(
  /SOURCE ROUTER — MỘT NGUỒN CHO MỘT MỤC ĐÍCH/.test(rapid.system) &&
    /ACTIONABILITY GATE/.test(rapid.system) &&
    /hard cap 750/.test(rapid.system),
  "Rapid speed/currentness contract missing"
);
assert(
  /CONTEXTUAL TRIO/.test(rapid.system) &&
    /hero_moment/.test(rapid.system) &&
    /không bịa option thứ ba/.test(rapid.system),
  "Rapid contextual diversity contract missing"
);

assert(expert.name === "v4_research_brain", "Expert name mismatch");
assert(expert.model?.id === "claude-opus-5", "Expert model changed");
assert(expert.model?.effort === "low", "Expert effort must be low");
assert(expert.system.length < 8500, "Expert prompt must stay below 8.5k chars");
assert(
  same(customNames(expert), ["search_partner_oa"]),
  "Expert must expose only search_partner_oa as custom tool"
);
assert(
  /WHOLE-TRIP BUDGET/.test(expert.system) &&
    /mandatory reserve/.test(expert.system) &&
    /Unknown không bằng 0/.test(expert.system),
  "Expert budget harness missing"
);
assert(
  /VIABILITY FIRST/.test(expert.system) &&
    /Listing tồn tại ≠ còn chỗ/.test(expert.system),
  "Expert feasibility harness missing"
);

const expectedOutcomeTools = [
  "create_trip",
  "add_event",
  "set_reminder",
  "update_trip_status",
  "add_expense",
  "list_expenses",
  "settle_expenses",
  "draft_oa_inquiry",
  "propose_options",
  "request_deep_plan",
  "request_recap"
];

assert(outcome.name === "v4_outcome_agent", "Outcome name mismatch");
assert(outcome.model?.id === "claude-sonnet-5", "Outcome must use Sonnet");
assert(outcome.model?.effort === "low", "Outcome effort must be low");
assert(outcome.system.length < 14000, "Outcome prompt must stay below 14k chars");
assert(
  same(customNames(outcome), expectedOutcomeTools),
  "Outcome custom-tool allowlist mismatch"
);
assert(
  !customNames(outcome).includes("get_trip_state") &&
    !customNames(outcome).includes("remember") &&
    !customNames(outcome).includes("recall") &&
    !customNames(outcome).includes("reply"),
  "Noisy/duplicative tools leaked into Outcome"
);
assert(
  outcome.multiagent?.agents?.length === 2 &&
    outcome.multiagent.agents[0] ===
      "PASTE_RAPID_BRAIN_AGENT_ID_HERE" &&
    outcome.multiagent.agents[1] ===
      "PASTE_RESEARCH_BRAIN_AGENT_ID_HERE",
  "Brain placeholders mismatch"
);

const uxChecks = [
  ["CONTINUITY-FIRST", /CONTINUITY-FIRST/],
  ["ONE DECISION", /ONE DECISION/],
  ["AUTOPILOT", /AUTOPILOT/],
  ["CONTEXTUAL TRIO", /CONTEXTUAL TRIO/],
  ["FACT LOCK", /FACT LOCK/],
  ["GROUP CONTROL", /GROUP CONTROL/],
  ["SIDE BRANCH", /SIDE BRANCH/],
  ["NO DEBUG", /NO DEBUG/],
  ["ACTION BOUNDARY", /ACTION BOUNDARY/],
  ["MOMENTUM", /MOMENTUM/],
  ["Context Lite", /ZINO_CONTEXT_LITE_V2/],
  ["one Brain", /Một user turn gọi tối đa một Brain/],
  ["background deep", /request_deep_plan/],
  ["action gate", /clear user intent/],
  ["Zalo length", /dưới 2\.000 ký tự/]
];

for (const [label, pattern] of uxChecks) {
  assert(pattern.test(outcome.system), `Outcome UX harness missing: ${label}`);
}

assert(
  /Không gửi full transcript, full state/.test(outcome.system) &&
    /Partner discovery do Rapid tự gọi/.test(outcome.system),
  "Micro-context regression guard missing"
);
assert(
  /Mặc định tối đa một custom DB tool\/lượt/.test(outcome.system) &&
    /text selection là mặc định nhanh hơn/.test(outcome.system),
  "Custom-tool latency budget missing"
);
assert(
  /plain text tiếng Việt/.test(outcome.system) &&
    /Không trả JSON/.test(outcome.system),
  "Plain-text output contract missing"
);

const staticChars = (agent) =>
  agent.system.length +
  JSON.stringify(agent.tools).length;

assert(
  staticChars(outcome) < 23000,
  `Outcome static prompt+tools too large: ${staticChars(outcome)}`
);
assert(
  staticChars(rapid) < 8500,
  `Rapid static prompt+tools too large: ${staticChars(rapid)}`
);
assert(
  staticChars(expert) < 11000,
  `Expert static prompt+tools too large: ${staticChars(expert)}`
);

if (failures.length) {
  failures.forEach((failure) => console.error(`FAIL: ${failure}`));
  process.exit(1);
}

console.log("R4.2 validation passed.");
console.log(
  JSON.stringify(
    {
      prompt_chars: {
        outcome: outcome.system.length,
        rapid: rapid.system.length,
        expert: expert.system.length
      },
      custom_tool_counts: {
        outcome: customNames(outcome).length,
        rapid: customNames(rapid).length,
        expert: customNames(expert).length
      },
      static_chars_prompt_plus_tools: {
        outcome: staticChars(outcome),
        rapid: staticChars(rapid),
        expert: staticChars(expert)
      }
    },
    null,
    2
  )
);

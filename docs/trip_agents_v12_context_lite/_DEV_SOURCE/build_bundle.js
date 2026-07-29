const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const workspace = path.resolve(root, "..");
const r41RapidPath = path.join(
  workspace,
  "trip_agents_v11_agent_only",
  "1_IMPORT_FIRST_RAPID_BRAIN.json"
);
const backendToolsPath = path.join(workspace, "upload", "v1-tools.json");

const rapidTemplate = JSON.parse(fs.readFileSync(r41RapidPath, "utf8"));
const backendTools = JSON.parse(fs.readFileSync(backendToolsPath, "utf8"));
const builtInResearchToolset = rapidTemplate.tools.find(
  (tool) => tool.type === "agent_toolset_20260401"
);

function customTool(name) {
  const source = backendTools.find((tool) => tool.name === name);
  if (!source) throw new Error(`Missing backend tool: ${name}`);
  return { type: "custom", ...source };
}

function prompt(file) {
  return fs.readFileSync(path.join(__dirname, file), "utf8").trim();
}

const researchCustomTools = ["search_partner_oa"];
const outcomeCustomTools = [
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

const rapid = {
  name: "v4_rapid_brain",
  description:
    "R4.2 fast decision sub-agent: micro-brief, contextual options, one-source discovery, fatal-viability-first.",
  model: { id: "claude-sonnet-5", effort: "low" },
  system: prompt("02_rapid_brain.prompt.md"),
  mcp_servers: [],
  tools: [
    builtInResearchToolset,
    ...researchCustomTools.map(customTool)
  ],
  skills: []
};

const expert = {
  name: "v4_research_brain",
  description:
    "R4.2 expert decision sub-agent: bounded context, whole-trip budget, linked constraints and source-efficient deep research.",
  model: { id: "claude-opus-5", effort: "low" },
  system: prompt("03_expert_brain.prompt.md"),
  mcp_servers: [],
  tools: [
    builtInResearchToolset,
    ...researchCustomTools.map(customTool)
  ],
  skills: []
};

const outcome = {
  name: "v4_outcome_agent",
  description:
    "R4.2 Zino entry agent: compact UX kernel, Context Lite, selective DB actions, background deep planning and natural Zalo delivery.",
  model: { id: "claude-sonnet-5", effort: "low" },
  system: prompt("01_outcome_agent.prompt.md"),
  mcp_servers: [],
  tools: outcomeCustomTools.map(customTool),
  skills: [],
  multiagent: {
    type: "coordinator",
    agents: [
      "PASTE_RAPID_BRAIN_AGENT_ID_HERE",
      "PASTE_RESEARCH_BRAIN_AGENT_ID_HERE"
    ]
  }
};

const files = [
  ["1_IMPORT_FIRST_RAPID_BRAIN.json", rapid],
  ["2_IMPORT_SECOND_RESEARCH_BRAIN.json", expert],
  ["3_REPLACE_BRAIN_IDS_THEN_IMPORT_OUTCOME_AGENT.json", outcome]
];

for (const [name, config] of files) {
  fs.writeFileSync(
    path.join(root, name),
    JSON.stringify(config, null, 2) + "\n"
  );
}

console.log("Built R4.2 agent configs.");

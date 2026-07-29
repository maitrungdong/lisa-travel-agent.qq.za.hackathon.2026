# Zino v4 Agent-only R4.2

R4.2 compacts all three system prompts, preserves the R4.1 UX harness, adds
bounded Context Lite and exposes only task-relevant backend tools.

## Import order

1. Import `1_IMPORT_FIRST_RAPID_BRAIN.json` as `v4_rapid_brain`.
2. Copy the new Rapid Agent ID.
3. Import `2_IMPORT_SECOND_RESEARCH_BRAIN.json` as `v4_research_brain`.
4. Copy the new Expert Agent ID.
5. Replace both placeholders in
   `3_REPLACE_BRAIN_IDS_THEN_IMPORT_OUTCOME_AGENT.json`.
6. Import Outcome last and configure the backend to call only its Agent ID.

## What changed

- Outcome prompt: accumulated framework text → compact UX Kernel.
- Expert prompt: legacy base plus overrides → one standalone contract.
- Rapid: one-source discovery and `search_partner_oa`.
- Outcome: 11 selected custom tools, not all 21.
- Deep planning: background `request_deep_plan` is preferred when synchronous
  Expert waiting is unnecessary.
- Backend context: `ZINO_CONTEXT_LITE_V2`; V1 remains accepted.

## Release status

- Static validation and JSON/ZIP integrity can be checked locally.
- R4.1 remains the rollback release.
- Runtime latency and behavioral benchmark are still required after import.

See:

- `BACKEND_HANDOFF_R4_2.md`
- `_DEV_SOURCE/UX_HARNESS_CHECKSUM.md`
- `_DEV_SOURCE/ACCEPTANCE_TESTS.md`

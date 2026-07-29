# R4.2 prompt and tool audit

## Outcome

R4.2 does not optimize by deleting UX behavior. It moves repeated examples and
framework explanations out of runtime prompts and keeps a compact executable
kernel.

| Agent | R4.1 prompt chars | R4.2 prompt chars | Change |
|---|---:|---:|---:|
| Outcome | 35,811 | 11,423 | -68.1% |
| Rapid | 6,552 | 5,189 | -20.8% |
| Expert | 27,398 | 7,180 | -73.8% |

R4.2 static prompt plus tool-schema size:

| Agent | Custom tools | Prompt + all tool schemas |
|---|---:|---:|
| Outcome | 11 | 19,251 chars |
| Rapid | 1 | 6,152 chars |
| Expert | 1 | 8,143 chars |

Even after adding selected backend capabilities, Outcome's static instruction
surface is about 46% smaller than its R4.1 prompt alone.

## What was removed from runtime prompts

- repeated prose explaining the same continuity/group/autopilot behavior;
- legacy base Brain schema plus multiple override layers;
- examples already covered by acceptance tests;
- full business directory/context handling;
- large quality/progress/state structures not needed by Rapid;
- full 21-tool catalog and duplicate memory/read/reply tools.

## What remains protected

The release gate retains 16 invariants:

- continuity and no repeated questions;
- one current decision;
- minimum blockers and Autopilot;
- contextual option diversity;
- opinionated recommendation;
- fact lock and no debug leakage;
- group control and side-branch return;
- write/action authorization;
- whole-trip budget;
- fatal viability before price;
- Zalo-native compact output;
- source/tool restraint.

The full checksum is in `_DEV_SOURCE/UX_HARNESS_CHECKSUM.md`; 30 acceptance tests
cover the concrete cases.

## Tool strategy

- Rapid/Expert see only `search_partner_oa` in addition to built-in research
  tools.
- Outcome sees 11 operational tools selected for the demo path.
- Context Lite replaces frequent `get_trip_state`, `recall` and
  `check_decision` calls.
- Partner OA lookup replaces web discovery for the same purpose.
- Text selection remains the fast default; `propose_options` is opt-in for a
  real group vote.
- Deep work defaults to `request_deep_plan` in the background; synchronous
  Expert is reserved for cases that genuinely need an immediate answer.

## Remaining runtime risks

Static validation cannot prove latency or model behavior. Before promoting:

1. confirm custom-tool events from child Brain sessions reach the existing
   backend handler;
2. confirm Context Lite is injected once and deltas do not duplicate history;
3. benchmark stable inspiration, OA discovery, airport closure, budget
   objection, vote card and background deep planning;
4. keep R4.1 as rollback until all critical tests pass.

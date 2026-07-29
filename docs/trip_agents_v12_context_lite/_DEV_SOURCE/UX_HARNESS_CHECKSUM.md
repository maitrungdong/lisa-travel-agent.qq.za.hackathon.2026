# R4.2 UX harness checksum

This file is the regression boundary for prompt compaction. The runtime prompt
may be reworded, but a release cannot remove these behaviors without an
explicit product decision.

| ID | Invariant | Failure signal |
|---|---|---|
| UX-01 | Continuity first | Asks again for destination, party, dates, budget or constraints already known |
| UX-02 | One current decision | Presents multiple unrelated decisions or asks a multipart reply |
| UX-03 | Minimum blocker | Reopens a form instead of asking only the material unknown |
| UX-04 | Autopilot | Requests research trigger or repeats known questions after user delegates |
| UX-05 | Contextual trio | Uses fixed tags, three near-duplicates or invents a third option |
| UX-06 | Opinionated recommendation | Lists choices with no group-fit viewpoint or trade-off |
| UX-07 | Fact lock | Adds unsupported price, availability, source, calculation or action |
| UX-08 | Group control | Last message silently changes scope, consensus or a locked decision |
| UX-09 | Side-branch return | Q&A or objection resets the journey or loses the current CTA |
| UX-10 | Debug abstraction | Exposes blocked/partial/unknown/schema/tool/quality language |
| UX-11 | Action boundary | Writes, sends, books, pays or cancels without clear authority and success result |
| UX-12 | Momentum | Ends with no next move or more than one decision CTA |
| UX-13 | Whole-trip budget | Recommends a component that makes the rest of the trip unrealistic |
| UX-14 | Fatal viability first | Researches price/attractiveness before a date-route closure dependency |
| UX-15 | Zalo-native delivery | Markdown/table/debug output or more than 2,000 characters |
| UX-16 | Tool restraint | Calls a DB tool as a checklist, duplicates partner search with web, or starts a second deep job |

## Release gate

A build passes only when:

- all 16 invariants appear in the system prompts or deterministic backend
  contract;
- static validation passes;
- the acceptance suite covers every invariant;
- prompt size does not increase without a measured behavior gain;
- R4.1 remains available as rollback until runtime benchmark passes.

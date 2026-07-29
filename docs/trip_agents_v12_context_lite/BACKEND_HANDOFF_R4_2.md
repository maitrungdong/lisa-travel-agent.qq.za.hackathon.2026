# Backend handoff — R4.2 Context Lite and selective tools

## 1. I/O remains unchanged

The public backend contract is still:

```text
raw UTF-8 user text
→ v4_outcome_agent
→ plain UTF-8 Zalo text
```

No JSON response parser, UI renderer or backend routing between Brains is
required. Keep one managed-agent session per journey and at most one active run
per conversation.

The backend already has the custom-tool result loop used by v1. R4.2 reuses it.

## 2. Context Lite V2

At the first turn, prepend:

```text
<<<ZINO_CONTEXT_LITE_V2>>>
{
  "context_version": "trip_123:17",
  "generated_at": "2026-07-29T17:00:00+07:00",
  "trip_core": {
    "name": "Nha Trang cuối tuần",
    "destination": "Nha Trang",
    "dates": "2026-08-15/2026-08-16",
    "party": 7,
    "budget_total": 35000000,
    "status": "planning",
    "next_event": null,
    "expense_total": 0
  },
  "confirmed_choices": [],
  "current_decision": {
    "title": "Chọn phương tiện",
    "status": "open",
    "options": [],
    "vote_summary": null
  },
  "relevant_memories": [
    {"fact": "Nhóm ưu tiên hoạt động vui chung", "kind": "preference"}
  ],
  "relevant_updates": [],
  "pending_job": null
}
<<<END_ZINO_CONTEXT_LITE_V2>>>
<<<USER_MESSAGE>>>
...
```

Bounds:

- `confirmed_choices`: at most 5;
- `current_decision.options`: at most 4, no full vote history;
- `relevant_memories`: at most 5, hard constraint before preference;
- `relevant_updates`: at most 3, each with source/date if available;
- no full events, expenses, notes, photos, old trips or partner directory.

If the context version has not changed, do not prepend the same snapshot again
to an existing session.

When DB state changes outside the agent session, prepend only:

```text
<<<ZINO_CONTEXT_DELTA_V2>>>
{
  "base_context_version": "trip_123:17",
  "context_version": "trip_123:18",
  "changes": [
    {"type": "expense_added", "expense_total": 850000}
  ]
}
<<<END_ZINO_CONTEXT_DELTA_V2>>>
<<<USER_MESSAGE>>>
...
```

The V1 marker remains supported during migration.

## 3. Tool exposure

Rapid and Expert:

- built-in `web_search`, `web_fetch`, `bash`;
- custom `search_partner_oa`.

Outcome only:

- `create_trip`
- `add_event`
- `set_reminder`
- `update_trip_status`
- `add_expense`
- `list_expenses`
- `settle_expenses`
- `draft_oa_inquiry`
- `propose_options`
- `request_deep_plan`
- `request_recap`

Intentionally not exposed:

- `get_trip_state`: Context Lite replaces frequent full-state reads;
- `check_decision`: current decision/vote summary belongs in Context Lite;
- `remember`, `recall`: the existing memory job is the single writer/reader;
- `reply`: conflicts with the one plain-text response contract;
- `list_trips`, `add_member`, `add_note`, `add_photo`: useful later, but not
  worth permanent tool-selection noise in the planning/demo path.

Do not expose all 21 tools to all agents.

## 4. Tool budget and authorization

- Normal turn: at most one custom DB tool.
- Rapid/Expert partner discovery replaces a web discovery call; it is not an
  extra lookup.
- `propose_options` is used only when the group asks for a vote card or a real
  group conflict requires voting. Plain text is the fast default.
- Every write handler must validate required fields, active trip and actor
  authorization server-side.
- Use an idempotency key derived from conversation/session + turn +
  `custom_tool_use_id`.
- Tool success should return a compact `state_delta` and `context_version` when
  possible. Do not make the model call `get_trip_state` afterward.
- A failed tool result must be explicit enough that the agent does not claim
  success.

Research consent is not authorization to write, send, book, pay or cancel.

## 5. Background deep planning

R4.2 uses the existing schema:

```json
{
  "name": "request_deep_plan",
  "input": {
    "focus": "bounded natural-language task"
  }
}
```

After this call succeeds, Outcome ends the turn. The job pushes its result later.
Do not keep the managed-agent run waiting and do not run synchronous Expert in
parallel.

Recommended backend follow-up, not required for importing R4.2:

```json
{
  "task": "string",
  "brief": {},
  "constraints": [],
  "confirmed_choices": [],
  "context_version": "string"
}
```

Only adopt the richer schema after the handler supports it; the R4.2 JSON uses
the current production `focus` schema.

## 6. Partner OA semantics

`search_partner_oa` is discovery:

- it proves an OA identity/contact exists in the Zino network;
- it does not prove price, quality, current operation or availability;
- the Brain must not web-search again for the same discovery purpose;
- for a fatal route/closure dependency, official web currentness takes
  priority;
- preserve `oa_id` so Outcome can call `draft_oa_inquiry` after selection.

## 7. Runtime benchmark

Capture per test turn:

- Outcome route time;
- Brain/custom-tool time;
- Outcome render time;
- total time;
- input/output token;
- number and type of source/tool calls;
- UX checksum failures.

Targets:

- stable/no-tool conversation: 5–15 seconds;
- one DB read/write: 8–20 seconds;
- Rapid with one source: 15–40 seconds;
- deep task acknowledgement: 5–15 seconds;
- background result: approximately 60 seconds.

These are targets, not validated runtime results. R4.1 remains the rollback until
the R4.2 benchmark passes.

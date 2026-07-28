Full flow và input/output — 4-agent version

1. Flow

flowchart TD
    T["DM / @bot / reply / UI action"] --> A["A. Trip Alignment"]
    A -->|ready_for_scout| B["B. Offer Scout"]
    B -->|ready_for_composer| C["C. Itinerary Composer"]
    C -->|options_ready| U["Owner chọn candidate"]
    U --> D["D. Action Packager"]

Không agent nào gọi agent khác. Runtime gọi theo rule dưới đây.

2. Routing rule đầy đủ

on bot_trigger:
  call A

  if A.status != ready_for_scout:
    show A response
    stop

  call B with A.brief + A.decision_spec + A.shopping_list + source data

  if B.status != ready_for_composer:
    show B response
    stop

  call C with A.brief + A.decision_spec + B.offers + B.sourcing_summary

  show C.variants
  save A + B + C result
  stop and wait for owner

on owner_select(candidate_id):
  call D with selected C.variant + B.offers + policy
  show D.package
  stop

3. Contract theo từng call

Call A — Trip Alignment

Input tối thiểu:

{
  "mode": "group",
  "trigger": "bot_mention",
  "actor": {"id": "p1", "name": "Đạt", "role": "owner"},
  "roles": {"owner": "p1", "payer": null, "members": ["p1"]},
  "user_message": "@bot lên plan Đà Lạt 3 ngày, 4 người, 3 triệu/người",
  "answers": [],
  "current_state": {}
}

Output cần cho bước sau:

{
  "status": "ready_for_scout",
  "brief": {},
  "decision_spec": {},
  "shopping_list": [],
  "questions": [],
  "confirm_card": {}
}

Rule:

needs_user_input → hiển thị câu hỏi/card; lần tag/reply tiếp theo gọi lại A với current_state cũ.

ready_for_scout → gọi B.

blocked → dừng.

Call B — Offer Scout

Input:

{
  "brief": "<A.brief>",
  "decision_spec": "<A.decision_spec>",
  "shopping_list": "<A.shopping_list>",
  "reference_date": "2026-07-28",
  "source_inputs": [],
  "parsed_offers": []
}

Output cần cho bước sau:

{
  "status": "ready_for_composer",
  "offers": [],
  "sourcing_summary": {},
  "questions": [],
  "setup_message": ""
}

Rule:

ready_for_composer → gọi C.

needs_user_input → hỏi user về budget/hard filter rồi quay lại A để cập nhật state.

needs_source_data → runtime bổ sung source input; không hỏi traveler.

blocked → dừng.

Call C — Itinerary Composer

Input:

{
  "brief": "<A.brief>",
  "decision_spec": "<A.decision_spec>",
  "offers": "<B.offers>",
  "sourcing_summary": "<B.sourcing_summary>",
  "geo_matrix": {},
  "n_variants": 3
}

Output:

{
  "status": "options_ready",
  "variants": [],
  "selection_prompt": {},
  "simulation_disclosure": ""
}

Rule:

options_ready → hiển thị 2-3 variants, lưu result và chờ owner.

blocked → dừng.

Không gọi lại A để rank; C tự rank bằng Decision Spec.

Call D — Action Packager

Chỉ gọi sau khi owner chọn.

Input:

{
  "reference_time": "2026-07-28T18:00:00+07:00",
  "mode": "group",
  "selection": {
    "candidate_id": "cand_A",
    "selected_by": "p1",
    "selected_by_role": "owner"
  },
  "chosen_variant": "<C.variants[candidate_id=cand_A]>",
  "offers": "<B.offers>",
  "policy": {
    "max_money_at_risk": 0,
    "per_action_cap": 0,
    "allowed_action_types": [
      "send_inquiry",
      "request_hold",
      "prefill_booking",
      "share_for_approval",
      "add_to_calendar"
    ],
    "roles": {"owner": "p1", "payer": "p1"}
  }
}

Output:

{
  "status": "package_ready",
  "package": {"cards": [], "blocked_cards": []},
  "audit_log": []
}

Rule:

needs_owner_confirm → yêu cầu owner chọn/xác nhận.

package_ready → hiển thị cards; không tự execute.

blocked → hiển thị blocker.

4. Mapping dữ liệu

Từ

Sang

Field

A

B

brief, decision_spec, shopping_list

B

C

offers, sourcing_summary

A

C

brief, decision_spec

C + owner

D

chosen_variant, selection

B

D

offers

Runtime

B

source_inputs hoặc parsed_offers

Runtime

C

geo_matrix nếu có

Runtime

D

policy

5. Không tồn tại trong v2

Group listener.

Orchestrator agent.

Preference agent riêng.

Source reader riêng.

Policy agent.

Agent-to-agent tool call.

P0-P5, tasks[], dispatch[], runner loop, digest, replan loop.

Đây là fixed pipeline; complexity duy nhất của runtime là các câu if status ... then stop/call next.
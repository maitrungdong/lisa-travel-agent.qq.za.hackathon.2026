Backend flow — gửi thẳng message do agent tạo

Contract chung

Mọi agent đều trả:

{
  "status": "...",
  "message_to_user": "Tin nhắn hoàn chỉnh có \n xuống dòng, hoặc null"
}

Backend không ghép câu dẫn, câu hỏi, phương án hoặc action card thành text.

save(output)

if output.message_to_user != null:
  zalo.send(JSON.parse(output).message_to_user)

route_by(output.status)

Trong raw JSON, model viết \n. Sau JSON.parse, đó là ký tự xuống dòng thật. Không gửi raw JSON string chưa parse vì user sẽ nhìn thấy hai ký tự \ và n.

Full flow

flowchart TD
    U["DM / @bot / reply / UI action"] --> L["Load alignment state"]
    L --> A["Call A<br/>message + current_state"]
    A --> AS{"A.status"}
    AS -- needs_user_input --> AM["Lưu A<br/>Gửi nguyên A.message_to_user<br/>Chờ user reply"]
    AS -- blocked --> AB["Lưu A<br/>Gửi nguyên A.message_to_user<br/>Dừng"]
    AS -- ready_for_scout --> B["Call B<br/>alignment_result=A<br/>+ source_inputs"]
    B --> BS{"B.status"}
    BS -- needs_source_data --> BR["Lấy thêm source cho unfilled_slots<br/>Call lại B tối đa 1 lần"]
    BS -- needs_user_input --> BM["Lưu B<br/>Gửi nguyên B.message_to_user<br/>Reply sau quay lại A"]
    BS -- blocked --> BB["Lưu B<br/>Gửi nguyên B.message_to_user<br/>Dừng"]
    BS -- ready_for_composer --> C["Call C<br/>alignment_result=A<br/>sourcing_result=B"]
    C --> CS{"C.status"}
    CS -- blocked --> CB["Lưu C<br/>Gửi nguyên C.message_to_user<br/>Dừng"]
    CS -- options_ready --> CM["Lưu A+B+C<br/>Gửi nguyên C.message_to_user<br/>Chờ owner chọn"]
    CM --> V{"candidate_id hợp lệ<br/>và actor là owner?"}
    V -- Không --> VM["Gửi lại C.message_to_user<br/>hoặc báo cần owner chọn"]
    V -- Có --> D["Call D<br/>sourcing_result=B<br/>planning_result=C<br/>selection + policy"]
    D --> DS{"D.status"}
    DS -- needs_owner_confirm --> DM["Lưu D<br/>Gửi nguyên D.message_to_user<br/>Chờ owner"]
    DS -- blocked --> DB["Lưu D<br/>Gửi nguyên D.message_to_user<br/>Dừng"]
    DS -- package_ready --> DP["Lưu D<br/>Gửi nguyên D.message_to_user<br/>Render cards nếu có"]
    DP --> X["User tap action<br/>Backend check policy rồi execute"]

Payload từng call

A

{
  "mode": "group",
  "trigger": "bot_mention",
  "actor": {"id": "p1", "name": "Đạt", "role": "owner"},
  "roles": {"owner": "p1", "payer": null, "members": ["p1"]},
  "user_message": "@bot lên plan Đà Lạt 8–10/8, 4 người, 3 triệu/người",
  "answers": [],
  "current_state": {}
}

Nếu A hỏi thêm, lần reply sau gọi lại A với current_state là nguyên phần state từ output A trước.

B

Không bóc riêng A.brief, A.decision_spec, A.shopping_list. Truyền nguyên A:

{
  "alignment_result": "<nguyên output A>",
  "reference_date": "2026-07-28",
  "source_inputs": [],
  "parsed_offers": []
}

C

Không bóc riêng offers hoặc spec:

{
  "alignment_result": "<nguyên output A>",
  "sourcing_result": "<nguyên output B>",
  "geo_matrix": {},
  "n_variants": 3
}

D

Backend chỉ cần ghi nhận candidate_id từ button hoặc message lựa chọn; D tự tìm variant và offers:

{
  "reference_time": "2026-07-28T18:00:00+07:00",
  "mode": "group",
  "selection": {
    "candidate_id": "candidate_02",
    "selected_by": "p1",
    "selected_by_role": "owner"
  },
  "sourcing_result": "<nguyên output B>",
  "planning_result": "<nguyên output C>",
  "policy": {
    "max_money_at_risk": 0,
    "per_action_cap": 0,
    "allowed_action_types": [
      "send_inquiry",
      "prefill_booking",
      "share_for_approval",
      "add_to_calendar"
    ],
    "roles": {"owner": "p1", "payer": "p1"}
  }
}

Rule backend tối giản

call A
send A.message_to_user if not null

if A.status == ready_for_scout:
  call B with alignment_result=A
  send B.message_to_user if not null

if B.status == ready_for_composer:
  call C with alignment_result=A, sourcing_result=B
  send C.message_to_user
  wait owner selection

if valid owner selection:
  call D with sourcing_result=B, planning_result=C, selection
  send D.message_to_user

Structured fields như questions, variants, cards vẫn được giữ để lưu state, validate, làm button hoặc thực thi action. Chúng không còn là nguyên liệu bắt buộc để backend tự format tin nhắn.
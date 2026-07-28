# Báo cáo khả thi tích hợp — Agent System v7.1

**Ngày:** 29/07/2026 · **Đối chiếu:** `ZA_HACKATHON_AGENT_SYSTEM_V7_HANDOFF.md` vs codebase hiện tại
**Kết luận ngắn:** Khả thi, và **ít việc hơn** kiến trúc 4-agent đang dựng dở. Nhưng có một xung đột kiến trúc phải quyết trước khi viết dòng nào.

---

## 0. Ràng buộc chi phối tất cả

Handoff ghi **nộp bài 09:00 ngày 30/07/2026**. Hôm nay 29/07. Còn **dưới 24 giờ**.

Mọi đề xuất dưới đây được cân theo mốc đó, không phải theo "đúng đắn về kiến trúc".

Trạng thái hiện tại cần nhớ:

- Bot Zino **đang chạy thật** trên `zah-35.123c.vn`, webhook thông, agent hội thoại 19 tool hoạt động.
- Pipeline 4-agent (v2) đã code xong, typecheck sạch, **chưa deploy, cờ mặc định tắt**.
- Chưa có dòng code nào của v7.

---

## 1. v7 khác v2 ở đâu

| | v2 (đang có code) | v7 (đề xuất mới) |
|---|---|---|
| Số agent | 4 — Alignment, Offer Scout, Composer, Packager | 3 — Intake, Brain, Finalizer |
| Cửa vào | `AgentService` gọi tool `start_trip_planning` | **Mọi tin nhắn vào Intake trước**, không ngoại lệ |
| Luồng | Pipeline cố định A→B→C→D | Có điều kiện: Intake→deliver, hoặc Intake→Brain→Finalizer |
| Chốt để chạy | Owner nhắn "1/2/3" | Bất kỳ ai nhắn đúng chữ `BẮT ĐẦU RESEARCH` |
| Kiểm owner | Backend so `senderZaloId` với owner | **Bị khai tử tường minh** — không kiểm ai cả |
| State | 4 cột jsonb theo stage | `thin_state` + `state_patch` deep-merge |
| Nguồn dữ liệu | MCP Booking bắt buộc cho B | MCP tuỳ chọn; `web_search`/`web_fetch`/`bash` là chính |
| Lượt LLM khi research | 3 (A+B+C) | **2** (Brain + Finalizer) |
| Card hành động | `D.package.cards` | **Bị khai tử** — không card, không section |

**v7 rẻ hơn về runtime.** Phần lớn tin nhắn dừng ở Intake (model rẻ, không tool, low effort) và không bao giờ chạm Brain. Chỉ khi nhóm gõ đúng `BẮT ĐẦU RESEARCH` mới tốn một lượt Brain nặng.

So với v2 — nơi mọi yêu cầu lên kế hoạch đều nuốt trọn A→B→C — đây là thiết kế tiết kiệm hơn hẳn và ít điểm gãy hơn.

---

## 2. Tái sử dụng được bao nhiêu từ code đã viết

Ước lượng **~65% hạ tầng giữ nguyên**, ~35% phải viết lại.

### Giữ nguyên, gần như không sửa

| Thành phần | Vì sao dùng lại được |
|---|---|
| `managed-agent.driver.ts` | Gọi session, đọc SSE, gom `agent.message`, đếm `agent.mcp_tool_use`, timeout, vòng sửa JSON — đã kiểm bằng spike thật. v7 vẫn dùng Managed Agents, chỉ đổi 4 agent id thành 3. |
| `StageTimeoutError` + không retry timeout | v7 §3.3 cũng yêu cầu không chạy hai lượt Brain song song. |
| Hàng đợi `jobs` + `dedupeKey = chatId` | v7 §3.3: *"Do not build a complex distributed job system"* — nhưng cũng yêu cầu tuần tự hoá theo hội thoại. Cái đã có đáp ứng đúng, không phải dựng mới. |
| `chunkMessage` + gửi nguyên văn | v7 §3.1: backend gửi `message_to_user` **unchanged**. Giống hệt v2. |
| Cờ `ZINO_PIPELINE_ENABLED` | Đường lui 5 giây vẫn cần, thậm chí cần hơn. |
| Hai script spike | Chỉ đổi agent id và payload. |
| Bảng `pipeline_runs` (khung) | `conversation_id`, `status`, `agent_sessions`, `trace_id`, `expires_at`, unique partial index — đều dùng tiếp. Bốn cột kết quả theo stage đổi thành một cột `thin_state`. |

### Phải viết lại

| Thành phần | Lý do |
|---|---|
| `pipeline.service.ts` state machine | 4 stage cố định → 3 agent có điều kiện. Đây là phần lớn nhất, ~250 dòng. |
| Định tuyến trong `zalo.controller.ts` | Bỏ `parseCandidate`, bỏ kiểm owner. v7 cấm backend tự phân loại ngữ nghĩa. |
| `planning.tools.ts` | Tool `start_trip_planning` không còn là cửa vào. |

### Phải viết mới

- Deep-merge `state_patch` (object đệ quy, array thay thế, `null` xoá field) — v7 §3.4.
- Lưu và nạp `thin_state`.
- Lưu `reply_contract`.
- Ba validator theo §10.1–10.3.
- Nhận diện đúng chữ `BẮT ĐẦU RESEARCH` (trim, bỏ hoa/thường, bỏ dấu câu cuối).

---

## 3. Ba xung đột thật với codebase

### 3.1 ⛔ Chặn — "mọi tin nhắn vào Intake" giết 19 tool đang chạy

v7 §2.2 nói thẳng: mọi tin nhắn phải vào `intake_router`, và *"backend must not classify a user message semantically by itself"*.

Nhưng `AgentService` hiện tại **chính là** bộ phân loại đó, và nó đang phục vụ 19 tool: `add_expense`, `settle_expenses`, `set_reminder`, `add_photo`, `add_note`, `add_event`, `search_partner_oa`, `draft_oa_inquiry`, `remember`, `recall`, `create_trip`, `list_trips`…

Intake của v7 chỉ biết `trip | split_bill | quick_qa | action_command | other`. Không có khái niệm ảnh hoá đơn, nhắc lịch, Partner Network.

**Áp dụng v7 nguyên bản = mất toàn bộ những thứ đó**, tức mất phần khác biệt nhất của sản phẩm và cũng là phần đang chạy ổn định nhất.

Đây là quyết định phải chốt trước khi code. Ba lựa chọn ở mục 5.

### 3.2 ⚠️ Rủi ro — MCP Booking bị hạ xuống "tuỳ chọn"

v7 §2.7: Brain tự chứa, chỉ dùng `web_search` / `web_fetch` / `bash`. §2.8: MCP Booking là mở rộng tuỳ chọn.

Nhưng spike hôm nay đã chứng minh MCP Booking là thứ **duy nhất** cho ra dữ liệu thật: 5 khách sạn Đà Lạt, giá đúng ngày 8–10/8, toạ độ, sức chứa, deep link — trong 2 giây gọi MCP.

Bỏ nó để dùng web_search thuần là đánh đổi thứ mạnh nhất của demo lấy sự thuần khiết kiến trúc. **Đề nghị giữ MCP**, v7 cho phép (§2.8 read-only).

### 3.3 ⚠️ Rủi ro — độ trễ chưa được đo cho Brain

Đo thật hôm nay: `v2_offer_scout` (sonnet-5, effort high) mất **87 giây**, trong đó 77s là sinh 9276 ký tự JSON, chỉ 2s gọi MCP.

`planning_brain` của v7 dùng **opus-5, effort high**, ngân sách tới 4 web_search + 4 web_fetch + 2 bash, và phải sinh cả `draft_message_to_user` lẫn `evidence` lẫn `quality`. Nhiều khả năng **nặng hơn 87s**. Cộng Finalizer nữa.

Chưa đo thì chưa biết nhóm Zalo phải chờ bao lâu. Đây là việc phải làm ngay, trước khi viết state machine.

---

## 4. Câu hỏi chặn, cần trả lời trước khi code

1. **Ba agent v7 đã tồn tại trên Console chưa?** Bốn id đang có (`agent_01TBZ…`, `agent_01MxRs…`, `agent_01Rxtj…`, `agent_016Lbn…`) là của kiến trúc **v2**. `intake_router`, `planning_brain`, `zalo_finalizer` là tên khác. Nếu chưa dựng thì phải dựng, và đó là việc của người viết prompt chứ không phải backend.
2. **File `intake_router_v7_minimum_brief.json`** được doc xếp ưu tiên số 2 nhưng không có trong repo. Cần nó để biết schema brief tối thiểu.
3. **Giữ hay bỏ 19 tool hiện tại** — mục 3.1.

---

## 5. Ba phương án, kèm đánh giá thẳng

### A. Thay thế hoàn toàn — làm đúng v7 nguyên bản
Mọi tin nhắn vào Intake, gỡ `AgentService` khỏi đường chính.
**Được:** đúng doc 100%.
**Mất:** 19 tool, Partner Network, ghi chi phí, nhắc lịch, đọc bill từ ảnh, ba tầng bộ nhớ.
**Rủi ro:** rất cao dưới 24 giờ. Không khuyến nghị.

### B. Song song — Intake làm cửa cho nhánh "lên kế hoạch" (khuyến nghị)
`AgentService` giữ nguyên cho mọi việc khác. Khi phát hiện ý định lên kế hoạch, nó chuyển sang luồng v7 và từ đó **mọi tin nhắn trong hội thoại đó** đi qua Intake cho tới khi flow kết thúc.
**Được:** giữ toàn bộ tính năng đang chạy, vẫn có vòng lặp v7 đầy đủ để demo.
**Mất:** lệch doc ở đúng một điểm — tin nhắn ngoài flow không qua Intake.
**Rủi ro:** thấp. Hạ tầng đã có sẵn (job queue, cờ, driver).

### C. Hoãn — nộp bản đang chạy, làm v7 sau
Chốt bot hiện tại cho mốc 30/07, làm v7 cho Demo Day 03/08.
**Được:** an toàn tuyệt đối cho mốc nộp bài.
**Mất:** bài nộp không có phần multi-agent.

---

## 6. Ước lượng công sức cho phương án B

| Việc | Ước tính |
|---|---|
| Spike 3 agent v7, đo độ trễ | 30 phút |
| Deep-merge `state_patch` + test | 45 phút |
| Đổi bảng: 4 cột kết quả → `thin_state` + `reply_contract` | 30 phút |
| Viết lại state machine (3 agent, có điều kiện) | 2 giờ |
| Định tuyến webhook + nhận `BẮT ĐẦU RESEARCH` | 1 giờ |
| Ba validator | 45 phút |
| Chạy 18 case ở §12 | 1 giờ |
| **Tổng** | **~6,5 giờ** |

Chưa tính thời gian dựng và tinh chỉnh prompt cho ba agent v7 — việc đó không nằm ở backend.

---

## 7. Đề nghị

Làm phương án **B**, và làm theo thứ tự này:

1. **Xác nhận ba agent v7 tồn tại**, lấy id. Chưa có thì dừng, không code mù.
2. **Spike đo độ trễ Brain + Finalizer** trước mọi thứ khác. Nếu Brain quá 2 phút thì phải chỉnh prompt/effort trước, không phải chỉnh code.
3. Chỉ khi hai bước trên xong mới viết state machine.

Lý do đặt spike trước: hôm nay đã có ba lần đoán sai bị thực nghiệm bác bỏ — đường dẫn REST, `stop_reason` là object, và niềm tin rằng B tự đi tìm dữ liệu. Đoán rẻ, nhưng đoán rồi code thì đắt.

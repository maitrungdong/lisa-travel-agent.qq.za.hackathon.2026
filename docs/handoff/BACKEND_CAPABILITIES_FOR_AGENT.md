# Backend Zino — Handoff cho người tối ưu agent trên Claude Console

> **Cho ai:** người cấu hình `v4_outcome_agent` / `v4_research_brain` trên Console.
> **Trả lời câu hỏi:** backend đưa được cho agent những tool nào, những dữ liệu nào, và nên kéo cái gì vào context còn cái gì để agent tự gọi.
> **Mốc:** `main` @ `4029803` · 29/07/2026. Mọi con số đo từ code hoặc log production.
> **Kèm theo:** `v1-tools.json` — schema đầy đủ 21 tool, dán thẳng vào Console được.

---

## 1. Tóm tắt cho người vội

Backend có sẵn **21 tool** đã chạy ổn định nhiều tuần, thao tác trực tiếp trên database và trên Mini App. Chúng đang phục vụ agent v1; đưa sang v4 được bằng cơ chế **custom tool** của Managed Agents.

Ngoài tool, backend còn ba tầng dữ liệu có thể bơm thẳng vào prompt: transcript, chuyến đi đang hoạt động, và ký ức dài hạn về nhóm.

**Khuyến nghị quan trọng nhất:** đừng kéo toàn bộ DB vào context. Bơm một snapshot gọn cho phần **đọc thường xuyên**, để tool cho phần **ghi** và phần **tra cứu rộng**. Lý do ở §6.

---

## 2. Cơ chế custom tool — agent gọi, backend chạy

Tool khai trên Console chỉ là **khai báo**: tên, mô tả, input schema. Việc thực thi nằm ở backend.

```
agent gọi tool
   → SSE phát sự kiện tool_use
   → session chuyển IDLE (nghĩa là "đang chờ kết quả", không phải "đã xong")
   → backend chạy handler, POST `user.custom_tool_result` vào session
   → agent chạy tiếp
```

Hai điều người viết prompt cần biết:

**Permission policy KHÔNG áp dụng cho custom tool.** Backend thực thi mọi lời gọi agent đưa ra. Muốn có bước xác nhận thì phải viết trong chính tool, hoặc dặn trong prompt.

**Backend tự biết ngữ cảnh.** Nó đang chạy trong một hội thoại Zalo cụ thể, nên `conversationId` và `tripId` có sẵn phía server. **Agent KHÔNG cần truyền id nhóm hay id chuyến vào tool** — cứ gọi `add_expense` là backend biết ghi vào chuyến nào.

---

## 3. 21 tool — schema đầy đủ ở `v1-tools.json`

| Tool | Việc | Ghi DB? | Hiện ở Mini App |
|---|---|---|---|
| `get_trip_state` | đọc toàn bộ chuyến đang hoạt động | | |
| `create_trip` | tạo chuyến, đặt làm chuyến hoạt động | ✍ `trips` | Trang chủ |
| `add_member` | thêm thành viên | ✍ `members` | Chia tiền |
| `add_event` | thêm mốc lịch trình | ✍ `events` | **Tab Lịch trình** |
| `add_note` | ghi chú / nhật ký | ✍ `notes` | Tổng kết |
| `add_photo` | lưu ảnh kỷ niệm | ✍ `photos` | Thư viện |
| `set_reminder` | hẹn giờ nhắc, bot tự đẩy đúng giờ | ✍ `reminders` | |
| `update_trip_status` | planning → ongoing → done | ✍ `trips` | Trang chủ |
| `list_trips` | các chuyến đã và đang đi | | |
| `add_expense` | ghi khoản chi, chia đều hoặc chỉ định | ✍ `expenses` | **Tab Chi phí** |
| `list_expenses` | liệt kê chi phí kèm tổng | | |
| `settle_expenses` | tính ai trả ai bao nhiêu, tối giản số giao dịch | | Chia tiền |
| `search_partner_oa` | tìm OA đối tác theo thành phố / loại | | |
| `draft_oa_inquiry` | soạn tin hỏi OA đối tác thay nhóm | ✍ `oa_leads` | |
| `propose_options` | tạo **thẻ bỏ phiếu** | ✍ `decisions` | **Thẻ vote có nút bấm** |
| `check_decision` | xem ai đã bỏ phiếu, kết quả | | |
| `remember` | ghi một điều bền vững về nhóm | ✍ `group_memory` | |
| `recall` | đọc lại ký ức nhóm | | |
| `request_deep_plan` | đẩy job nghiên cứu nền, ~60s, tự push kết quả | ✍ `activities` | Feed |
| `request_recap` | dựng trang HTML tổng kết | ✍ `activities` | Link công khai |
| `reply` | tách câu trả lời theo từng người khi nhiều người cùng hỏi | | |

**Ba tool đáng chú ý nhất với người viết prompt:**

`propose_options` là cầu nối đẹp nhất giữa chat và Mini App. Zalo Bot API **không có nút bấm** — toàn bộ endpoint chỉ có `sendMessage`, `sendPhoto`, `sendSticker`, `sendChatAction`, `sendVoice`. Nên khi cần nhóm chọn giữa các phương án, gọi tool này là có thẻ bấm được trong app, thay vì bắt người ta gõ "chọn 2".

`settle_expenses` tính tối giản số giao dịch. Prompt hiện tại cấm model tự cộng trừ trong đầu — nên giữ luật đó.

`request_deep_plan` là job nền: gọi xong thì **kết thúc lượt ngay**, đừng chờ. Kết quả tự đẩy về nhóm sau khoảng một phút. Bot API không có cửa sổ 48h nên push chủ động lúc nào cũng được.

---

## 4. Ba tầng dữ liệu bơm được vào context

**L1 — transcript.** 20 tin gần nhất. Mọi tin sau câu trả lời cuối của bot được gom thành một khối, ghi rõ ai nói gì.

**L2 — chuyến đi đang hoạt động.** JSON gồm trip, members, itinerary, expenses, notes, photos, tổng chi. **Đo thật: ~1.000 token** cho một chuyến cỡ vừa (12 mốc lịch trình, 15 khoản chi, 3 người).

**L3 — ký ức nhóm.** Vài dòng text: sở thích du lịch, khẩu vị, dị ứng, ngân sách quen, vai trò từng người. Được cập nhật tự động 10 phút sau mỗi lượt bằng một job riêng dùng Haiku.

**Chưa bơm, phải gọi tool mới có:** mạng lưới OA đối tác, quyết định đang mở, các chuyến đã đi.

---

## 5. Ràng buộc kênh Zalo — bắt buộc tuân thủ

Đây là giới hạn kỹ thuật, không phải lựa chọn thẩm mỹ:

**Không có markdown.** `**đậm**`, `# tiêu đề`, bảng đều bị strip. Dùng xuống dòng, `•`, emoji để tạo cấu trúc.

**Không có nút bấm, không carousel, không quick reply.** Trang giới thiệu của Zalo có nhắc nhưng không endpoint nào đứng sau. Cần người dùng chọn thì đánh số và bảo họ nhắn số — hoặc gọi `propose_options` để đẩy nút vào Mini App.

**Tối đa 2000 ký tự mỗi tin.** Dài hơn sẽ bị backend cắt thành nhiều tin, làm trôi màn hình nhóm.

**Nhiều người nhắn cùng lúc.** Backend gộp các tin đến trong cửa sổ 1,2 giây thành MỘT lượt. Agent là bên quyết định gộp hay tách câu trả lời.

---

## 6. Về ý tưởng "kéo full context DB vào cho agent tự xử lý"

Ý tưởng đúng hướng nhưng nên làm một nửa. Ba lý do cụ thể.

**Context không ghi được.** Bơm cả DB vào thì agent *biết* có 15 khoản chi, nhưng muốn *thêm* khoản thứ 16 vẫn phải gọi tool. Nên tool không thay thế được bằng context — chỉ phần đọc mới thay được.

**Cache vỡ.** Anthropic cache theo tiền tố. Phần tĩnh của prompt cộng định nghĩa tool hiện là **~15.000 token được cache** (đo từ log production), giảm còn 10% giá ở mọi lượt. Dữ liệu DB thay đổi mỗi lượt, nên nhét vào là phần đó không bao giờ cache được. Snapshot 1.000 token thì chấp nhận; đổ cả bảng `partner_oas` 30 dòng cộng lịch sử chi phí thì bắt đầu đắt thật.

**Nhiễu.** Đưa mọi thứ vào cùng lúc làm loãng phần quan trọng. Mạng lưới đối tác chỉ cần khi đang tìm chỗ ở; lịch sử các chuyến cũ chỉ cần khi cá nhân hoá.

**Ranh giới nên dùng:**

| | Cách | Vì sao |
|---|---|---|
| Chuyến đang hoạt động (L2) | **bơm vào context** | dùng gần như mọi lượt, ~1.000 token |
| Ký ức nhóm (L3) | **bơm vào context** | vài dòng, quyết định giọng điệu cả lượt |
| Mạng lưới OA đối tác | **tool** | 30 dòng, chỉ cần lúc tìm chỗ ở |
| Chuyến cũ, chi phí chi tiết | **tool** | rộng và ít khi cần |
| Mọi thao tác ghi | **tool** | context không ghi được |

Nói gọn: **bơm cái nào dùng ở hầu hết mọi lượt, để tool cho cái nào thỉnh thoảng mới cần và cho mọi việc ghi.**

---

## 7. Bảng dữ liệu chính

`conversations` `messages` `group_memory` — hội thoại và ký ức.
`trips` `members` `events` `expenses` `expense_splits` `notes` `photos` `activities` — dữ liệu chuyến đi.
`decisions` `decision_options` `decision_votes` — quyết định nhóm. **Ràng buộc: mỗi chuyến chỉ MỘT quyết định mở tại một thời điểm** — nhiều thẻ cùng lúc thì nhóm không biết nhìn cái nào trước.
`partner_oas` `oa_leads` — mạng lưới đối tác.
`reminders` `jobs` — nhắc hẹn và hàng đợi việc nền.

---

## 8. Số đo thật, để cân nhắc độ trễ

| | |
|---|---|
| Lượt hội thoại thường (v1, 21 tool) | 2–9 giây |
| Lượt gom brief (v4) | 8–33 giây |
| Một lượt research có Brain | **175–200 giây** |
| Riêng Brain | ~136 giây |
| Job `deep_plan` nền (v1, opus-5) | ~60 giây |
| Phần prompt được cache | ~15.000 token |

Mỗi vòng custom tool là một lượt đi về giữa agent và backend, cộng thêm vào tổng. v1 đặt trần 8 vòng cho một lượt — nên áp trần tương tự.

---

## 9. Câu hỏi cần người viết prompt trả lời

Agent có được phép **ghi** vào DB không, hay chỉ đọc? Nếu có thì tool nào cần bước xác nhận với nhóm trước khi ghi — vì permission policy của Console không áp dụng cho custom tool.

Khi có nhiều phương án cần nhóm chọn, dùng `propose_options` để đẩy nút vào Mini App, hay giữ cách gõ "Chọn 1 / Chọn 2" trong chat? Cả hai chạy được; cái đầu tận dụng được thứ Zalo Bot API không có.

Sau khi hành trình chốt xong kế hoạch, ai ghi lịch trình vào `events` để tab Lịch trình có nội dung?

---

## 10. Kèm theo

`v1-tools.json` — 21 tool, đầy đủ `name` / `description` / `input_schema`, sinh trực tiếp từ code đang chạy. Dán vào Console được ngay, không cần gõ tay.

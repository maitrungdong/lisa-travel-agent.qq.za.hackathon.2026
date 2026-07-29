# Backend Handoff — Architecture v4 Agent-only

Architecture name: `v4`  
Runtime agents: `v4_outcome_agent` + `v4_research_brain`  
Status: Ready for integration  
Scope: Zalo text input → `v4_outcome_agent` → Zalo text output

> Quy ước version: prefix `v4_` dùng để phân biệt **kiến trúc runtime**. Version/revision hiển thị bên trong từng agent được quản lý riêng trong Agent Builder và không phải tên integration. Backend chỉ phụ thuộc vào Agent ID của `v4_outcome_agent`, không phụ thuộc vào revision number của từng agent.

## 1. Kết luận nhanh

Kiến trúc `v4` được thiết kế để **không cần thêm workflow, UI hoặc business logic ở backend**.

Backend hiện tại chỉ cần:

1. Gửi nguyên text của user vào `v4_outcome_agent`.
2. Giữ các lượt của cùng một hành trình trong cùng conversation/session.
3. Chờ agent xử lý xong.
4. Hiển thị nguyên text agent trả về cho user.

Backend **không gọi `v4_research_brain` trực tiếp**. `v4_outcome_agent` tự quyết định khi nào cần gọi Brain và tự tổng hợp kết quả thành plain text.

Nếu integration hiện tại đã forward text hai chiều và giữ cùng session, chỉ cần cấu hình Agent ID của `v4_outcome_agent`; không cần sửa code.

---

## 2. Context sản phẩm

`v4_outcome_agent` biến một nhu cầu mở, ví dụ “đi Nha Trang 7 người, khoảng 5 triệu/người”, thành một hành trình quyết định:

1. Thu thập minimum viable brief.
2. Xác nhận scope trước khi research.
3. Research từng decision slice khi cần.
4. Hiển thị progress của hành trình bằng text.
5. Đưa tối đa hai phương án dễ so sánh.
6. Yêu cầu đúng một quyết định ở mỗi lượt.
7. Ghi nhận lựa chọn và tự chuyển sang bước tiếp theo.
8. Làm nổi bật vendor/shop phù hợp, lý do phù hợp và public action link đã xác minh.

Ví dụ các bước user nhìn thấy:

```text
Chốt nhu cầu → Di chuyển → Chỗ ở → Trải nghiệm → Xác nhận kế hoạch
```

Đây là progress của hành trình user, không phải status kỹ thuật như search, fetch hoặc gọi model.

---

## 3. Kiến trúc runtime

```text
User text
   ↓
Zalo/backend
   ↓
v4_outcome_agent — Sonnet
   ├─ tự xử lý nếu không cần research
   └─ tự gọi v4_research_brain — Opus khi cần
   ↓
Plain-text response
   ↓
Zalo/backend hiển thị nguyên văn
```

### Thành phần

| Thành phần | Tên config | Vai trò | Backend có gọi trực tiếp? |
|---|---|---|---|
| Research Brain | `v4_research_brain` | Research, kiểm tra evidence, vendor, giá và calculation | Không |
| Outcome Agent | `v4_outcome_agent` | Entry point duy nhất, giữ journey và trả plain text | Có |

Tên trên là tên runtime chính thức. Revision riêng của từng agent có thể tiếp tục tăng mà không đổi hai tên này.

### Thứ tự import

1. Import `1_IMPORT_FIRST_RESEARCH_BRAIN.json` và đặt Name là `v4_research_brain`.
2. Copy Agent ID của `v4_research_brain`, dạng `agent_...`.
3. Trong `2_REPLACE_BRAIN_ID_THEN_IMPORT_OUTCOME_AGENT.json`, thay:

```text
PASTE_BRAIN_AGENT_ID_HERE
```

bằng Brain Agent ID thật.

4. Import file Outcome Agent và đặt Name là `v4_outcome_agent`.
5. Backend chỉ cấu hình Agent ID của `v4_outcome_agent` làm entry point.

Không đưa Agent ID của `v4_research_brain` vào code gọi từ Zalo/backend.

---

## 4. Contract bắt buộc

### 4.1 Input vào `v4_outcome_agent`

- Kiểu dữ liệu: plain UTF-8 text.
- Nội dung: nguyên message của user.
- Không cần bọc thêm `thin_state`, `state_patch`, `ui_hints`, `reply_contract` hoặc workflow metadata vào prompt.
- Không cần backend phân loại intent, selection hay research mode.

Ví dụ input:

```text
Đi Nha Trang 7 người, khoảng 5 triệu/người
```

```text
BẮT ĐẦU RESEARCH
```

```text
Chọn 2
```

### 4.2 Output từ `v4_outcome_agent`

- Kiểu dữ liệu logic: một plain UTF-8 string.
- Nội dung: text sẵn sàng hiển thị trực tiếp trên Zalo.
- Có thể chứa xuống dòng, ký hiệu `✓`, `→`, `○`, `•`, số thứ tự và public URL.
- Không có JSON envelope hoặc field cần parse.
- Không có tool trace, agent name, model name, metadata hoặc hidden state.

Backend phải hiển thị output **nguyên văn**, chỉ áp dụng escaping bắt buộc của transport/UI hiện có.

### 4.3 Transport envelope nếu API hiện tại dùng JSON

Đây chỉ là ví dụ mapping logic; giữ nguyên field/endpoint của SDK hoặc Agent API mà backend đang sử dụng:

```json
{
  "conversation_id": "stable-conversation-id",
  "message": "Chọn 2"
}
```

Response logic:

```json
{
  "conversation_id": "stable-conversation-id",
  "message": "plain text returned by Outcome Agent"
}
```

Không parse nội dung trong `message` thành progress, option hoặc CTA.

---

## 5. Session và conversation history

Conversation history là working memory duy nhất của kiến trúc `v4` Agent-only.

### Bắt buộc

- Các lượt thuộc cùng một journey phải dùng cùng managed-agent conversation/session.
- Backend phải giữ mapping hiện có giữa Zalo chat/thread và conversation/session của agent.
- Message `Chọn 1`, `Chọn 2`, “cái đầu”, “phương án thứ hai” phải đi vào đúng session đã hiển thị các lựa chọn đó.

### Khi mất session

Agent sẽ không đoán lựa chọn cũ. Nó sẽ hỏi user nhắc lại tên phương án hoặc gửi lại lựa chọn gần nhất.

### Journey mới

Ưu tiên tạo session mới cho một journey độc lập hoàn toàn. Nếu vẫn dùng session cũ, user nên nói rõ nhu cầu mới; `v4_outcome_agent` sẽ coi đó là scope mới.

Backend không cần tự lưu progress board, brief, option mapping hoặc selected option.

---

## 6. Format hiển thị chuẩn

Planning response thường có cấu trúc:

```text
{Tên hành trình}
Tiến độ: {done}/{total}
✓ {bước đã chốt gần nhất}
→ {bước hiện tại}
○ {bước tiếp theo}

Bước hiện tại: {tên bước}
{Một câu nêu tiêu chí ưu tiên}

1. {Tên vendor/phương án} — ⭐ Đề xuất
• {offer và price basis}
• Phù hợp vì: {lý do gắn với nhu cầu}
• {trade-off hoặc trạng thái xác minh}
Xem chi tiết: https://...

2. {Tên vendor/phương án}
• ...

Chọn 1 nếu...; chọn 2 nếu...

Trả lời: Chọn 1 hoặc Chọn 2.
```

Đây là **text**, không phải schema. Backend không cần render card, button, quick reply, progress bar hoặc rich UI. Zalo có thể tự parse URL theo khả năng sẵn có.

---

## 7. Hành vi theo loại message

| User message | `v4_outcome_agent` xử lý | Backend xử lý |
|---|---|---|
| Nhu cầu còn thiếu | Hỏi tối đa 3 blocker, kèm mẫu trả lời | Forward text |
| Brief đã đủ | Tóm tắt scope và xin `BẮT ĐẦU RESEARCH` | Forward text |
| `BẮT ĐẦU RESEARCH` | Tự gọi Brain nếu cần, trả decision đầu tiên | Chờ và hiển thị output |
| `Chọn 1/2` | Map vào decision gần nhất, ghi nhận và đi tiếp | Forward text trong cùng session |
| Follow-up trong scope | Tự trả lời hoặc gọi Brain một lần | Forward text |
| Scope thay đổi đáng kể | Tóm tắt scope mới và xin research lại | Forward text |
| Session mất context | Hỏi lại thông tin tối thiểu | Hiển thị output |

---

## 8. Business visibility contract

Khi có commercial candidate đủ evidence, response sẽ cố gắng có:

- Tên vendor/shop làm headline.
- `Phù hợp vì:` gắn với constraint của user.
- Offer, variant hoặc price basis; nếu chưa chắc phải ghi trạng thái chưa xác minh.
- Tối đa một public action link đã xác minh.
- Nhãn `Tài trợ` nếu là sponsored placement.

Recommendation luôn relevance-first. Backend không được:

- Thay đổi thứ tự vendor.
- Chèn sponsored vendor vào vị trí đề xuất mà agent không chọn.
- Sửa URL hoặc tự thêm tracking parameter vào nội dung agent trả về.
- Biến link availability thành tín hiệu ranking.

Nếu cần attribution, backend có thể đo click ở lớp link/deep-link riêng trong tương lai, nhưng attribution không phải dependency để kiến trúc `v4` hoạt động.

---

## 9. Latency và concurrency

### Hiện tại

- Không có progress message tự gửi giữa lúc agent đang chạy.
- Backend chỉ chờ một final plain-text response.
- `v4_outcome_agent` gọi tối đa một Brain run trong một user turn.
- Rapid research là mặc định; deep research chỉ khi user yêu cầu rõ.

### Khuyến nghị nếu backend được cập nhật sau

- Chỉ cho phép một active run trên mỗi conversation.
- Queue hoặc từ chối message mới khi run trước chưa hoàn tất; không khởi chạy hai research run song song trong cùng session.
- Không tự retry một request research nếu chưa biết run cũ đã thất bại hay vẫn đang chạy.
- Nếu runtime timeout, giữ nguyên session và cho user retry; không tạo journey/session mới một cách âm thầm.

Không cần timer progress, streaming event hoặc background job để chạy kiến trúc `v4`.

---

## 10. Error handling

Backend không cần hiểu lỗi nghiệp vụ trong text. `v4_outcome_agent` tự trình bày phần chưa xác minh và một cách tiếp tục.

Chỉ cần xử lý lỗi hạ tầng theo cơ chế hiện có:

- Agent API unavailable.
- Request timeout.
- Invalid `v4_outcome_agent` ID.
- Conversation/session unavailable.

Thông báo fallback nên ngắn và không claim research đã hoàn tất, ví dụ:

```text
Mình chưa hoàn tất được bước này do kết nối bị gián đoạn. Bạn gửi lại tin nhắn vừa rồi nhé.
```

Không gửi raw stack trace, tool output, prompt hoặc model error cho user.

---

## 11. Những thứ backend không cần implement

- Không cần intent router.
- Không cần gọi `v4_research_brain`.
- Không cần state database cho journey.
- Không cần parse JSON output.
- Không cần lưu `state_patch`.
- Không cần render `ui_hints`.
- Không cần progress timer.
- Không cần button, card, chip hoặc quick reply.
- Không cần map `Chọn 1/2`.
- Không cần business ranking.
- Không cần tự research, tính toán hoặc verify URL.

---

## 12. Security và data handling

- Không gửi API key, system prompt, internal token hoặc secret trong user message.
- Chỉ gửi PII cần thiết để hoàn thành request; tránh đưa dữ liệu không liên quan vào context.
- Không log hidden prompt hoặc tool trace ra client.
- Kiến trúc `v4` không được claim booking, payment, cancellation hoặc external action nếu không có connector result.
- Với hackathon, không dùng production customer data, social graph thật hoặc PII không được phép.

---

## 13. Acceptance checklist cho backend

- [ ] `v4_research_brain` được import/tạo trước.
- [ ] Config của `v4_outcome_agent` đã gắn đúng Agent ID của `v4_research_brain`.
- [ ] Backend gọi Agent ID của `v4_outcome_agent`, không gọi Agent ID của `v4_research_brain`.
- [ ] User text được gửi nguyên văn.
- [ ] Agent output được hiển thị nguyên văn.
- [ ] Các lượt cùng journey giữ cùng conversation/session.
- [ ] Không có parser cho `state_patch`, `ui_hints` hoặc JSON envelope.
- [ ] `Chọn 1/2` trong cùng session được agent hiểu đúng.
- [ ] Public URL hiển thị được dưới dạng text/link theo Zalo hiện có.
- [ ] Không có hai active run đồng thời trong cùng conversation.
- [ ] Lỗi hạ tầng không làm lộ raw error hoặc internal prompt.

---

## 14. Smoke test tối thiểu

Chạy tuần tự trong cùng một session:

### Turn 1

```text
Đi Nha Trang 7 người, khoảng 5 triệu/người
```

Kỳ vọng:

- Agent hỏi tối đa 3 thông tin còn thiếu.
- Có progress với bước hiện tại là `Chốt nhu cầu`.
- Không trả JSON.

### Turn 2

Trả lời đủ các blocker theo mẫu agent đưa ra.

Kỳ vọng:

- Agent tóm tắt scope.
- CTA duy nhất yêu cầu `BẮT ĐẦU RESEARCH`.

### Turn 3

```text
BẮT ĐẦU RESEARCH
```

Kỳ vọng:

- Agent trả một decision slice.
- Có tối đa 2 candidate mặc định.
- Có một CTA text.
- Vendor đủ evidence có tên, lý do phù hợp và link nếu xác minh được.

### Turn 4

```text
Chọn 2
```

Kỳ vọng:

- Agent ghi nhận đúng phương án thứ hai vừa hiển thị.
- Progress được cập nhật.
- Agent tự chuyển sang decision tiếp theo.

### Negative test

Gửi `Chọn 2` trong một session mới không có lịch sử.

Kỳ vọng:

- Agent không đoán.
- Agent hỏi user đang nói tới phương án có tên nào.

---

## 15. File ownership

### File dùng để import

- `1_IMPORT_FIRST_RESEARCH_BRAIN.json`
- `2_REPLACE_BRAIN_ID_THEN_IMPORT_OUTCOME_AGENT.json`

### File tài liệu

- `BACKEND_HANDOFF_V4_AGENT_ONLY.md`

File tài liệu không import vào Agent Builder. ZIP import chính thức vẫn chỉ chứa hai file JSON để tránh nhầm lẫn.

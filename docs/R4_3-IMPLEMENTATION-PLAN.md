# R4.3 Memory-first cho Zalo — Kế hoạch triển khai

> **Phạm vi đã chốt:** R4.3 chỉ áp cho **chat bot Zalo**. **Mini App giữ nguyên v1** — `ChatAgent`, 21 tool, Postgres, thẻ vote, form chi phí.
> **Trạng thái:** chưa bắt đầu. Làm sau khi nộp.
> **Nguồn:** `BACKEND_HANDOFF_R4_3_MEMORY_FIRST.md`, đối chiếu codebase `main` @ `4029803` ngày 29/07/2026.

---

## 1. Vì sao tách được — điều kiện tiên quyết đã thoả

Trước hôm nay, mọi dữ liệu trong Postgres đều do agent Zalo ghi qua 21 tool. Tách Zalo ra khỏi DB nghĩa là Mini App chết đói.

Điều đó **không còn đúng**. Mini App nay tự ghi được:

| Đường ghi | Vào bảng |
|---|---|
| `POST /trips/:id/chat/act` — bấm nút xác nhận, backend `revalidate` rồi ghi | `expenses` `events` `notes` |
| Form chi phí + quét QR | `expenses` `expense_splits` |
| Bỏ phiếu / chốt quyết định | `decisions` `decision_votes` |
| `ChatAgent` với tool riêng | đọc toàn bộ |

Nên hai bề mặt sống độc lập được. Đây là điều kiện khiến kế hoạch này khả thi, và nó chỉ vừa mới đúng từ chiều 29/07.

---

## 2. Hình dạng sau khi tách

```
Zalo nhóm                          Mini App
   ↓                                  ↓
R43Service                        ChatController → ChatAgent
   ↓                                  ↓  (21 tool, gateReply)
Outcome session                   Postgres
   ├─ Group Memory Store             ↑
   ├─ Trip Memory Store          ┌───┘
   └─ OA catalog (file)          │
   ↓                             │
plain text → Zalo                │
   ↓                             │
[cầu nối tuỳ chọn] ──────────────┘
Memory /state/*.json → trips/events/expenses
```

**Zalo:** webhook → session Outcome → chuyển tiếp text. Không tool, không DB.
**Mini App:** không đụng một dòng.
**Cầu nối:** tuỳ chọn, quyết định ở §5.

---

## 3. Cái gì mất trên Zalo — đọc kỹ

Khi R4.3 thay `AgentService` ở kênh Zalo:

| Đang có trên Zalo | Sau R4.3 |
|---|---|
| Đọc bill từ ảnh → `add_expense` | ảnh vẫn đọc được (§12 Files), nhưng ghi vào Memory chứ không vào `expenses` |
| `set_reminder` → worker tự đẩy đúng giờ | **mất hẳn**, không có cơ chế thay thế |
| `propose_options` → thẻ vote bấm được | **mất**, chuyển sang gõ "Chọn 1/2" trong chat |
| `settle_expenses` chia tiền tối giản | **mất trên Zalo**, còn trong Mini App |
| `request_recap` trang tổng kết | **mất** |
| `search_partner_oa` đọc bảng thật | thay bằng CSV snapshot mount vào sandbox |
| `remember`/`recall` + job reflection | thay bằng Group Memory Store |
| Gộp tin nhiều người trong 1,2 giây | cần dựng lại, R4.3 không nhắc tới |

**Nhắc hẹn là mất mát nặng nhất** — nó là thứ Bot API làm được mà Mini App không: đẩy chủ động vào nhóm đúng giờ, không cần ai mở app.

---

## 4. Sự thật kỹ thuật đã kiểm chứng

Đừng kiểm lại:

**SDK 0.71.2 KHÔNG có `memory-stores` và `sessions`** — chỉ có `beta/files`. Memory Store và session phải gọi REST thô, giống `ManagedAgentDriver`. Files thì dùng SDK được.

**Ba beta header không được trộn.** `agent-memory-2026-07-22` cho Memory; `managed-agents-2026-04-01` cho session. Trộn là 400.

**Hai store cho nhóm demo đã tồn tại** — seed vào đúng chúng, đừng tạo cặp mới:
```
Zino Group  memstore_01BuuFXFdj7mGonrDTA9NWNV
Zino Trip   memstore_018ucaFRAzjkqiwWghxo18hK
```

**Memory Store attach lúc TẠO session**, không thêm được sau. File thì thêm được vào session đang chạy.

**Environment hiện tại chỉ mở `demandapi-mcp.booking.com`.** Rapid/Expert cần web — phải tạo mới. Đã thử: Managed Agents **chỉ nhận `networking.type: "limited"`**, không có mạng mở, phải liệt kê host. `scripts/spike-v4.mjs` đã có sẵn logic.

**`stop_reason` là OBJECT**, không phải chuỗi. So sánh `=== "end_turn"` luôn sai.

---

## 5. Cầu nối Memory → DB: nên làm

§7.2 nói Outcome duy trì `/state/current.json`, `/itinerary/events.json`, `/ledger/expenses.csv`. Backend đọc được qua Memory API rồi chiếu xuống `trips`/`events`/`expenses`.

**Vì sao nên:** không có nó thì nhóm bàn chuyến trong Zalo, mở Mini App ra thấy trống. Hai bề mặt thành hai sản phẩm rời chung một logo.

**Chi phí:** một lượt gọi Memory API sau mỗi turn, ~200 dòng. §13 khuyên không đọc Memory từ backend, chủ yếu vì độ trễ — nhưng đọc **sau khi đã trả lời user** thì không ảnh hưởng độ trễ cảm nhận.

**Làm một chiều thôi.** Memory là nguồn sự thật cho Zalo, DB là bản chiếu để Mini App đọc. Đừng đồng bộ hai chiều — đó là chỗ hai nguồn sự thật bắt đầu đánh nhau.

---

## 6. Xây gì, theo thứ tự

| # | Việc | Dòng | Ghi chú |
|---|---|---|---|
| 0 | **Spike đọc stream** | 0 | Bắt buộc trước tất cả — xem §7 |
| 1 | Bảng `zino_group_runtime` + khoá theo nhóm | 80 | schema ở §5 của handoff |
| 2 | `MemoryClient` REST: create store, create/read memory | 150 | header `agent-memory-2026-07-22` |
| 3 | Upload OA catalog CSV một lần, ghi `file_id` | 40 | dùng SDK `beta/files` |
| 4 | Tạo session với 3 resource | 80 | header `managed-agents-2026-04-01` |
| 5 | Đọc stream, chỉ lấy text thread chính | 150 | phần khó nhất |
| 6 | Định tuyến webhook sau cờ `ZINO_R43_ENABLED` | 60 | tắt cờ = về v1 |
| 7 | Upload ảnh người dùng + add resource | 120 | §12 |
| 8 | `/newtrip` | 60 | §6.4 |
| 9 | Cầu nối Memory → DB | 200 | §5 ở trên |

**Tổng ~940 dòng.** Một ngày rưỡi làm việc tập trung cộng test.

Toàn bộ sau cờ `ZINO_R43_ENABLED`, giữ v1 làm đường lui — cách đã cứu chúng ta hai lần với v7 và v4.

---

## 7. Spike bắt buộc trước khi code — 30 phút

Câu hỏi duy nhất: **phân biệt "idle vì xong" với "idle vì đang chờ thread con" thế nào.**

Đo thật ngày 29/07 với v4: khi Outcome giao việc cho Brain, stream phát `session.thread_created` rồi `session.thread_status_idle`, và thread chính **im lặng 136 giây** trước khi có kết quả. Driver hiện tại thoát ngay khi thấy idle — nếu bê nguyên sang R4.3 thì mọi lượt có research sẽ trả về câu cụt.

§11 nói chờ `session.status_idle` với `stop_reason=end_turn`. Cần xác minh bằng mắt rằng `session.status_idle` (khác `thread_status_idle`) chỉ bắn khi thật sự xong.

```bash
VERBOSE=1 ZINO_OUTCOME_TIMEOUT_MS=900000 \
MSGS='<câu kích hoạt research>' node scripts/spike-v4.mjs <outcome_agent_id>
```

Không có câu trả lời này thì mọi thứ còn lại xây trên cát.

---

## 8. Chỗ handoff chưa nói rõ — hỏi team agent

**Nhắc hẹn.** R4.3 không có cơ chế đẩy chủ động. Nhóm nói "nhắc tao 7h sáng mai" thì ai nhắc? Nếu không có câu trả lời, giữ `set_reminder` bằng cách nào đó — đây là tính năng người dùng thấy rõ nhất khi mất.

**Gộp tin nhiều người.** v1 gom các tin trong 1,2 giây thành một lượt. R4.3 không nhắc. Nhóm 5 người cùng nhắn thì 5 session run nối tiếp, mỗi run vài chục giây.

**Ai ghi `/events/YYYY-MM-DD/<turn>.md`.** §7.2 nói Outcome tự ghi. Cần xác nhận nó xảy ra thật.

**Độ trễ.** Chưa ai đo R4.3. v4 không Memory đã 8–33 giây cho lượt thường. Thêm mount Memory Store và đọc/ghi file trong sandbox thì chưa biết. **Đo trước khi hứa với ban giám khảo.**

---

## 9. Rủi ro

**Hai nguồn sự thật.** Zalo ghi vào Memory, Mini App ghi vào Postgres. Cùng một chuyến đi có hai bản ghi khác nhau, và không cái nào biết cái kia. Cầu nối ở §5 chỉ chiếu một chiều — người dùng thêm chi phí trong Mini App thì agent Zalo không thấy.

Đây là vấn đề thiết kế nghiêm trọng nhất của phương án tách, và nó **không có lời giải rẻ**. Chấp nhận nó, hoặc chấp nhận rằng Mini App chỉ để xem chứ không để sửa.

**Không có đường lui trong dữ liệu.** Chạy R4.3 một thời gian rồi muốn về v1 thì dữ liệu nằm trong Memory Store, phải viết bộ chuyển ngược.

**Backend mất quyền kiểm soát chất lượng.** Mini App có `gateReply` chặn số bịa. Zalo dưới R4.3 không có gì tương đương.

---

## 10. Khuyến nghị

Làm theo §6 kèm cầu nối §5. Nhưng trước khi cam kết, trả lời hai câu ở §8 — **nhắc hẹn** và **gộp tin nhiều người**. Cả hai là tính năng người dùng cảm nhận trực tiếp, và R4.3 không có chỗ nào nói tới.

Nếu team agent không có lời giải cho nhắc hẹn, cân nhắc phương án lai: R4.3 lo hội thoại và lên kế hoạch, còn `AgentService` giữ lại đúng vài tool đẩy chủ động. Lệch §1 nhưng giữ được thứ Bot API làm tốt nhất — nhắn vào nhóm đúng lúc mà không cần ai mở app.

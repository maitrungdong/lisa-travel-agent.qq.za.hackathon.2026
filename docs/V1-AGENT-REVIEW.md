# Zino v1 — Agent đang chạy: có gì, và cắm thêm được ở đâu

> **Phạm vi:** tầng agent trên Zalo khi `ZINO_V7_ENABLED=0` và `ZINO_OUTCOME_ENABLED=0` — `AgentService` + 21 tool + job nền. Ngoài phạm vi: `ChatAgent` của Mini App (đường riêng), v7, v4.
> **Mục đích:** biết chính xác đang có gì để quyết định thêm prompt, thêm context, thêm tool, hay nối MCP.
> **Mốc:** `main` @ `4029803` · 29/07/2026. Mọi con số đo từ log production hoặc đọc thẳng từ source.

---

## 1. Một câu

Một agent duy nhất chạy trên Messages API, có 21 tool và một server tool `web_search`, vòng lặp tối đa 8 vòng, trần 75 giây. Không có agent thứ hai, không có hợp đồng JSON giữa các bên — **và đó là lý do nó ổn định trong khi v7 và v4 còn chật vật.**

---

## 2. Vòng đời một lượt

```
Zalo webhook
  → verify chữ ký, trả 200 NGAY (zalo.controller.ts:42-62)
  → tải ảnh, chống trùng, bắt mã ghép đôi
  → enqueueCoalesced("agent_turn", dedupeKey = chatId, cửa sổ 1200ms)
        ↓ hàng đợi Postgres, mỗi nhóm chỉ MỘT lượt chạy tại một thời điểm
  → WorkerService.handleAgentTurn
  → AgentService.runTurn
        ├─ dựng system prompt 2 khối (tĩnh + động)
        ├─ dựng lịch sử: 20 tin, gom mọi tin sau câu trả lời cuối của Zino
        ├─ vòng lặp ≤8: model chọn tool → backend chạy → trả kết quả vào
        └─ trả về danh sách tin cần gửi
  → gửi Zalo, ghi vào bảng messages
  → hẹn job reflection sau 10 phút
```

**Điểm đáng chú ý:** cửa sổ gộp 1,2 giây (`zalo.controller.ts:26`) khiến năm người cùng mention bot chỉ tạo **một** lượt. Agent nhìn cả cuộc trao đổi rồi tự quyết gộp hay tách câu trả lời qua tool `reply` — quyết định ngữ nghĩa, backend không làm được.

---

## 3. Prompt — ba khối, hai khối được cache

| Khối | Nội dung | Cache |
|---|---|---|
| 1. `STATIC_SYSTEM` | tính cách, ràng buộc kênh Zalo, 6 quy tắc bắt buộc, xử lý nhiều người nhắn, xử lý ảnh, ba giai đoạn | ✅ `ephemeral` |
| 2. định nghĩa 21 tool | schema + mô tả từng tool | ✅ breakpoint ở tool cuối |
| 3. `buildDynamicContext` | người đang nói, giờ VN, lần thứ mấy quay lại, ký ức L3, chuyến đi L2 | ❌ đổi mỗi lượt |

**Số đo thật từ log production:** `cache đọc 14982 / ghi 14982`. Tức khối tĩnh + định nghĩa tool là **~15.000 token** được cache, giảm còn 10% giá ở mọi lượt sau.

> Ghi chú ở `agent.service.ts:117` nói "tiết kiệm ~2.700 token/lượt" — **con số đó đã lạc hậu 5 lần**. Bộ tool đã phình từ khi viết comment đó.

**Hệ quả quan trọng cho mọi thay đổi sau này:** Anthropic cache theo **tiền tố**. Thêm gì vào khối 1 hoặc khối 2 là làm nguội cache một lần rồi ổn định lại. Nhưng nếu vô ý đưa thứ thay đổi theo lượt (giờ, tên người) vào khối tĩnh thì **cache không bao giờ trúng nữa** — mỗi lượt đắt gấp 10.

---

## 4. Context tới model mỗi lượt

Ba tầng, cộng ảnh:

**L1 — transcript.** 20 tin gần nhất (`agent.service.ts:285`). Cắt tại câu trả lời cuối của Zino; mọi tin sau đó gom thành MỘT khối user có ghi rõ ai nói gì (`:288-296`). Đây là lý do bot của bạn **bắt buộc** phải ghi lại tin nó gửi — không ghi thì lần sau nó nuốt hai chục tin rồi trả lời gộp.

**L2 — chuyến đi đang hoạt động.** `loadTripState` (`trip.tools.ts:15`) đổ nguyên JSON: trip, members, itinerary, expenses, notes, photos, tổng chi. Nhét vào prompt động kèm câu *"Đây là SỰ THẬT hiện tại. Đừng bịa thêm số liệu ngoài đây."*

**L3 — ký ức nhóm.** Một chuỗi text trong `group_memory`. Job `reflection` chạy 10 phút sau mỗi lượt, dùng Haiku đọc 40 tin gần nhất rồi viết lại toàn bộ ký ức (`worker.service.ts:336-399`).

**Ảnh.** Tối đa 3 ảnh/lượt (`agent.service.ts:22`), base64, kèm chú thích hướng dẫn model tự nhận diện hoá đơn / vé / ảnh kỷ niệm.

**Cái model KHÔNG thấy:** mạng lưới OA đối tác (phải gọi `search_partner_oa` mới thấy), lịch sử các chuyến cũ, dữ liệu quyết định nhóm (phải gọi `check_decision`).

---

## 5. 21 tool

| Nhóm | Tool | Ghi chú |
|---|---|---|
| Chuyến đi (9) | `get_trip_state` `create_trip` `add_member` `add_event` `add_note` `add_photo` `set_reminder` `update_trip_status` `list_trips` | `create_trip` đổi luôn chuyến đang hoạt động |
| Tiền (3) | `add_expense` `list_expenses` `settle_expenses` | prompt cấm model tự cộng trừ |
| Đối tác (2) | `search_partner_oa` `draft_oa_inquiry` | Partner Network |
| Quyết định (2) | `propose_options` `check_decision` | sinh thẻ vote trong Mini App |
| Ký ức (2) | `remember` `recall` | ghi L3 chủ động |
| Việc nền (2) | `request_deep_plan` `request_recap` | đẩy job rồi kết thúc lượt |
| Điều phối (1) | `reply` | tách câu trả lời theo người |

Cộng **server tool `web_search`**, `max_uses: 4` (`agent.service.ts:206`).

**⚠ `strict: true` KHÔNG bật được.** API trả 400 *"Schema is too complex for compilation"* với bộ tool này (`tools/index.ts:216-231`). Bù lại: mỗi tool tự validate và trả `{ok:false, hint}` để model gọi lại cho đúng.

---

## 6. Job nền

| Job | Model | Việc |
|---|---|---|
| `deep_plan` | opus-5, `web_search` max 8 | research lịch trình, ~60s, tự push về nhóm |
| `recap` | sonnet-5 chỉ viết lời tựa | trang HTML tổng kết — **bố cục và mọi con số do code dựng, có unit test** |
| `reflection` | haiku-4.5 | cập nhật ký ức L3 |
| `merchant_reply` | haiku-4.5 | trả lời lead thay OA đối tác |

Việc nào quá 30 giây thì agent đẩy job rồi kết thúc lượt ngay. Bot API không có cửa sổ 48h nên push chủ động lúc nào cũng được — đây là điểm mạnh kiến trúc, không phải giải pháp tình thế.

---

## 7. Cắm thêm được ở đâu

### 7.1 Thêm tool — rẻ nhất, một file

Viết một `ToolDef` rồi thêm vào mảng trong `tools/index.ts`. Có sẵn helper `schema()` và `S.*`.

```ts
{
  name: "check_weather",
  description: "Tra thời tiết điểm đến cho ngày cụ thể. DÙNG KHI ...",
  input_schema: schema({ city: S.str("..."), date: S.date("...") }, ["city", "date"]),
  handler: async (input, ctx) => ({ ok: true, ... })
}
```

**Chi phí:** mỗi tool thêm ~100–150 token vào khối cache. 21 tool hiện ~15K token — còn nhiều chỗ, nhưng đừng vượt 30 tool: mô tả càng nhiều thì model càng dễ chọn nhầm.

**Nguyên tắc từ kinh nghiệm hôm nay:** đừng để hai tool làm gần giống nhau. Khi bật pipeline v2 mà vẫn giữ `request_deep_plan`, model chọn ngẫu nhiên giữa hai đường lên kế hoạch. Vì thế `tools/index.ts` lọc bỏ nó ở các nhánh có cờ.

### 7.2 Bơm thêm context — rẻ, nhưng cẩn thận cache

Thêm field vào `PromptContext` rồi render trong `buildDynamicContext`. **Chỉ đặt ở khối động**, đừng đụng `STATIC_SYSTEM`.

Ba thứ đáng bơm mà hiện chưa có:

**Mạng lưới OA đối tác.** Hiện model phải gọi `search_partner_oa` mới biết có đối tác. Bơm sẵn 10–15 OA gần điểm đến vào prompt thì nó chủ động gợi ý được ngay, không tốn một vòng tool. Đây là điểm thương mại của sản phẩm — đáng để nó luôn nhìn thấy.

**Quyết định nhóm đang mở.** Có thẻ vote đang chờ mà model không biết, nên không nhắc được *"còn 2 người chưa bỏ phiếu đấy"*.

**Các chuyến đã đi.** `list_trips` có, nhưng phải gọi mới thấy. Một dòng tóm tắt "nhóm đã đi 3 chuyến: Đà Lạt, Vũng Tàu, Nha Trang" giúp cá nhân hoá tốt hơn nhiều so với ký ức L3 chung chung.

### 7.3 Server tool của Anthropic — có sẵn, chưa dùng hết

Đã kiểm trong `@anthropic-ai/sdk@0.71.2`, các loại SDK khai báo:

| Tool | Trạng thái |
|---|---|
| `web_search` | ✅ đang dùng, `max_uses: 4` |
| `web_fetch_20250910` | ❌ **chưa dùng** |
| `code_execution_20250825` | ❌ chưa dùng |
| `memory_20250818` | ❌ chưa dùng |
| `bash_*`, `text_editor_*` | ❌ không phù hợp |

**`web_fetch` là thứ đáng thêm nhất.** Hiện agent tìm được kết quả nhưng không mở được trang cụ thể — nên nó chỉ đọc được đoạn tóm tắt của công cụ tìm kiếm. Có `web_fetch` thì nó mở đúng trang khách sạn để lấy giá thật.

Thêm một dòng cạnh `web_search`:

```ts
{ type: "web_fetch_20250910", name: "web_fetch", max_uses: 3 } as never
```

> Lưu ý: code đang dùng `web_search_20260318`, mới hơn những gì SDK biết, nên phải ép kiểu `as never`. API chấp nhận. Cùng cách đó cho `web_fetch` — nhưng nên thử phiên bản mới nhất trước, rơi về `20250910` nếu bị từ chối.

### 7.4 MCP — được, nhưng phải đổi sang beta API

Đã xác minh trong SDK: `mcp_servers` **chỉ có ở `client.beta.messages`**, không có ở `client.messages` đang dùng. Cần beta header `mcp-client-2025-04-04` hoặc `mcp-client-2025-11-20`.

Nghĩa là phải đổi `agent.service.ts:198` từ `this.client.messages.create` sang `this.client.beta.messages.create` kèm header, rồi thêm:

```ts
mcp_servers: [{ type: "url", url: "https://demandapi-mcp.booking.com/...", name: "booking" }]
```

**Cân nhắc:** MCP Booking.com cho inventory thật kèm deep link — chính là thứ v4 làm được mà v1 không. Nếu muốn v1 có sức mạnh đó mà không cần Outcome Agent thì đây là đường ngắn nhất.

**Rủi ro:** đổi sang beta API là đổi đường chạy của **mọi** lượt hội thoại, tức đụng vào thứ đang ổn định nhất trong hệ. Nên làm sau cờ riêng, và thử ở `deep_plan` (job nền) trước khi đụng hot path.

### 7.5 Prompt — chỗ còn thiếu

Đọc `STATIC_SYSTEM` thấy nó chặt chẽ về **cách nói** nhưng lỏng về **cách kiểm chứng**. Cụ thể:

Không có luật nào bắt model nêu nguồn khi đưa giá. Quy tắc 2 nói "không bịa số, dùng `web_search`" nhưng không yêu cầu dẫn ra đã tra ở đâu. Mini App có cổng `gateReply` chặn số bịa; Zalo thì không có gì.

Không có luật xử lý khi tra cứu thất bại. Model có thể im lặng đưa giá ước lượng.

Không nhắc `propose_options` trong phần "ba giai đoạn", nên tool này ít được dùng dù nó là cầu nối đẹp nhất giữa chat và Mini App.

---

## 8. Đề xuất, xếp theo lợi ích trên công sức

**1. Thêm `web_fetch`** — một dòng. Agent đọc được trang thật thay vì chỉ đoạn tóm tắt tìm kiếm. Lợi ích trực tiếp lên chất lượng mọi câu trả lời có số liệu.

**2. Bơm mạng lưới OA đối tác vào prompt động** — khoảng 20 dòng. Biến Partner Network từ thứ phải hỏi mới có thành thứ Zino chủ động gợi ý. Đây là điểm thương mại, đáng để luôn hiện diện.

**3. Siết prompt về dẫn nguồn** — vài dòng trong `STATIC_SYSTEM`. Thêm luật: nêu giá thì phải nói tra ở đâu, hoặc ghi rõ "giá tham khảo, cần xác nhận". Làm nguội cache một lần, sau đó không tốn gì.

**4. Bơm quyết định đang mở + lịch sử chuyến** — khoảng 20 dòng, cùng chỗ với mục 2.

**5. MCP Booking.com** — lớn nhất và rủi ro nhất. Chỉ làm khi bốn mục trên đã xong và ổn định, và **thử ở job `deep_plan` trước**, đừng đụng hot path.

---

## 9. Vì sao v1 vẫn là nền tốt nhất để xây tiếp

Ba lý do rút ra từ trọn ngày 29/07 sửa v7 rồi v4:

**Không có hợp đồng JSON giữa các bên để mà lệch.** Bốn lỗi nặng nhất hôm nay đều cùng một loại: doc quy định một hình dạng, agent trả về hình dạng khác. v1 không có bề mặt đó — tool có schema, sai thì backend trả `hint` và model gọi lại.

**Toàn bộ trạng thái nằm trong DB.** Không có `thin_state` do agent tự quản để mà nhiễm bẩn. Sự cố `duplicate_trigger_research_already_confirmed` sáng nay là trạng thái nói dối về thực tế — v1 không thể gặp lỗi đó.

**Định tuyến miễn phí.** v4 tốn 8–33 giây mỗi lượt chỉ để quyết định "có cần research không". Ở v1 câu hỏi đó được trả lời bằng chính việc model chọn tool — không thêm một lời gọi API nào.

Điều v1 thật sự thiếu so với v4: **nghiên cứu nhiều bước có kiểm chứng nguồn, và inventory thật từ MCP.** Cả hai đều cắm thêm được vào v1 — mục 1 và mục 5 ở trên — mà không phải đổi kiến trúc.

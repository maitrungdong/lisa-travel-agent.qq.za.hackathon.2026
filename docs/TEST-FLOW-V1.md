# Kịch bản test nguyên flow — chế độ v1 (phương án backup)

> **Chế độ:** `ZINO_V7_ENABLED=0` · `ZINO_PIPELINE_ENABLED=0` → 21 tool, một agent, Messages API.
> **Mục đích:** xác nhận toàn bộ tính năng chạy được mà không cần hệ ba agent, để có đường lui chắc chắn cho ngày nộp và Demo Day.
> **Thời lượng:** ~35 phút cho cả 12 mục, trong đó 2 mục phải chờ job nền.

---

## A. Chuyển về v1

Trên VPS:

```bash
cd /opt/zino

# 1. Đóng mọi flow v7 còn treo — nếu sau này bật lại cờ, run cũ sẽ không hồi sinh
docker compose exec -T postgres psql -U lisa -d lisa -c \
  "update pipeline_runs set status='cancelled', updated_at=now()
   where status not in ('done','blocked','failed','expired','cancelled');"

# 2. Tắt cờ
sed -i 's/^ZINO_V7_ENABLED=.*/ZINO_V7_ENABLED=0/' .env
grep -E '^ZINO_(V7|PIPELINE)_ENABLED=' .env

# 3. Nạp lại — BẮT BUỘC --force-recreate, `up -d` thường không nạp lại biến
docker compose up -d --force-recreate api && sleep 15
docker compose exec -T api printenv ZINO_V7_ENABLED
```

Dòng cuối phải in `0`.

### Xác nhận đã thật sự ở v1

Mở log rồi nhắn một câu bất kỳ cho bot:

```bash
docker compose logs -f api | grep -E "AgentService|WorkerService|V7Service"
```

**Đúng v1** khi thấy dạng log của `AgentService`:

```
▶ Đông: lên plan Đà Lạt … · trip=… · nhớ=…
  🔧 create_trip(...) ✓ 120ms
◀ 1 tin 240 ký tự · 2 vòng · create_trip · 3.4s · cache đọc 2731 / ghi 0
job#NN agent_turn xong trong 3512ms
```

Ba dấu hiệu: job là **`agent_turn`** chứ không phải `v7_turn` · **không có dòng `V7Service`** nào · có dòng `cache đọc` (prompt caching đang hoạt động).

---

## B. Kịch bản 12 bước

Nhắn trong nhóm Zalo, chờ bot trả lời xong mới sang bước kế. Mọi tin đều mention bot.

| # | Nhắn gì | Tool chạy | Kết quả cần thấy |
|---|---|---|---|
| 1 | `nhóm mình 4 người đi Đà Lạt 2-3/08, ngân sách 2 triệu/người` | `create_trip` | Bot xác nhận đã tạo chuyến; DB có dòng `trips` mới |
| 2 | `thêm Hà, Linh, Nam vào chuyến nhé` | `add_member` | 3 dòng trong `members` |
| 3 | `nhớ giùm là Hà dị ứng hải sản` | `remember` | Bot xác nhận đã nhớ; `group_memory` có nội dung |
| 4 | `lên lịch trình chi tiết giúp mình, thiên về chill` | `request_deep_plan` | Bot nói "để mình research chút nha" rồi **kết thúc lượt**. ~60s sau tự đẩy lịch trình về nhóm |
| 5 | `thêm mốc: 14h nhận phòng ngày 2/8` | `add_event` | Dòng trong `events` |
| 6 | *(gửi ảnh hoá đơn)* | `add_expense` | Bot đọc được số tiền, ghi vào `expenses` kèm `receipt_photo_url` |
| 7 | `ai nợ ai bao nhiêu` | `settle_expenses` | Danh sách chuyển tiền tối giản |
| 8 | `nhắc mình 7h sáng mai check-in` | `set_reminder` | Dòng trong `reminders`; đúng giờ bot tự nhắn |
| 9 | `cho mình 3 lựa chọn khách sạn để cả nhóm chốt` | `propose_options` | Thẻ quyết định hiện trong Mini App, bấm vote được |
| 10 | `tìm quán ăn đối tác ở Đà Lạt` | `search_partner_oa` | Danh sách OA đối tác kèm gợi ý |
| 11 | *(gửi ảnh kỷ niệm)* | `add_photo` | Dòng trong `photos` |
| 12 | `làm trang tổng kết chuyến đi` | `request_recap` | ~60s sau nhận link HTML, mở ra đúng số liệu |

### Hai mục cần kiên nhẫn

**Bước 4 và 12** chạy job nền. Bot kết thúc lượt ngay rồi **tự push** kết quả về sau — Bot API không có cửa sổ 48h nên gửi lúc nào cũng được. Đây là hành vi đúng, không phải treo.

### Mục chạy ngầm không cần thao tác

**Reflection** tự chạy 10 phút sau lượt cuối, dùng Haiku đọc transcript và cập nhật `group_memory`. Kiểm sau khi test xong:

```bash
docker compose exec -T postgres psql -U lisa -d lisa -c \
  "select left(content, 300) from group_memory order by updated_at desc limit 1;"
```

Phải thấy điều đã dặn ở bước 3, và có thể thêm vài điều bot tự rút ra.

---

## C. Kiểm dữ liệu sau khi chạy xong

```bash
cd /opt/zino
docker compose exec -T postgres psql -U lisa -d lisa -c "
  select 'trips'      as bang, count(*) from trips
  union all select 'members',    count(*) from members
  union all select 'events',     count(*) from events
  union all select 'expenses',   count(*) from expenses
  union all select 'photos',     count(*) from photos
  union all select 'reminders',  count(*) from reminders
  union all select 'decisions',  count(*) from decisions
  union all select 'activities', count(*) from activities;"
```

Rồi mở Mini App kiểm bằng mắt: tab chuyến đi, chi phí, quyết định, và tab Hỏi Zino.

---

## D. Mini App — liên kết tài khoản

Trong app bấm lấy mã 6 số, rồi nhắn mã đó vào nhóm (có mention bot cũng được — đã xử lý ở `stripBotMention`).

```
@Zino 482913
```

Bot xác nhận đã liên kết. Đây là đường duy nhất buộc danh tính Zalo với phiên Mini App, và nó **chỉ mới chạy được trong nhóm từ 29/07** — trước đó regex gỡ mention chỉ ăn một token nên mã không bao giờ khớp. Test kỹ mục này.

---

## E. Bật lại v7 khi cần

```bash
cd /opt/zino
sed -i 's/^ZINO_V7_ENABLED=.*/ZINO_V7_ENABLED=1/' .env
docker compose up -d --force-recreate api && sleep 15
docker compose exec -T api printenv ZINO_V7_ENABLED
```

Không mất gì khi qua lại — cờ chỉ quyết định bộ tool nạp lúc khởi động và đường định tuyến ở webhook. Dữ liệu dùng chung.

---

## F. Khác biệt so với v7 — nói gì khi trình bày

| | v1 | v7 |
|---|---|---|
| Lên kế hoạch | ~60 giây, chạy nền | 257 giây (đo 29/07) |
| Câu hỏi thường | 2–9 giây | 12–33 giây |
| Số lần chạy thông trọn chuỗi | hàng chục | 1 |
| Nguồn cung khách sạn | `web_search` | MCP Booking.com — inventory thật, có deep link |
| Kiến trúc | một agent, 21 tool | ba agent chuyên trách |

**Mất khi dùng v1:** nghiên cứu nhiều bước có `evidence`/`quality` kiểm chứng được, và inventory thật từ Booking.com.

**Được:** nhanh hơn 4 lần, đã chạy ổn định nhiều tuần, không có hợp đồng JSON giữa các agent để mà lệch.

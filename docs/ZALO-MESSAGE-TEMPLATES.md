# Khuôn tin nhắn Zino trên Zalo — bản thiết kế

> Ràng buộc cứng của Bot API: không nút bấm, không carousel, tin ≤2000 ký tự,
> caption ảnh ≤1000 ký tự. "Đẹp" vì thế đến từ **nhịp, khoảng trắng, emoji làm
> mốc thị giác, và ảnh** — không phải từ component.
>
> Trước khi chốt khuôn, chạy `$$send_link` trong nhóm test để biết Zalo có
> unfurl link không. Kết quả đó quyết định nhánh A hay B ở Template 1.

---

## Nguyên tắc chung

1. **Một thẻ = một tin.** Ba khách sạn là ba tin ảnh liền nhau, không phải một
   tin dài. Người dùng lướt như lướt feed, và reply được vào đúng thẻ họ thích.
2. **Emoji chỉ đứng đầu dòng, làm mốc** — 🏨 tên, 💬 liên hệ, 📍 vị trí.
   Không rắc giữa câu.
3. **Số quan trọng đứng riêng một dòng.** Giá không được lẫn vào mô tả.
4. **Mỗi thẻ tối đa 3 gạch đầu dòng.** Dài hơn là thành bảng kê, hết "tinh tế".
5. **Luôn có dòng nguồn.** Slide RISK đã hứa "luôn hiện nguồn gốc thông tin" —
   một dòng mờ cuối thẻ vừa giữ lời vừa tăng độ tin.
6. **Link OA luôn là dòng riêng, có 💬 dẫn đầu** — trên mobile nó thành vùng
   bấm rõ ràng.

---

## Template 1 — Thẻ phương án (khách sạn / quán / tour)

Khuôn cho `present_option`. Đây là thẻ xuất hiện trong demo nhiều nhất.

### Nhánh A — sendPhoto + caption (dùng khi có ảnh, ưu tiên)

```
[ẢNH: mặt tiền / view đẹp nhất của nơi đó]

🏨 Sheraton Nha Trang Hotel & Spa
2.850.000đ/đêm · 28–30/07 còn phòng

• Mặt biển Trần Phú, hồ bơi vô cực tầng 6
• Buffet sáng, đón sân bay miễn phí
• 4.6★ (2.1k đánh giá Google)

💬 Nhắn OA: zalo.me/3556873486474852721

Nguồn: Booking.com · giá xem 29/07
```

### Nhánh B — text thuần (khi không có ảnh, hoặc ảnh chết)

Thêm khung dòng kẻ để bù độ "nổi" của ảnh:

```
━━━━━━━━━━━━━━━━━━
🏨 SHERATON NHA TRANG
━━━━━━━━━━━━━━━━━━
2.850.000đ/đêm · còn phòng 28–30/07

• Mặt biển Trần Phú, hồ bơi vô cực
• Buffet sáng, đón sân bay miễn phí

💬 Nhắn OA: zalo.me/3556873486474852721
Nguồn: Booking.com · 29/07
```

### Tin chốt loạt — gửi SAU thẻ cuối, luôn là text

```
Mình nghiêng phương án 1 (Sheraton): đúng ý "gần biển"
của Lan mà vẫn dưới trần 3tr/người của Tú.

Mọi người nhắn 1️⃣ 2️⃣ hoặc 3️⃣ để chốt nhé.
```

---

## Template 2 — Loạt so sánh nhanh (khi chỉ cần liếc)

Khi nhóm hỏi kiểu "có gì rẻ hơn không" — một tin duy nhất, không ảnh:

```
So nhanh 3 chỗ đang cân:

1️⃣ Sheraton      2.850k/đêm · mặt biển · 4.6★
2️⃣ Panama        1.900k/đêm · cách biển 300m · 4.3★
3️⃣ Mường Thanh   1.450k/đêm · trung tâm · 4.1★

Cả ba đều còn phòng 28–30/07.
Nhắn số để xem thẻ chi tiết, hoặc "chốt" luôn.
```

---

## Template 3 — Xác nhận đã chốt

```
✅ Đã chốt: Sheraton Nha Trang
2 đêm · 28–30/07 · 5.700.000đ (cả nhóm)

Người chốt: Lan
Bước tiếp: Minh đặt phòng qua OA rồi nhắn
"@Zino đã thanh toán" để mình ghi sổ nhé.

💬 Đặt tại: zalo.me/3556873486474852721
```

---

## Template 4 — Sổ chi (sau mỗi lần ghi)

Tiền phải thẳng cột. Dùng dấu chấm phân cách nghìn, căn bằng khoảng trắng:

```
✓ Đã ghi: Hải sản Gành Hào 450.000đ (Lan trả, chia 3)

Sổ chi hiện tại
─────────────────────
Phòng Sheraton   5.700.000đ · Minh
Xe limousine     1.200.000đ · Tú
Hải sản            450.000đ · Lan
─────────────────────
Tổng             7.350.000đ
```

---

## Template 5 — Chốt sổ cuối chuyến

```
🧾 Chuyến Nha Trang 28–30/07 — chốt sổ

Tổng chi     7.350.000đ
Chia đều     2.450.000đ/người

Minh  đã trả 5.700.000đ  →  nhận lại 3.250.000đ
Tú    đã trả 1.200.000đ  →  gửi thêm 1.250.000đ
Lan   đã trả   450.000đ  →  gửi thêm 2.000.000đđ

Gọn nhất 2 giao dịch:
→ Tú  chuyển Minh 1.250.000đ
→ Lan chuyển Minh 2.000.000đ
```

Kèm **tin riêng** ngay sau (link tách tin để dễ bấm):

```
📱 Lịch trình, đặt chỗ và sổ tiền đầy đủ ở đây:
https://zalo.me/s/<mini-app>/?trip=<id>
```

---

## Template 6 — Nhắc hẹn

Ngắn là sống còn — nhắc hẹn dài là bị bỏ qua:

```
⏰ Mai 14:00 — xe đón tại Sài Gòn
Đồ bơi + kem chống nắng. Check-in Sheraton 16:30.
```

---

## Ánh xạ vào code

| Template | Đường gửi | Trạng thái |
|---|---|---|
| 1A | `ctx.pushPhoto` mới + `present_option` mới | **chưa có — cần làm** |
| 1B, 2, 3 | text thường / `reply` | prompt hướng dẫn là đủ |
| 4, 5 | text thường | prompt + số liệu từ tool sẵn có |
| 6 | `set_reminder` sẵn có | chỉnh format trong worker |

Thứ tự làm: nạp OA vào `partner_oas` → `pushPhoto` + `present_option` (sau cờ
`ZINO_OPTION_CARDS`) → cập nhật prompt cho 1B/2/3/4/5.

Ảnh demo: gán tay URL ảnh vào cột mới trong CSV cho ~10 OA sẽ lên hình.
Không có ảnh / ảnh chết → rơi về 1B, không được vỡ luồng.

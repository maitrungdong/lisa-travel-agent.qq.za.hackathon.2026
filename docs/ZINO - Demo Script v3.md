# ZINO Demo — Script cho clip 2 phút (v3: final)

**Core mechanics:**
- Mọi người tag `@Zino` khi cần nó ghi nhận thông tin
- Zino chốt → gửi link book → user tự chat update trạng thái
- Trong chuyến, user tag Zino để input chi phí
- App chỉ để xem: lịch trình, trạng thái đặt chỗ, settlement tiền

---

## Chuẩn bị trước khi quay

### Group chat
- Nhóm 3 người: **Lan**, **Tú**, **Minh** (người tổ chức)
- Tên nhóm: "QQ za.hackathon"

### Mock data pin sẵn
- Malibu Resort: 3.6tr, link sẵn (copy-paste)
- 2 phương án khách sạn A/B
- Lịch trình 3 ngày
- Kịch bản vote: cả ba chọn A
- Chi phí mẫu: vé, xe, ăn, room

---

## Kịch bản demo — 120 giây

### **Phút 00:00–00:15 · TAG 1: Minh nêu nhu cầu + Zino interview**

```
[Quay chat "QQ za.hackathon"]

MINH:  @Zino ơi. Giúp tao lên kế hoạch đi Vũng Tàu.
       28–30/07, 3 người (tao + Lan + Tú), budget 9 triệu.

ZINO:  Okay. Mình hỏi mọi người để hiểu nhu cầu:
       
       @Lan — bạn đi Vũng Tàu muốn ưu tiên gì?
       (ví dụ: biển gần, ăn tốt, chill, adventure...)
       
       @Tú — bạn quan tâm nhất cái gì?
       (ví dụ: giá, thời gian, dịch vụ...)
```

**Lưu ý quay:**
- Zoom vào tin tag `@Zino` của Minh
- Highlight dòng "@Lan" và "@Tú" — agent chủ động hỏi

---

### **Phút 00:15–00:35 · NHÓM REPLY TAG ZINO + ZINO TÓM TẮT & ĐỀ XUẤT**

```
[Mọi người reply với tag]

@LAN:  Muốn khách sạn gần biển, sáng dậy nhìn ra biển.

@TÚ:   Giá chủ yếu. Max 3 triệu/người.

@MINH: Em chỉ muốn xong nhanh.

[Chờ ~1s]

ZINO:  Okay tập hợp lại:
       • Lan: khách sạn gần biển ✓
       • Tú: giá max 3tr/người ✓
       • Minh: xong nhanh ✓
       
       Mình tìm được 2 phương án:
       
       A. Malibu Resort 3.600.000đ (2 đêm)
          • 400m tới Bãi Sau, phòng view biển
          • In budget, satisfy gần biển
       
       B. Seaside Beach Front 4.100.000đ (2 đêm)
          • Mặt biển trực tiếp, view đẹp hơn
          • Vượt budget Tú 500k
       
       Mình gợi ý A — cân bằng tốt nhất.
       Mọi người vote A hay B?
       Ai nhiều phiếu, mình sẽ chốt ngay.
```

**Lưu ý quay:**
- Quay từng reply tag (@Lan, @Tú, @Minh) — highlight mọi người đều participate qua tag
- Zoom vào dòng Zino tóm tắt ràng buộc
- Zoom vào dòng so sánh A vs B + gợi ý

---

### **Phút 00:35–01:00 · VOTE + CHỐT + GỬI LINK BOOK + USER TỰ THANH TOÁN**

```
@LAN:  Vote A.

@TÚ:   Vote A.

[Minh ko comment, mặc định ok]

ZINO:  ✅ Chốt A. Malibu Resort — 3A (toàn bộ).
       
       Link book: [fake link malibu.com/booking/12345]
       
       @Minh — bạn vô link này, xác nhận + thanh toán 3.6tr.
       Xong rồi tag @Zino "đã thanh toán" nhé.

[~30s sau]

MINH:  @Zino xong rồi. Vừa thanh toán 3.6tr.

ZINO:  ✓ Ghi nhận. Malibu Resort — đã thanh toán.
       
       Chi phí update:
       • Minh trả: 3.600.000đ (phòng)
       • Tú trả: 1.200.000đ (xe — chưa confirm)
       • Lan trả: 450.000đ (ăn — chưa confirm)
       
       Tổng: 5.250.000đ
       Chia đều 3: 1.750.000đ/người
       
       → Lan còn thiếu 1.3tr
       → Tú còn thiếu 550k
       → Minh dư 1.85tr
       
       [Sẽ recalc khi vé máy bay confirm]
       
       ➜ Tiếp: vé máy bay
       
       @Minh @Lan @Tú — muốn bay sáng/chiều/tối?
```

**Lưu ý quay:**
- **Highlight chỗ này:** Zino gửi link nhưng không tự thanh toán
- User tự vô link, tự bấm thanh toán với OA
- User tag update "đã thanh toán" → Zino ghi nhận
- **Show rõ ranh giới:** Zino không có quyền hạn tài chính, chỉ là coordinator

---

### **Phút 01:00–01:20 · TRONG CHUYẾN: INPUT CHI PHÍ**

```
[Transition: "Hôm 29/07, nhóm đang ở Vũng Tàu"]

LAN:   @Zino tao vừa ăn hải sản 450k
       Địa chỉ: Gành Hào quán
       Chi cho 3 người

ZINO:  ✓ Ghi nhận.
       Hải sản Gành Hào: 450.000đ (chia 3)
       
       [Nhật ký: Lan input 450k]

TÚ:    @Zino tao thuê xe từ hôm qua
       Tổng 3 ngày: 1.200.000đ
       Split 3 người

ZINO:  ✓ Ghi nhận.
       Xe limousine 3 ngày: 1.200.000đ (chia 3)
       
       [Nhật ký: Tú input 1.2tr]
       
       Hiện tại:
       • Phòng 3.6tr (Minh trả)
       • Vé 1.95tr (chia 3 người)
       • Ăn 450k (Lan trả)
       • Xe 1.2tr (Tú trả)
       → Còn lại chia tiền khi về
```

**Lưu ý quay:**
- **User chủ động tag input chi phí**, không chờ Zino hỏi
- Zino ghi nhận + tóm tắt liền
- Tính toán chia tiền sơ khai

---

### **Phút 01:20–01:55 · APP DEMO**

```
[Switch browser → mở app]

NARRATOR:
"Bên app, mọi người có thể xem toàn bộ thông tin
chuyến đi: lịch trình, trạng thái đặt chỗ, 
và cách chia tiền."

[Scroll qua app, quay nhanh 10-15s:]

📋 TAB TỔNG QUAN:
  ✅ Chuyến Vũng Tàu 28–30/07
  ✅ Malibu Resort đã đặt (2 đêm)
  ✅ Vé VN215 chiều đã đặt (3 người)
  ⏳ Lịch trình (3 ngày)
  
📅 TAB LỊCH TRÌNH:
  Ngày 1 (28/07):
    14:00 Sân bay Tân Sơn Nhất
    16:30 Check-in Malibu Resort
    19:00 Ăn tối Gành Hào
  
  Ngày 2 (29/07):
    08:00 Bãi Sau
    12:00 Hải sản Gành Hào
    15:00 Tour Nho Quế
  
  Ngày 3 (30/07):
    08:00 Cafe sáng
    11:00 Sân bay về

📍 TAB QUẢN LÝ ĐẶT CHỖ:
  ✅ Malibu Resort — voucher đã gửi
    Phòng 301–302 · 2 đêm
    [Xem chi tiết]
  
  ✅ Vé VN215 — voucher đã gửi
    Chiều 14:30 → 16:30
    [Xem chi tiết]

💰 TAB SETTLEMENT:
  Tổng: 6.8tr
  
  Ai trả gì:
  • Minh: phòng 3.6tr
  • Tú: xe 1.2tr
  • Lan: ăn 450k
  
  Chia đều:
  • Minh: +1.8tr (phòng)
  • Tú: +260k (xe chênh)
  • Lan: −150k (ăn chênh)
  
  → Minh nhận Tú 260k + Lan nhận 150k
  → 2 giao dịch là xong

[App scroll xong]

NARRATOR:
"Chat trôi. App là kho dữ liệu cố định.
Mỗi chi phí, Zino ghi down — ai trả ai, chia tiền thế nào."
```

**Lưu ý quay:**
- Quay app **nhanh**, chỉ scroll qua các tab chính
- **Nhấn vào tab Settlement** — hiện cách chia tiền tối thiểu (2 giao dịch)
- Đừng chi tiết, chỉ để show rõ app có 3 tab chính: Lịch trình, Quản lý đặt chỗ, Settlement

---

### **Phút 01:55–02:00 · CLOSING — 2 câu chốt**

```
[Quay lại chat, hoặc overlay text on black]

NARRATOR:
"ZINO không phải chatbot. Nó là một thành viên thứ 4:

🎯 INTERVIEW: Nghe ai muốn gì
✅ CHỐT: Nêu phương án, để nhóm vote
🔗 ĐẶT CHỖ: Gửi link, user confirm
📝 GHI NHẬN: Mỗi chi phí, mỗi update user tag vào
💰 TÍNH TOÁN: Chia tiền tối thiểu, báo ai trả ai

Kết quả: nhóm chat được tự do, sổ app ở lại."

[Fade to black]
[TỔNG: 120 giây]
```

---

## Timeline quay

| Giai đoạn | Công việc | Thời gian |
|---|---|---|
| **Prep** | Script, mock link, seed app data | 20ph |
| **Quay chat** | Tag interview → vote → chốt + link → input chi phí | 25ph |
| **Quay app** | Demo nhanh 3 tab | 8ph |
| **Quay narrator** | Closing 5s | 5ph |
| **Edit** | Cut, timing, subtitle | 1h |
| **Tổng** | | ~2h |

---

## 3 câu chốt khi present

1. **"Zino không có quyền hạn tài chính."**
   - Zino chỉ gửi link booking, user tự vào thanh toán
   - User tag Zino để update "đã thanh toán" → Zino ghi nhận
   - Zino không rút tiền, không ứng tiền, không tự ý làm gì
   → Ranh giới rõ ràng giữa agent và người dùng

2. **"Mọi quyết định có signature của người làm."**
   - Interview: mọi người tag reply ý kiến
   - Chốt: mọi người tag vote A/B
   - Thanh toán: mọi người tag "đã thanh toán"
   - Input chi phí: mọi người tag update
   → Zino chỉ ghi nhận + tính toán, không tự ý

3. **"Chat là tự do, sổ app là chắc chắn."**
   - Chat thì bàn luận tự do, mọi tin ngang hàng
   - App thì lịch trình chắc, đặt chỗ chắc, tiền chắc
   - Lần sau đi chơi, Zino biết setup như nào

---

## Mock data checklist

- [ ] Link book fake (Malibu booking URL)
- [ ] Vé máy bay option (3 giá/giờ)
- [ ] Lịch trình 3 ngày (sẵn framework)
- [ ] Chi phí mẫu (hải sản 450k, xe 1.2tr)
- [ ] App database seed (lịch + đặt chỗ + settlement)

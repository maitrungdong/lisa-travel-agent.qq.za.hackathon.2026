# ZINO Demo — Script cho clip 2 phút (v4)

> Kế thừa v3. Ba thay đổi: bỏ máy bay (Vũng Tàu không có sân bay), sửa bảng
> chia tiền cho khớp số, và thêm link Mini App ở đoạn chuyển sang settlement.

**Core mechanics:**
- Mọi người tag `@Zino` khi cần nó ghi nhận thông tin
- Zino chốt → gửi link book → user tự chat update trạng thái
- Trong chuyến, user tag Zino để input chi phí
- Hết chuyến, Zino gửi link Mini App — app chỉ để **xem**: lịch trình, đặt chỗ, settlement
- **Không có bước nào bắt user xác nhận trong app.** Mọi xác nhận đều bằng tag trong chat

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
- Chi phí mẫu: phòng, xe, ăn
- **Link Mini App của chuyến** (dạng `.../mini-app?trip=<id>`) — copy sẵn

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

[Chờ ~2s — Zino gom cả ba tin thành một lượt]

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
- **Chỗ này đáng khoe:** ba người tag gần như cùng lúc, Zino chỉ trả lời **một lần**
  gom đủ ba ý — không phải ba câu rời rạc
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
       Minh trả 3.600.000đ (phòng).

       Chi phí khác mọi người cứ tag mình trong chuyến,
       cuối chuyến mình chốt sổ một lần.

       ➜ Tiếp: đi lại. Nhóm mình đi xe từ Sài Gòn hay tự lái?
```

**Lưu ý quay:**
- **Highlight chỗ này:** Zino gửi link nhưng không tự thanh toán
- User tự vô link, tự bấm thanh toán với OA
- User tag update "đã thanh toán" → Zino ghi nhận
- **Show rõ ranh giới:** Zino không có quyền hạn tài chính, chỉ là coordinator

---

### **Phút 01:00–01:25 · TRONG CHUYẾN: INPUT CHI PHÍ**

```
[Transition: "Hôm 29/07, nhóm đang ở Vũng Tàu"]

LAN:   @Zino tao vừa ăn hải sản 450k
       Địa chỉ: Gành Hào quán
       Chi cho 3 người

ZINO:  ✓ Ghi nhận.
       Hải sản Gành Hào: 450.000đ — Lan trả, chia 3

TÚ:    @Zino tao thuê xe limousine từ hôm qua
       Tổng 3 ngày: 1.200.000đ
       Split 3 người

ZINO:  ✓ Ghi nhận.
       Xe limousine 3 ngày: 1.200.000đ — Tú trả, chia 3

       Sổ chi hiện tại:
       • Phòng Malibu     3.600.000đ  (Minh)
       • Xe limousine     1.200.000đ  (Tú)
       • Hải sản Gành Hào   450.000đ  (Lan)
       ─────────────────────────────
       Tổng               5.250.000đ
```

**Lưu ý quay:**
- **User chủ động tag input chi phí**, không chờ Zino hỏi
- Zino ghi nhận + tóm tắt liền
- Dừng ở tổng, chưa chia — để dành cho đoạn sau

---

### **Phút 01:25–01:35 · HẾT CHUYẾN: ZINO CHỐT SỔ + GỬI LINK MINI APP**

```
[Transition: "Tối 30/07, về tới nhà"]

MINH:  @Zino chuyến xong rồi, chia tiền đi.

ZINO:  Chuyến Vũng Tàu 28–30/07 đã khép.

       Tổng chi 5.250.000đ · chia đều 1.750.000đ/người

       • Minh trả 3.600.000đ  → dư 1.850.000đ
       • Tú   trả 1.200.000đ  → thiếu   550.000đ
       • Lan  trả   450.000đ  → thiếu 1.300.000đ

       Gọn nhất là 2 giao dịch:
       → Tú chuyển Minh    550.000đ
       → Lan chuyển Minh 1.300.000đ

ZINO:  [tin nhắn riêng, gửi ngay sau]

       Toàn bộ lịch trình, đặt chỗ và sổ tiền ở đây:
       https://zalo.me/s/<mini-app>/?trip=<id>
```

**Lưu ý quay:**
- **Đây là chỗ link Mini App xuất hiện** — sau khi chuyến khép, không phải giữa chừng
- Quay link là **một tin nhắn riêng**, không dính vào tin settlement.
  Đúng như hệ thống đang chạy: Zino tách link ra tin riêng cho dễ bấm
- Số phải khớp tuyệt đối với tab Settlement ở đoạn sau — giám khảo sẽ đối chiếu

---

### **Phút 01:35–01:55 · APP DEMO**

```
[Bấm vào link → mở Mini App]

NARRATOR:
"Bấm vào link, mọi người xem được toàn bộ thông tin
chuyến đi: lịch trình, trạng thái đặt chỗ,
và cách chia tiền. App chỉ để xem — không phải
bấm xác nhận gì thêm."

[Scroll qua app, quay nhanh 10-15s:]

📋 TAB TỔNG QUAN:
  ✅ Chuyến Vũng Tàu 28–30/07
  ✅ Malibu Resort đã đặt (2 đêm)
  ✅ Xe limousine 3 ngày
  ⏳ Lịch trình (3 ngày)

📅 TAB LỊCH TRÌNH:
  Ngày 1 (28/07):
    14:00 Xe đón tại Sài Gòn
    16:30 Check-in Malibu Resort
    19:00 Ăn tối Gành Hào

  Ngày 2 (29/07):
    08:00 Bãi Sau
    12:00 Hải sản Gành Hào
    15:00 Tượng Chúa Kitô Vua

  Ngày 3 (30/07):
    08:00 Cafe sáng
    11:00 Xe về Sài Gòn

📍 TAB QUẢN LÝ ĐẶT CHỖ:
  ✅ Malibu Resort — voucher đã gửi
    Phòng 301–302 · 2 đêm
    [Xem chi tiết]

  ✅ Xe limousine — đã đặt
    3 ngày · đón tại Sài Gòn
    [Xem chi tiết]

💰 TAB SETTLEMENT:
  Tổng: 5.250.000đ
  Chia đều: 1.750.000đ/người

  Ai đã trả gì:
  • Minh — phòng     3.600.000đ
  • Tú   — xe        1.200.000đ
  • Lan  — ăn          450.000đ

  Cân đối:
  • Minh   dư 1.850.000đ
  • Tú   thiếu   550.000đ
  • Lan  thiếu 1.300.000đ

  → Tú chuyển Minh    550.000đ
  → Lan chuyển Minh 1.300.000đ
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
- **Không bấm nút xác nhận nào trong app** — đó là điểm phân vai: quyết định ở chat, app chỉ đọc

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
| **Quay chat** | Tag interview → vote → chốt + link → input chi phí → chốt sổ + link app | 28ph |
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
- [ ] Lịch trình 3 ngày (sẵn framework)
- [ ] Chi phí mẫu: phòng 3.6tr / xe 1.2tr / hải sản 450k
- [ ] App database seed (lịch + đặt chỗ + settlement)
- [ ] **Link Mini App của chuyến** — copy sẵn để dán vào chat

---

## Kiểm tra số trước khi quay

Toàn bộ demo chỉ có ba khoản. Nếu đổi số, đổi cả ba chỗ: tin chốt sổ ở phút
01:25, tab Settlement ở phút 01:35, và checklist trên.

```
Minh 3.600.000 + Tú 1.200.000 + Lan 450.000 = 5.250.000
5.250.000 / 3 = 1.750.000

Minh 3.600.000 − 1.750.000 = +1.850.000   (nhận)
Tú   1.200.000 − 1.750.000 =   −550.000   (trả)
Lan    450.000 − 1.750.000 = −1.300.000   (trả)

550.000 + 1.300.000 = 1.850.000  ✓ cân
```

Hai giao dịch là tối thiểu vì chỉ có một người dư.

# Kịch bản demo Zino — 5 phút

> Thành phố: **Vũng Tàu**. Lý do: `themalibuhotel` là OA thật đã xác thực,
> `openChat` mở được chat thật trên sân khấu.
>
> Cột **Trạng thái** ghi trung thực từng phần đã kiểm chứng tới đâu.
> Ô nào còn ❓ thì phải test trước khi lên sân khấu.

---

## Chuẩn bị

| | |
|---|---|
| Thiết bị | **Điện thoại của bạn**, chiếu màn hình lên máy chiếu |
| Vì sao không để giám khảo tự quét | Mini App bản `development` chỉ mở được bằng tài khoản đã thêm vào danh sách thử nghiệm |
| Nhóm Zalo | Tạo sẵn, đã add bot, đã có vài lượt chat cũ để bộ nhớ dài hạn có dữ liệu |
| Ảnh cần có sẵn trong máy | 1 ảnh hoá đơn quán ăn · 1 ảnh phong cảnh |
| Mở sẵn ở tab khác | `docker compose logs -f api` để chứng minh hệ thống thật đang chạy |

---

## Mạch 5 phút

### 0:00 — Zino nhớ nhóm này

Add Zino vào nhóm, hoặc nhắn "chào Zino".

> *"Lại là nhóm Vũng Tàu năm ngoái! Vẫn né hải sản cho Đông nhỉ?"*

**Chứng minh:** trí nhớ tầng 3 — bền qua từng chuyến đi, không phải context window.
Đây là thứ phân biệt "chatbot" với "trợ lý biết bạn".

**Trạng thái:** ❓ cần chạy vài lượt chat trước đó để `group_memory` có nội dung.

### 0:30 — Tạo chuyến đi

> *"Nhóm mình đi Vũng Tàu 12–14/8, 6 người, ngân sách 3tr/người"*

Zino hỏi lại 1–2 câu còn thiếu rồi mới tạo.

**Chứng minh:** không đoán bừa. Xác nhận trước khi ghi dữ liệu.

**Trạng thái:** ✅ đã chạy được.

### 1:00 — Research thật, chạy nền

> *"Lên lịch trình giúp mình"*

Zino: *"Để mình research chút nha"* → kết thúc lượt → **~60 giây sau tự nhắn** lịch trình 3 ngày kèm giá.

**Chứng minh:** agent chạy nền có tra cứu web thật, và **push chủ động** — Zalo Bot API không có cửa sổ 48h như OA.

**Trạng thái:** ❓ chưa test end-to-end.

### 2:00 ⭐ — Chuyển tiếp sang OA đối tác

> *"Tìm chỗ ở gần biển giúp mình"*

Zino đưa danh sách → mở Mini App tab **Đối tác** → chọn **Khách sạn Malibu** → bấm *"Nhờ Zino soạn tin hỏi"* → màn Handoff hiện tin đã soạn đầy đủ ngày, số người, ngân sách → bấm **"Mở chat"** → Zalo mở đúng chat Malibu, ô soạn thảo **đã có sẵn nội dung**.

**Nói ngay tại đây** (giám khảo Zalo chắc chắn sẽ hỏi):

> *"Zalo không có API cho bot nhắn thay user — và điều đó đúng, nó bảo vệ người dùng. Zino không lách. Zino soạn hộ câu hỏi hoàn chỉnh, quyền bấm Gửi vẫn là của bạn."*

**Trạng thái:** ❓ phải test trên điện thoại — `openChat` không chạy trên desktop.

### 2:45 — Đọc hoá đơn

Gửi ảnh hoá đơn vào nhóm. Zino đọc đúng tổng tiền, ghi chi phí, chia đầu người.

**Chứng minh:** không dùng dịch vụ OCR. Claude vision hiểu ngữ cảnh — biết "Tổng cộng" mới là số cần lấy, "VAT" không phải món ăn.

**Trạng thái:** ❓ chưa test.

### 3:15 — Ảnh kỷ niệm

Gửi ảnh phong cảnh → vào album Mini App kèm caption Zino tự viết.

**Trạng thái:** ❓ chưa test.

### 3:45 — Chia tiền

> *"Chia tiền đi"*

Bảng ai chuyển cho ai, **số giao dịch tối thiểu**.

**Chứng minh:** số tiền tính bằng code, không để LLM cộng trừ. Bảo toàn tổng tuyệt đối, có unit test.

**Trạng thái:** ✅ thuật toán đã verify 35/36 assertion.

### 4:15 — Trang tổng kết

> *"Tổng kết chuyến đi giúp mình"*

~60 giây sau Zino gửi link `zah-35.123c.vn/trip/<id>/` — trang web có timeline, gallery, bảng chi tiêu.

**Chứng minh:** bố cục và mọi con số do code dựng (`apps/api/src/trips/recap.ts`, 16 unit test),
LLM chỉ viết đoạn lời tựa. Nên số trên trang này **khớp từng đồng** với màn Chi phí của Mini App —
không có chuyện hai nơi hai số.

**Trạng thái:** ✅ renderer có test · ❓ chưa test end-to-end qua job.

**Nếu job recap hỏng giữa demo:** mở thẳng `https://zah-35.123c.vn/api/trips/<id>/recap.html` —
API tự dựng trang tại chỗ, không cần worker chạy trước. Mini App cũng có nút
"Mở trang tổng kết chuyến đi" ở Trang chủ.

### 4:45 — Partner Network

Mở `docs/PARTNER-NETWORK.md`, chỉ vào sơ đồ.

> *"Bước tiếp theo: khi khách sạn uỷ quyền OA cho Zino, câu trả lời của họ tự động quay về nhóm chat — user chỉ bấm Gửi đúng một lần. Chúng em đã implement đủ OAuth v4 PKCE, webhook OA và merchant agent; code trong repo. Chỉ vướng bước Zalo duyệt ứng dụng, mất vài ngày."*

**Trạng thái:** ✅ code có thật · ❌ chưa chạy được do `error -14029`.

---

## Ba câu hỏi khó và cách trả lời

**"Các bạn dùng API nào để nhắn cho OA?"**
> Không có API nào cho phép việc đó, và bọn em không lách. Dùng `openChat` của Mini App SDK — Zalo cho phép điền sẵn nội dung, quyền gửi thuộc về user. Bọn em có khảo sát `zca-js` nhưng loại ngay vì vi phạm ToS.

**"Dữ liệu đối tác ở đâu ra?"**
> Zalo không có API tìm kiếm OA. Bọn em tự dựng directory. Malibu là OA thật; mấy chỗ còn lại là dữ liệu mẫu — bọn em nói rõ chỗ nào thật chỗ nào mô phỏng.

**"Sao không dùng Zalo OA thay vì Bot?"**
> OA cần doanh nghiệp xác thực và app phải được duyệt. Bot API cho token ngay và **không giới hạn cửa sổ 48h** nên nhắc lịch trình chủ động được. Đổi lại mất nút bấm và markdown — nên mọi UI giàu bọn em đẩy sang Mini App.

---

## Trước khi lên sân khấu

- [ ] Thêm tài khoản team vào **danh sách thử nghiệm** Mini App
- [ ] Chạy đủ mạch 5 phút **hai lần**, lần hai bấm giờ
- [ ] Nạp sẵn `group_memory` bằng vài lượt chat trước đó
- [ ] Chuẩn bị ảnh hoá đơn + ảnh phong cảnh trong máy
- [ ] Kiểm tra `curl https://zah-35.123c.vn/api/health`
- [ ] Sạc pin điện thoại, tắt thông báo
- [ ] **Quay video màn hình một lượt chạy thành công** — mạng hỏng vẫn còn cái để chiếu

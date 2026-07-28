# Go-live: đưa Zino Mini App lên production

> Tiếp nối [`08-build-mini-app.md`](./08-build-mini-app.md) (build & deploy bản dev) và
> [`05-ci-cd-zalo-mini-app.md`](./05-ci-cd-zalo-mini-app.md) (thiết kế pipeline).
> Doc này lo phần **từ bản TESTING → người dùng thật**, tức phần `zmp deploy` **không** làm được.
>
> Nguồn: `docs.zaloplatforms.com` (cập nhật 15/6/2026) + đọc source `zmp-cli@4.0.3`.
> Chỗ nào chưa xác minh được đều đánh dấu ⚠️.

---

## 0. Bản đồ toàn cảnh

```
┌─ TỰ ĐỘNG HOÁ ĐƯỢC ──────────────────┐   ┌─ THỦ CÔNG TRÊN CONSOLE ─────────────┐
│                                     │   │                                     │
│  build → zmp deploy --testing       │──►│  gửi xét duyệt → Zalo review        │
│  (CI: release.yml)                  │   │  → Đã duyệt → bấm Publish           │
└─────────────────────────────────────┘   └─────────────────────────────────────┘
        ↑ điểm dừng của pipeline                    ↑ không có API cho dev thường
```

Open API `deployMiniApp` / `publishMiniApp` / `requestPublishMiniApp` chỉ mở cho **đối tác giải
pháp đã ký hợp tác** với Zalo. Team tự phát triển bắt buộc bấm tay ở bước phát hành.

**5 cổng chặn, theo đúng thứ tự phải vượt qua:**

| # | Cổng | Trạng thái Zino | Ở đâu |
|---|---|---|---|
| 1 | Zalo App đã **Kích hoạt ứng dụng** | cần kiểm tra | developers.zalo.me → Cài đặt |
| 2 | Mini App đã **xác thực** (OA hoặc giấy tờ) | ❌ **chưa** — chặn cứng | mini.zalo.me/developers |
| 3 | Quyền cần duyệt đã xin | ✅ không cần (xem §2) | Mini App Center → Quản lý quyền |
| 4 | Có bản **TESTING** trên Quản lý phiên bản | cần deploy | `zmp deploy --testing` |
| 5 | Bản TESTING được **duyệt** rồi **Publish** | chưa | Mini App Center |

---

## 1. Xác thực Mini App — làm trước tiên

Đây là việc mất thời gian nhất và **không phụ thuộc vào code**, nên khởi động song song với
mọi việc kỹ thuật khác. Chưa xác thực thì không gửi xét duyệt phiên bản được.

Hai đường:

| Cách | Điều kiện | Ghi chú |
|---|---|---|
| **Xác thực bằng OA** | Có Official Account đã xác thực | Nhanh hơn nếu OA của team đã verified sẵn |
| **Xác thực bằng giấy tờ** | Giấy phép kinh doanh / giấy tờ pháp nhân | Dùng khi chưa có OA verified |

Thao tác: [mini.zalo.me/developers](https://mini.zalo.me/developers) → chọn Mini App → mục
xác thực. ⚠️ **Chưa xác minh được SLA duyệt hồ sơ xác thực** — Zalo không công bố. Coi như biến
số lớn nhất của lịch go-live; hỏi trước qua [Zalo Mini App Community](https://mini.zalo.me/community)
nếu deadline gấp.

> **Bẫy:** thông tin Mini App (tên, mô tả, danh mục) sau khi tạo **không tự sửa được** — phải mở
> ticket hỗ trợ và chờ kiểm duyệt xác nhận. Kiểm tra kỹ tên/logo/mô tả **trước** khi xác thực,
> vì tiêu chí kiểm duyệt yêu cầu ba thứ này phải khớp với tính năng thật của app (§5).

---

## 2. Quyền — Zino cần xin những gì

Chỉ một nhóm API cần Zalo cấp quyền, và **không xin thì app chạy được với Developer/Admin nhưng
lỗi với người dùng thường** — đây là loại bug chỉ lộ ra sau khi live:

```
getPhoneNumber · getLocation · openMediaPicker · requestCameraPermission
keepScreen · nhóm API Native Storage
```

Đối chiếu `apps/miniapp/src/lib/zalo.ts` — Zino hiện dùng:

| API | Nhóm | Cần Zalo duyệt? |
|---|---|---|
| `getUserInfo({ autoRequestPermission: true })` | User Information | Không (name/avatar). Chỉ **số điện thoại** mới cần |
| `openChat({ type: "oa", ... })` | Zalo Permission — mở cửa sổ chat | Mặc định |
| `openWebview({ url })` | Mini App | Mặc định |

**Kết luận: Zino không cần xin quyền nào.** Nhưng nếu trước ngày demo có ai thêm `getPhoneNumber`,
chụp ảnh, hay vị trí thì phải quay lại bước này — Mini App Center → **Quản lý quyền** → chọn quyền
→ **mô tả lý do + ảnh chụp màn hình** → gửi. Bộ phận kiểm duyệt xét quyền **cùng lúc** với xét
duyệt phiên bản, nên xin muộn = trễ cả release.

---

## 3. Chuẩn bị production trước khi bấm deploy

### 3.1 API phải đạt chuẩn của webview Zalo

| Yêu cầu | Vì sao | Kiểm tra |
|---|---|---|
| `https://` + SSL còn hạn, **không dùng IP trần** | Mini App chạy trong Secure Context | `curl -sI https://<domain>/api/health` |
| CORS trả đúng **một** origin `https://h5.zdn.vn` | Trả nhiều origin cách nhau bởi dấu phẩy là **không hợp lệ** | xem dưới |
| CORS áp cả cho method `OPTIONS` (preflight) | Lỗi phổ biến nhất: đặt CORS cho GET/POST mà quên OPTIONS | |

`apps/api/src/main.ts` đang đọc `origin` từ `CORS_ORIGINS` dạng mảng — thư viện `cors` sẽ phản chiếu
đúng một origin khớp, nên cấu hình này hợp lệ. Việc cần làm là đảm bảo giá trị trên VPS có
`https://h5.zdn.vn`:

```bash
ssh -p 2222 zah19-team35@118.102.2.135 "grep '^CORS_ORIGINS=' /opt/zino/.env"
# phải chứa https://h5.zdn.vn
```

Kiểm chứng preflight thật:

```bash
BASE=https://<domain-prod>
curl -si -X OPTIONS "$BASE/api/health" \
  -H "Origin: https://h5.zdn.vn" \
  -H "Access-Control-Request-Method: GET" | grep -i access-control
# kỳ vọng: Access-Control-Allow-Origin: https://h5.zdn.vn  (đúng 1 giá trị)
```

### 3.2 Giới hạn dung lượng — con số chính thức

| Giới hạn | Giá trị | Zino hiện tại |
|---|---|---|
| Toàn bộ bản build | **10 MB** | `www/` ≈ 380 KB ✅ |
| Mỗi file đơn lẻ | **3 MB** | `app.js` ≈ 360 KB ✅ |

`scripts/check-bundle-size.mjs` đang để `MAX_BUNDLE_MB=8` — giữ nguyên, biên an toàn hợp lý so với
mốc 10 MB. Thoải mái, nhưng đừng nhét ảnh/video vào bundle: static asset nặng phải đưa lên
server/CDN riêng.

### 3.3 Quota deploy — đừng đốt trước ngày demo

| Loại phiên bản | Quota / 30 ngày |
|---|---|
| Development | **300** |
| Testing | **60** |

Hết quota → `You have reached your 30-day deployment limit`. Dùng bản DEVELOPMENT cho vòng lặp
hàng ngày, chỉ tiêu TESTING khi thật sự chuẩn bị gửi duyệt.

### 3.4 Target build

Zalo mặc định đóng gói ở **ES2015**. Zino tự build bằng Vite (`vite.config.ts` không set
`build.target`) nên đang chạy theo default của Vite — hiện đại hơn ES2015.

⚠️ **Chưa xác minh:** máy Android đời cũ trong tập người dùng thật có chạy được bundle này không.
Nếu xét duyệt hoặc người dùng báo màn hình trắng, thêm vào `vite.config.ts`:

```ts
build: { target: "es2015", /* ... */ }
```

Đánh đổi: bundle to hơn, nhưng tương thích rộng hơn. Với hackathon thì để nguyên; với production
thật thì nên hạ target.

### 3.5 Checklist trước khi build bản TESTING

- [ ] `VITE_API_BASE_URL` trỏ **domain production**, không phải tunnel/dev
- [ ] Build lại sau khi sửa `.env` — biến bị inline vào bundle, sửa `.env` không đủ
- [ ] `VITE_ENABLE_MOCK=false`
- [ ] Không có secret nào trong biến `VITE_*` (bundle là public, ai cũng đọc được)
- [ ] `app-config.json` khớp tên file build ra: `assets/app.js` + `assets/app.css`
- [ ] Tên / logo / mô tả trên Mini App Center mô tả đúng tính năng thật
- [ ] Không có màn hình đăng nhập username+password truyền thống (§5, gây tắt tìm kiếm)

---

## 4. Deploy bản TESTING

### Cách 1 — qua CI (khuyến nghị)

```bash
git tag v1.0.0 && git push origin v1.0.0
```

`release.yml` → job `deploy-testing` dùng environment `production` → **dừng chờ người duyệt** →
deploy với version status `testing` → tạo GitHub Release.

### Cách 2 — chạy tay từ máy dev

```bash
cd projects/zino-travel-agent

# 1. Trỏ đúng API production
grep -v '^VITE_API_BASE_URL=' apps/miniapp/.env > /tmp/mini.env || true
echo "VITE_API_BASE_URL=https://<domain-prod>/api" >> /tmp/mini.env
mv /tmp/mini.env apps/miniapp/.env

# 2. Build
pnpm install && pnpm --filter miniapp build

# 3. Deploy — CHÚ Ý: testing, không phải development
cd apps/miniapp
ZMP_APP_ID=<mini_app_id> \
ZMP_TOKEN=<token> \
ZMP_VERSION_STATUS=testing \
ZMP_DESCRIPTION="v1.0.0 — bản gửi xét duyệt đầu tiên" \
node ../../scripts/zmp-deploy.mjs
```

`ZMP_VERSION_STATUS=testing` là **điểm khác biệt duy nhất** so với doc 08. Thiếu nó thì bản deploy
là DEVELOPMENT — không hiện trong Quản lý phiên bản, không gửi duyệt được.

### Kiểm thử bản TESTING

Mở `https://zalo.me/s/<MINI_APP_ID>/` **bằng tài khoản Zalo nằm trong tập Developer/Admin**.

> Tài khoản ngoài tập này sẽ thấy *"Trang này không tìm thấy hoặc không hợp lệ"* — đó là hành vi
> đúng, không phải bug. Muốn người khác test thì thêm họ vào Developer/Admin trước.

Debug trên máy thật: thêm `?zDebug=true` vào deeplink → hiện icon Debug với console/network
(dùng được cả trên bản Live).

Duyệt hết checklist chức năng ở [`08-build-mini-app.md`](./08-build-mini-app.md) §Bước 4 trước khi
gửi duyệt. Bản bị từ chối tốn cả vòng review.

---

## 5. Gửi xét duyệt

[mini.zalo.me/developers](https://mini.zalo.me/developers) → **Quản lý phiên bản** →
**Danh sách phiên bản** → chọn bản Testing → **gửi yêu cầu xét duyệt**.

Trạng thái đi qua: `Testing` → `Chờ xét duyệt` → `Đã duyệt` / bị từ chối.

### Tiêu chí kiểm duyệt (bản tóm tắt của Zalo)

- Tên, logo, mô tả thể hiện đúng tính năng, nhất quán, không vi phạm bản quyền
- Dịch vụ trong app phù hợp **danh mục đã đăng ký**
- Không điều hướng sang link bên thứ 3 khi chưa được Zalo chấp thuận
- Không khuyến khích người dùng chia sẻ / tải app riêng thay vì Mini App
- Không nội dung sai lệch, gian lận, lừa đảo, giả mạo
- Không quảng cáo / kiếm tiền khi chưa được Zalo chấp thuận
- Không mua bán vật phẩm ảo, nội dung số
- Không crash, không gây crash Zalo
- Đạt chuẩn performance & thời gian load
- Đạt chuẩn UI/UX theo [Design Guidelines](https://docs.zaloplatforms.com/docs/MA/intro/zalo-mini-program-design-guidelines)
- Bảo đảm quyền riêng tư, không mã độc
- **Định danh người dùng theo chuẩn Authentication của Zalo**

Chi tiết đầy đủ: [Thỏa thuận Chương trình Zalo Mini App](https://mini.zalo.me/documents/zalo-mini-app-developer-program-agreement/).

### Rủi ro riêng của Zino

| Điểm | Rủi ro | Cách giảm |
|---|---|---|
| `openWebview` mở trang tổng kết chuyến đi | Bị coi là "điều hướng link bên thứ 3" | Trang đích phải thuộc domain của team; mô tả rõ trong nội dung gửi duyệt |
| `openChat` sang OA đối tác | Có thể bị soi là điều hướng ngoài | Nêu rõ đây là tính năng lõi: người dùng chủ động bấm, nội dung chỉ điền sẵn, **người dùng quyết định gửi hay không** |
| Nội dung do AI sinh | Không có tiêu chí riêng nhưng dễ bị soi độ chính xác | Không hứa hẹn tuyệt đối trong UI; có disclaimer |
| Đăng nhập | ✅ Đang dùng `getUserInfo` của Zalo — đúng chuẩn, không có form user/password | Giữ nguyên |

> **Cảnh báo về tìm kiếm:** Mini App có form đăng nhập username/password truyền thống sẽ bị Zalo
> **chủ động tắt tìm kiếm** (chỉ vào được qua deeplink/QR/shortcut). Zino không dính, nhưng đừng
> thêm luồng đó về sau.

---

## 6. Publish

Bản ở trạng thái **Đã duyệt** → bấm **Publish** trên Mini App Center. Từ lúc này người dùng thật
mở được `https://zalo.me/s/<MINI_APP_ID>/`.

⚠️ **Chưa xác minh:** SLA xét duyệt của Zalo. Không lên kế hoạch demo dựa trên giả định "duyệt
trong ngày" — đưa mốc gửi duyệt lên sớm nhất có thể.

### Sau khi publish

| Việc | Ghi chú |
|---|---|
| Test lại bằng tài khoản **không phải** Developer/Admin | Đây là lần đầu phát hiện được lỗi thiếu quyền (§2) |
| Debug production | `?zDebug=true` trên deeplink, hoặc remote debug Android qua USB |
| Không thấy app trên Mini App Store / thanh tìm kiếm | Có thể do vận hành tắt tìm kiếm; submit bản mới và **ghi rõ yêu cầu mở lại tìm kiếm** trong mô tả |
| Canh `ZMP_TOKEN` | `zmp-token-health.yml` chạy 08:00 thứ Hai; token chết là không hotfix được |

---

## 7. Bảng lỗi go-live

| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| `Ứng dụng đang trong giai đoạn phát triển, vui lòng thử lại sau!` | Mở bản Live nhưng app chưa từng publish | Hoàn tất §5–§6 |
| `Trang này không tìm thấy hoặc không hợp lệ` | Mở bản Testing/Development bằng tài khoản ngoài Developer/Admin | Thêm tài khoản vào Developer/Admin, hoặc dùng bản Live |
| App chạy với dev, lỗi với người dùng thường | Thiếu quyền đã duyệt | Xin quyền ở §2 rồi submit bản mới |
| `Network Error` trong Zalo nhưng Postman gọi được | CORS | Trả đúng một origin `https://h5.zdn.vn`, kể cả method `OPTIONS` |
| `The file size is too large` | Vượt 10 MB / file vượt 3 MB | Đưa asset lên CDN, code splitting |
| `You have reached your 30-day deployment limit` | Hết quota (300 dev / 60 testing) | Chờ sang chu kỳ; tiết kiệm lượt TESTING |
| `Token Invalid` / `permission_denied` | Token hết hạn hoặc thuộc Zalo App khác | Lấy token mới, chọn **đúng ứng dụng** ở API Explorer |
| `Permission denied. Please login again` trong CI | Nhầm `MINI_APP_ID` với `ZALO_APP_ID` | Hai ID khác nhau — đối chiếu lại secret |
| Màn hình trắng trên máy Android cũ | Bundle dùng cú pháp mới hơn ES2015 | Hạ `build.target` (§3.4) |
| Ảnh không hiện | Dùng `src="/anh.jpg"` từ `public/` | `import` ảnh để Vite đóng gói |

---

## 8. Còn phải tự kiểm chứng

- [ ] SLA duyệt **hồ sơ xác thực** Mini App
- [ ] SLA **xét duyệt phiên bản**
- [ ] TTL thật của `ZMP_TOKEN` → chạy `node scripts/check-zmp-token.mjs`
- [ ] Bundle hiện tại có chạy trên Android đời cũ không (quyết định có hạ target ES2015)
- [ ] Trang đích của `openWebview` có bị xem là link bên thứ 3 không

---

## 9. Nguồn

- [Triển khai Mini App](https://docs.zaloplatforms.com/docs/MA/intro/getting-started)
- [Phát hành Zalo Mini App](https://docs.zaloplatforms.com/docs/MA/intro/public-mini-program)
- [Xin cấp quyền trong Zalo Mini App](https://docs.zaloplatforms.com/docs/MA/intro/request-permission)
- [Các lỗi kỹ thuật thường gặp](https://docs.zaloplatforms.com/docs/MA/intro/getting-started/frequently-solved-issues)
- [CLI — Xuất bản](https://docs.zaloplatforms.com/docs/MA/devtools/cli/deploy)
- [Design Guidelines](https://docs.zaloplatforms.com/docs/MA/intro/zalo-mini-program-design-guidelines)
- [Thỏa thuận Chương trình Zalo Mini App](https://mini.zalo.me/documents/zalo-mini-app-developer-program-agreement/)

**Trong repo:** [`05-ci-cd-zalo-mini-app.md`](./05-ci-cd-zalo-mini-app.md) ·
[`08-build-mini-app.md`](./08-build-mini-app.md) · [`03-tai-nguyen-zalo.md`](./03-tai-nguyen-zalo.md)

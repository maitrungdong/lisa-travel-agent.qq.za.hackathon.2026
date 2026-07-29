# Bộ nhận diện Zino

Ý tưởng: chữ **Z** với nét chéo là **kim la bàn** — vừa đọc ra tên Zino, vừa nói ngay "định hướng / du lịch". Vòng tròn mặt số la bàn mờ ở nền, vạch Bắc màu amber.

## Màu

| Vai trò | Mã | Ghi chú |
|---|---|---|
| Primary (teal) | `#0f766e` | trùng `--primary` trong `app.css` & `headerColor` |
| Teal sáng | `#16a394` | đỉnh gradient nền icon |
| Teal đậm | `#0a4f4c` | đáy gradient nền icon |
| Accent (amber) | `#f59e0b` / `#fbbf24` | kim la bàn, vạch Bắc, sub-title |
| Nền tối | `#04252b` | silhouette người trong banner |

## File

| File | Kích thước | Dùng cho |
|---|---|---|
| `zino-logo-512.png` | 512×512 | icon Mini App (Zalo Developer Console) |
| `zino-logo-192.png` | 192×192 | icon nhỏ / PWA / favicon |
| `zino-mark-512-transparent.png` | 512×512 | mark trên nền tuỳ ý (chỉ dùng trên nền tối) |
| `zino-banner-1200x630.png` | 1200×630 | ảnh bìa / og:image / share link |
| `zino-banner-2400x1260@2x.png` | 2400×1260 | bản @2x cho màn retina |
| `zino-banner-1200x630-no-text.png` | 1200×630 | nền không chữ, để đặt text khác lên |

Nguồn vector: `zino-logo.svg`, `zino-mark.svg`, `zino-banner.svg`.
Script sinh lại: `python3 logo.py <thư-mục>` và `python3 banner.py <thư-mục>` (cần `cairosvg` để xuất PNG).

## Lưu ý khi dùng

- Icon đã có nền squircle sẵn — **không** bọc thêm khung hay bo góc lần nữa.
- Chừa lề trống quanh mark ít nhất bằng 1/2 chiều cao chữ Z.
- Không đặt mark trắng lên nền sáng; dùng `zino-logo-*.png` (có nền teal) thay thế.
- Không đổi màu kim la bàn sang màu khác amber — đó là điểm nhấn nhận diện duy nhất.

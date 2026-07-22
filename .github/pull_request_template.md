## Thay đổi gì

<!-- 1-3 câu. Vì sao cần thay đổi này, không phải liệt kê file đã sửa. -->

## Loại thay đổi

- [ ] Feature
- [ ] Bugfix
- [ ] Refactor / chore
- [ ] Breaking change

## Kiểm thử

<!-- Đã test thế nào? Với mini app: đã quét QR chạy thật trên Zalo chưa? -->

- [ ] Đã chạy `pnpm lint && pnpm typecheck && pnpm test` ở local
- [ ] Đã test trên thiết bị thật qua Zalo (nếu đụng UI mini app)

## Checklist Zalo Mini App

<!-- Bỏ qua nếu PR không đụng tới apps/miniapp -->

- [ ] Không thêm secret nào vào biến `VITE_*` (mọi biến `VITE_*` nằm trong bundle client, ai cũng đọc được)
- [ ] Bundle không phình bất thường (xem bảng bundle size trong job summary của CI)
- [ ] API native mới đã kiểm tra quyền/consent của user (`getPhoneNumber`, `getLocation`, notification…)
- [ ] Version `zmp-sdk` / `zmp-ui` không bị bump ngoài ý muốn

## Ảnh / video

<!-- Screenshot hoặc screen record trên Zalo nếu có thay đổi UI -->

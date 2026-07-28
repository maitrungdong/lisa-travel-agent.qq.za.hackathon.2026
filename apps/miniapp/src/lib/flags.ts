/**
 * Cờ bật/tắt tính năng, quyết định lúc BUILD.
 *
 * Vì sao dùng cờ thay vì xoá code: luồng đăng nhập + liên kết đã viết xong và
 * có test, chỉ đang bị chặn bởi một thủ tục ngoài tầm kiểm soát — Zalo App
 * chưa được kích hoạt nên `getAccessToken` trả `-1401`. Xoá đi rồi viết lại là
 * lãng phí; để nguyên mà hiện ra màn hình thì demo có một nút dẫn vào ngõ cụt.
 *
 * Bật lại: đặt VITE_AUTH_ENABLED=true rồi build lại. Không phải sửa dòng code nào.
 * ⚠ Biến VITE_* được NHÚNG lúc build — sửa .env mà không build lại thì không có
 * tác dụng gì.
 */
export const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === "true";

/** Màn /debug đo namespace id. Chỉ bật khi cần đo, không để lộ trong demo. */
export const DEBUG_UI = import.meta.env.VITE_DEBUG_UI === "true";

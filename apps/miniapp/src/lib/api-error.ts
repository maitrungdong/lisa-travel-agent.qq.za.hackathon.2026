/**
 * Dịch phản hồi lỗi của API thành câu người đọc được.
 *
 * Bản cũ ném `new Error("API 400: /decisions/2/decide")` — vứt sạch phần server
 * đã giải thích rất rõ ("Bạn không thuộc chuyến đi này", "Chỉ người tổ chức mới
 * chốt được") và chỉ giữ lại con số. Người dùng không làm gì được với con số đó,
 * còn người sửa lỗi thì phải mở log VPS mới biết nhánh nào đã chặn.
 *
 * Ở file riêng vì `api.ts` đọc `import.meta.env` ngay lúc nạp module, kéo theo
 * cả môi trường Vite mỗi khi muốn kiểm một nhánh xử lý lỗi.
 */

/** Đúng hình dạng NestJS trả về. `message` là chuỗi khi tự ném Exception, là mảng issue khi zod chặn. */
export interface ApiErrorBody {
  statusCode?: number;
  message?: unknown;
  error?: string;
}

export function messageFromBody(status: number, body: unknown, path: string): string {
  const fallback = `Máy chủ từ chối (${status})`;
  if (!body || typeof body !== "object") return `${fallback} — ${path}`;

  const m = (body as ApiErrorBody).message;
  if (typeof m === "string" && m.trim()) return m.trim();

  if (Array.isArray(m) && m.length > 0) {
    const first = m[0] as { message?: unknown; path?: unknown } | undefined;
    if (first && typeof first.message === "string" && first.message.trim()) {
      const at =
        Array.isArray(first.path) && first.path.length > 0 ? ` (${first.path.join(".")})` : "";
      return `Dữ liệu gửi lên không hợp lệ: ${first.message.trim()}${at}`;
    }
    // Zod đôi khi trả mảng chuỗi thay vì mảng issue.
    if (typeof m[0] === "string" && m[0].trim()) return `Dữ liệu gửi lên không hợp lệ: ${m[0].trim()}`;
  }

  return `${fallback} — ${path}`;
}

/**
 * Đọc body một lần rồi dịch. Body không phải JSON (nginx 502, mạng đứt giữa
 * chừng) thì giữ lại `path` để còn lần ra chỗ hỏng.
 */
export async function errorMessage(res: Response, path: string): Promise<string> {
  try {
    return messageFromBody(res.status, await res.json(), path);
  } catch {
    return `Máy chủ từ chối (${res.status}) — ${path}`;
  }
}

/**
 * Áp `state_patch` lên thin state — v7 §3.4.
 *
 * Agent trả về PATCH một phần, không phải state đầy đủ. Quy tắc gộp:
 *
 *   object + object     → gộp đệ quy
 *   array trong patch   → THAY THẾ mảng cũ (không nối)
 *   scalar trong patch  → thay thế
 *   null tường minh     → XOÁ field
 *   field vắng mặt      → giữ nguyên giá trị cũ
 *
 * Chỗ dễ sai nhất là hai dòng giữa: mảng thay thế chứ không nối (nếu không,
 * `options` sẽ phình ra sau mỗi lượt research), và `null` là lệnh xoá chứ
 * không phải giá trị (nếu không, không cách nào bỏ `selected_option`).
 */

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

function isPlainObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Trả về state MỚI, không sửa tại chỗ.
 *
 * Không sửa tại chỗ để state cũ còn dùng được cho log và so sánh khi debug —
 * chuỗi 3 agent mà mất bản trước thì không truy được ai đổi field nào.
 */
export function applyStatePatch(current: JsonObject | null | undefined, patch: unknown): JsonObject {
  const base: JsonObject = isPlainObject(current) ? current : {};
  if (!isPlainObject(patch)) return { ...base };

  const out: JsonObject = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key]; // null = xoá, không phải gán null
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value as Json; // mảng thay thế nguyên khối
      continue;
    }
    if (isPlainObject(value)) {
      const prev = out[key];
      out[key] = applyStatePatch(isPlainObject(prev) ? prev : {}, value);
      continue;
    }
    out[key] = value as Json;
  }

  return out;
}

/** Đọc field lồng nhau an toàn: get(state, "active_flow.stage") */
export function get(state: unknown, path: string): unknown {
  let cur: unknown = state;
  for (const part of path.split(".")) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * Cổng kiểm chứng số liệu cho câu trả lời của model.
 *
 * Vấn đề cần giải: để model cầm lái thì nó nói hay hơn hẳn, nhưng chỉ cần một
 * lần nó viết "cả nhóm đã tiêu 8,5 triệu" trong khi sổ ghi 8.300.000 là mất
 * sạch niềm tin — và mất theo cách không lấy lại được, vì người dùng không có
 * cách nào biết lần nào nó đúng.
 *
 * Cách chặn: model được tự do về CÁCH NÓI, nhưng mọi CON SỐ trong câu phải truy
 * ngược được về dữ liệu mà tool đã trả về. Không truy được → vứt câu của model,
 * dùng câu tất định. Đây là khác biệt giữa "tin model" và "kiểm được model".
 *
 * Hàm thuần, không I/O — vì đây là chốt chặn cuối cùng trước khi chữ đến mắt
 * người dùng, nó phải test được mọi trường hợp mà không cần dựng cả hệ thống.
 */

/**
 * Mọi dãy chữ số trong chuỗi, đã bỏ số 0 ở đầu.
 *
 * Dùng dãy chữ số thay vì "parse số" là có chủ ý: "8.300.000đ", "8300000",
 * "05:15", "12/08/2026" đều quy về cùng một cách so sánh, không phải viết
 * riêng bộ phân tích cho từng định dạng tiền/ngày/giờ.
 */
export function digitRuns(s: string): string[] {
  return (normalizeThousands(s).match(/\d+/g) ?? []).map((d) => d.replace(/^0+(?=\d)/, ""));
}

/**
 * Gộp dấu ngăn nghìn TRƯỚC khi tách số: "8.300.000" → "8300000".
 *
 * Bỏ bước này thì con số vỡ thành 8 / 300 / 000 — và một số bịa như 8.500.000
 * cũng vỡ thành mấy mảnh nhỏ tương tự, mảnh nào cũng có vẻ vô hại. Cả cổng
 * kiểm chứng khi đó chỉ còn là hình thức. Lỗi này do unit test bắt được, không
 * phải do đọc lại code.
 *
 * Lặp vì mỗi lượt chỉ gộp được một dấu: "8.300.000" cần hai lượt.
 */
export function normalizeThousands(s: string): string {
  let out = s;
  let prev: string;
  do {
    prev = out;
    out = out.replace(/(\d)[.,](\d{3})(?!\d)/g, "$1$2");
  } while (out !== prev);
  return out;
}

/**
 * Tập số liệu ĐƯỢC PHÉP xuất hiện — lấy từ chính kết quả tool.
 *
 * Nuốt cả JSON rồi bóc chữ số nên tập này rộng: id, số đếm, timestamp đều lọt
 * vào. Rộng là cố ý. Thứ cần chặn là con số BỊA — số tiền, số ngày, số người
 * mà model tự nghĩ ra — và những số đó gần như không bao giờ trùng ngẫu nhiên
 * với dữ liệu thật. Siết chặt hơn nữa thì sẽ chặn nhầm câu đúng, mà chặn nhầm
 * nhiều lần thì cả cơ chế bị vô hiệu hoá vì "cứ bật là hỏng".
 */
export function collectFactTokens(facts: unknown): Set<string> {
  let json: string;
  try {
    json = JSON.stringify(facts) ?? "";
  } catch {
    json = String(facts);
  }
  return new Set(digitRuns(json));
}

export interface GroundingResult {
  ok: boolean;
  /** Các con số trong câu trả lời không truy được nguồn */
  ungrounded: string[];
}

/**
 * Số nhỏ dùng để đếm trong câu ("2 việc", "3 chỗ") thường do model tự đếm từ
 * danh sách đã cho. Chặn chúng thì gần như câu nào cũng trượt, mà rủi ro sai
 * lại thấp — người đọc kiểm được ngay bằng cách nhìn số thẻ bên dưới.
 * Từ 100 trở lên (tiền, năm, id) thì bắt buộc phải khớp dữ liệu.
 */
const SMALL_NUMBER_LIMIT = 100;

export function verifyGrounded(text: string, facts: unknown): GroundingResult {
  const allowed = collectFactTokens(facts);
  const ungrounded = digitRuns(text).filter((token) => {
    if (allowed.has(token)) return false;
    const n = Number(token);
    return !(Number.isFinite(n) && n < SMALL_NUMBER_LIMIT);
  });
  return { ok: ungrounded.length === 0, ungrounded: [...new Set(ungrounded)] };
}

/**
 * Model hay viết tiền bằng chữ ("8 triệu rưỡi", "hai trăm nghìn") — đúng nghĩa
 * nhưng không kiểm được, nên cấm hẳn và bắt dùng đúng con số tool trả về.
 * Rẻ hơn nhiều so với việc viết bộ hiểu số bằng chữ tiếng Việt.
 */
const WORD_AMOUNT = /\b(triệu|tỷ|nghìn|ngàn|trăm|rưỡi|chục)\b/i;

export function hasWordAmount(text: string): boolean {
  return WORD_AMOUNT.test(text);
}

export interface GateResult {
  /** Câu cuối cùng được phép gửi cho người dùng */
  text: string;
  passed: boolean;
  reason?: "ungrounded_number" | "word_amount";
  ungrounded?: string[];
}

/**
 * Cổng cuối: cho qua câu của model, hoặc thay bằng câu tất định.
 *
 * KHÔNG cố sửa câu của model (xoá số sai, viết lại…). Câu bị sửa nửa vời còn
 * nguy hiểm hơn câu sai rõ ràng, vì nó vẫn đọc trôi chảy nhưng ý đã lệch.
 */
export function gateReply(
  modelText: string,
  facts: unknown,
  deterministicFallback: string
): GateResult {
  const text = modelText.trim();
  if (!text) return { text: deterministicFallback, passed: false, reason: "ungrounded_number" };

  if (hasWordAmount(text)) {
    return { text: deterministicFallback, passed: false, reason: "word_amount" };
  }

  const g = verifyGrounded(text, facts);
  if (!g.ok) {
    return {
      text: deterministicFallback,
      passed: false,
      reason: "ungrounded_number",
      ungrounded: g.ungrounded
    };
  }

  return { text, passed: true };
}

import type { DecisionView } from "./decisions.service";

/**
 * Soạn tin nhắn Zino gửi vào nhóm cho một quyết định.
 *
 * Vì sao là hàm thuần, tách khỏi service: đây là thứ cả nhóm đọc, và là chỗ dễ
 * sai số liệu nhất ("2/3 phiếu" mà thật ra 1/3). Tách ra thì test được từng
 * câu chữ mà không cần DB.
 *
 * GIỚI HẠN NỀN TẢNG — đọc kỹ trước khi định thêm nút:
 * Zalo Bot API không gửi được button, card hay carousel. Toàn bộ endpoint:
 * sendMessage · sendPhoto · sendSticker · sendChatAction · sendVoice.
 * sendMessage chỉ nhận chat_id, text, parse_mode, text_styles.
 * → "Card" ở đây = text định dạng markdown + MỘT link mở Mini App.
 */

const MAX_LEN = 1900; // chừa chỗ cho link, giới hạn cứng của Zalo là 2000

export function formatVnd(amount: number): string {
  const digits = Math.abs(Math.round(amount)).toString();
  return `${amount < 0 ? "-" : ""}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}đ`;
}

/** Cắt an toàn, không để đứt giữa chừng một cách khó hiểu. */
function clamp(s: string): string {
  return s.length <= MAX_LEN ? s : `${s.slice(0, MAX_LEN - 1)}…`;
}

/**
 * Zino đề xuất phương án — kèm LÝ DO và trade-off, không tự quyết.
 * Đây là dòng biến app từ danh sách thành bằng chứng agent có suy nghĩ.
 */
export function proposalMessage(d: DecisionView, appUrl: string): string {
  const lines: string[] = [];
  lines.push(`**${d.title}** — ${d.options.length} phương án:`);
  lines.push("");

  for (const [i, o] of d.options.entries()) {
    const letter = String.fromCharCode(65 + i); // A, B, C…
    const price = o.price != null ? ` — ${formatVnd(o.price)}` : "";
    const detail = o.detail ? ` · ${o.detail}` : "";
    lines.push(`**${letter} · ${o.label}**${price}${detail}`);
  }

  if (d.recommendationReason) {
    lines.push("");
    const rec = d.options.find((o) => o.id === d.recommendedOptionId);
    lines.push(rec ? `Mình nghiêng **${rec.label}**: ${d.recommendationReason}` : d.recommendationReason);
  }

  lines.push("");
  lines.push("Cả nhóm bình chọn trong sổ nhé:");
  lines.push(appUrl);

  return clamp(lines.join("\n"));
}

/** Sau khi chốt — báo lại nhóm ngay, nói rõ ai chốt và bao nhiêu phiếu. */
export function decidedMessage(d: DecisionView, appUrl: string): string {
  const chosen = d.options.find((o) => o.id === d.decidedOptionId);
  const lines: string[] = [];

  lines.push(
    `Nhóm đã chốt **${chosen?.label ?? "phương án"}**` +
      ` (${d.decidedByName ?? "người tổ chức"} chốt, ${chosen?.votes ?? 0}/${d.memberCount} phiếu).`
  );

  // Ngược đa số thì phải nói ra. Giấu đi là kiểu mất niềm tin không lấy lại được.
  if (d.againstMajority) {
    lines.push("");
    lines.push("{orange}Lưu ý: phương án này không phải lựa chọn của số đông.{/orange}");
  }

  if (chosen?.price != null) {
    lines.push("");
    lines.push(`Chi phí dự kiến ${formatVnd(chosen.price)} — mình đi giữ chỗ nhé.`);
  }

  lines.push("");
  lines.push(appUrl);

  return clamp(lines.join("\n"));
}

/**
 * Nhắc khi còn người chưa bình chọn. Chỉ gửi khi THẬT SỰ còn người chưa bầu —
 * nhắc thừa vài lần là cả nhóm bắt đầu bỏ qua tin của Zino.
 */
export function reminderMessage(d: DecisionView, appUrl: string): string | null {
  if (d.status !== "open" && d.status !== "tie") return null;
  if (d.pendingNames.length === 0) return null;

  const who = d.pendingNames.join(", ");
  const head =
    d.status === "tie"
      ? `**${d.title}** đang hoà phiếu — chờ người tổ chức chốt.`
      : `**${d.title}** còn ${who} chưa bình chọn.`;

  return clamp([head, "", appUrl].join("\n"));
}

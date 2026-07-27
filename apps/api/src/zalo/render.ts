/**
 * Lớp render cho Zalo Bot API.
 *
 * Zalo CHỈ nhận plain text: không markdown, không HTML, không button,
 * tối đa 2000 ký tự / tin. LLM thì luôn trả markdown → phải "phiên dịch"
 * sang ký tự Unicode mà Zalo hiển thị được, rồi cắt thành nhiều tin.
 *
 * Thuần hàm: không I/O, không state — dễ test và dễ tái dùng.
 */

/** Ký tự kẻ ngang dùng cho H1 và đường phân cách */
const RULE_CHAR = "━";
/** Độ dài tối thiểu / tối đa của đường gạch dưới H1 */
const RULE_MIN = 4;
const RULE_MAX = 20;
/** Độ dài đường phân cách thay cho `---` */
const HR_LENGTH = 10;
/** Giới hạn mặc định của Zalo Bot API */
const ZALO_MAX_LEN = 2000;

/* ============================================================================
 * renderPlainText — markdown → plain text đọc được trên Zalo
 * ========================================================================== */

/** Xử lý các cú pháp inline (link, đậm, nghiêng, code…) trong 1 dòng. */
function renderInline(text: string): string {
  let s = text;

  // [text](url) và ![alt](url) → "text: url" (Zalo tự nhận diện URL trần)
  s = s.replace(
    /!?\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/g,
    (_match: string, label: string, url: string) => {
      const caption = label.trim();
      if (url.length === 0) return caption;
      return caption.length === 0 || caption === url ? url : `${caption}: ${url}`;
    }
  );

  // **đậm** / __đậm__ / ~~gạch~~ → bỏ dấu, giữ chữ
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/~~([^~]+)~~/g, "$1");

  // *nghiêng* / _nghiêng_ — chỉ khi dấu sao/gạch dưới đứng ở ranh giới từ,
  // tránh phá snake_case và URL có dấu gạch dưới.
  s = s.replace(/(?<![\p{L}\p{N}_*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\p{L}\p{N}_*])/gu, "$1");
  s = s.replace(/(?<![\p{L}\p{N}_])_(?!\s)([^_\n]+?)(?<!\s)_(?![\p{L}\p{N}_])/gu, "$1");

  // `inline code` → bỏ backtick, giữ nội dung
  s = s.replace(/`([^`]+)`/g, "$1");

  return s;
}

/** Tách 1 dòng bảng markdown thành các ô đã trim. */
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Dòng kiểu `|---|:--:|` — dấu hiệu nhận biết bảng markdown. */
function isTableSeparator(line: string): boolean {
  if (!line.includes("|") || !line.includes("-")) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

/**
 * Bảng markdown không đọc được trên mobile Zalo → đổ dọc thành
 * các dòng `Cột: giá trị`, mỗi hàng cách nhau 1 dòng trống.
 */
function renderTable(headers: string[], rows: string[][]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const block: string[] = [];
    for (let i = 0; i < row.length; i++) {
      const value = renderInline(row[i]).trim();
      if (value.length === 0) continue;
      const key = renderInline(headers[i] ?? "").trim();
      block.push(key.length > 0 ? `${key}: ${value}` : value);
    }
    if (block.length === 0) continue;
    out.push(...block, "");
  }
  if (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out;
}

/** Độ rộng thụt lề quy ra số space (tab = 2 space). */
function indentDepth(prefix: string): number {
  return Math.floor(prefix.replace(/\t/g, "  ").length / 2);
}

/** Markdown → plain text đọc được trên Zalo */
export function renderPlainText(markdown: string): string {
  if (!markdown) return "";

  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    /* --- khối code ```…``` : giữ nguyên nội dung, chỉ bỏ backtick --------- */
    const oneLineFence = /^\s*`{3,}(.*)`{3,}\s*$/.exec(line);
    if (!inFence && oneLineFence) {
      out.push(oneLineFence[1].trim());
      continue;
    }
    if (/^\s*(?:`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(line.replace(/[ \t]+$/, ""));
      continue;
    }

    /* --- bảng markdown ---------------------------------------------------- */
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|") && lines[j].trim().length > 0) {
        rows.push(splitTableRow(lines[j]));
        j++;
      }
      out.push(...renderTable(headers, rows));
      i = j - 1;
      continue;
    }

    /* --- đường kẻ ngang --------------------------------------------------- */
    if (/^\s{0,3}([-*_])\s*(?:\1\s*){2,}$/.test(line)) {
      out.push(RULE_CHAR.repeat(HR_LENGTH));
      continue;
    }

    /* --- tiêu đề ---------------------------------------------------------- */
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = renderInline(heading[2].replace(/\s*#+\s*$/, "")).trim();
      if (title.length === 0) continue;
      if (level === 1) {
        const upper = title.toUpperCase();
        const width = Math.min(Math.max(Array.from(upper).length, RULE_MIN), RULE_MAX);
        out.push(upper, RULE_CHAR.repeat(width));
      } else if (level === 2) {
        out.push(`▍ ${title}`);
      } else {
        out.push(`• ${title}`);
      }
      continue;
    }

    /* --- trích dẫn -------------------------------------------------------- */
    const quote = /^\s*(?:>\s?)+(.*)$/.exec(line);
    if (quote) {
      out.push(`❝ ${renderInline(quote[1]).trim()}`.replace(/[ \t]+$/, ""));
      continue;
    }

    /* --- danh sách không thứ tự ------------------------------------------- */
    const bullet = /^([ \t]*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      const depth = indentDepth(bullet[1]);
      const content = renderInline(bullet[2]).trim();
      out.push(depth === 0 ? `• ${content}` : `${"  ".repeat(depth)}◦ ${content}`);
      continue;
    }

    /* --- danh sách có thứ tự ---------------------------------------------- */
    const ordered = /^([ \t]*)(\d{1,9})[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      const depth = indentDepth(ordered[1]);
      const content = renderInline(ordered[3]).trim();
      out.push(`${"  ".repeat(depth)}${ordered[2]}. ${content}`);
      continue;
    }

    out.push(renderInline(line).replace(/[ \t]+$/, ""));
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n") // gộp nhiều dòng trống thành 1 dòng trống
    .trim();
}

/* ============================================================================
 * chunkMessage — cắt text thành nhiều tin nhắn
 * ========================================================================== */

type Splitter = (unit: string, budget: number) => string[];

/**
 * Gom các đơn vị nhỏ thành chunk ≤ budget theo kiểu tham lam.
 * Đơn vị nào tự thân đã dài hơn budget thì đẩy xuống tầng cắt nhỏ hơn.
 */
function packUnits(units: string[], joiner: string, budget: number, breakDown: Splitter): string[] {
  const out: string[] = [];
  let current = "";

  for (const unit of units) {
    if (unit.length === 0) continue;
    const candidate = current.length === 0 ? unit : current + joiner + unit;
    if (candidate.length <= budget) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      out.push(current);
      current = "";
    }
    if (unit.length <= budget) {
      current = unit;
      continue;
    }
    // Đơn vị quá dài → cắt nhỏ; mảnh cuối để dành ghép tiếp với đơn vị sau
    const pieces = breakDown(unit, budget);
    for (let i = 0; i < pieces.length; i++) {
      if (i === pieces.length - 1) current = pieces[i];
      else out.push(pieces[i]);
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** Tách theo câu: kết thúc bằng . ! ? … (theo sau là khoảng trắng hoặc hết chuỗi) */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[.!?…]+(?=\s|$)/g;
  let start = 0;
  let match: RegExpExecArray | null = re.exec(text);
  while (match !== null) {
    const end = match.index + match[0].length;
    const piece = text.slice(start, end).trim();
    if (piece.length > 0) out.push(piece);
    start = end;
    match = re.exec(text);
  }
  const tail = text.slice(start).trim();
  if (tail.length > 0) out.push(tail);
  return out.length > 0 ? out : [text];
}

/** Tầng cuối: cắt cứng theo ký tự. Dùng Array.from để không xẻ đôi emoji. */
function byChars(text: string, budget: number): string[] {
  const limit = Math.max(1, budget);
  const out: string[] = [];
  let current = "";
  for (const ch of Array.from(text)) {
    if (current.length > 0 && current.length + ch.length > limit) {
      out.push(current);
      current = "";
    }
    current += ch;
  }
  if (current.length > 0) out.push(current);
  return out;
}

function byWord(text: string, budget: number): string[] {
  return packUnits(text.split(/\s+/), " ", budget, byChars);
}

function bySentence(text: string, budget: number): string[] {
  return packUnits(splitSentences(text), " ", budget, byWord);
}

function byLine(text: string, budget: number): string[] {
  return packUnits(
    text.split("\n").map((l) => l.trim()),
    "\n",
    budget,
    bySentence
  );
}

function byParagraph(text: string, budget: number): string[] {
  return packUnits(
    text.split(/\n{2,}/).map((p) => p.trim()),
    "\n\n",
    budget,
    byLine
  );
}

/**
 * Cắt text thành nhiều tin ≤ maxLen, ưu tiên ranh giới đoạn > dòng > câu > từ.
 * Nếu có nhiều hơn 1 tin, mỗi tin được gắn tiền tố `[i/N]\n` và TỔNG độ dài
 * (đã tính tiền tố) vẫn ≤ maxLen.
 */
export function chunkMessage(text: string, maxLen: number = ZALO_MAX_LEN): string[] {
  if (text.trim().length === 0) return [];

  const limit = Math.max(8, Math.floor(maxLen));
  if (text.length <= limit) return [text];

  // Độ dài tiền tố phụ thuộc N, mà N lại phụ thuộc độ dài tiền tố → lặp cho hội tụ.
  // N chỉ tăng dần (tiền tố dài hơn → ngân sách nhỏ hơn) nên vòng lặp luôn dừng.
  let count = byParagraph(text, limit).length;
  let parts: string[] = [];
  for (let guard = 0; guard < 12; guard++) {
    const prefixLen = `[${count}/${count}]\n`.length;
    parts = byParagraph(text, Math.max(1, limit - prefixLen));
    if (parts.length <= count) break; // ngân sách đã đủ rộng rãi → an toàn
    count = parts.length;
  }

  if (parts.length <= 1) return parts.length === 1 ? parts : [text];
  return parts.map((part, i) => `[${i + 1}/${parts.length}]\n${part}`);
}

/**
 * Tiện ích dùng ở mọi nơi gửi tin: markdown → mảng tin sẵn sàng cho sendMessage.
 * Model luôn sinh markdown; Zalo chỉ nhận plain text ≤2000 → luôn đi qua hàm này.
 */
export function toZaloMessages(markdown: string, maxLen: number = ZALO_MAX_LEN): string[] {
  return chunkMessage(renderPlainText(markdown), maxLen);
}

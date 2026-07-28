/**
 * Contract của pipeline 4 agent.
 *
 * Hai tầng, theo đúng hai tài liệu của team:
 *  • Tầng transport (backend.md) — MỌI agent trả `{status, message_to_user}`.
 *    Backend chỉ đọc hai field này để định tuyến và gửi tin. Không ghép chuỗi.
 *  • Tầng domain (4-ai-agents.md) — mỗi agent trả thêm brief, offers, variants...
 *    Backend KHÔNG đọc, chỉ lưu nguyên khối rồi truyền sang stage sau.
 *
 * Vì thế validator dưới đây cố tình LỎNG với phần domain và CHẶT với phần
 * transport: sai `status` là luồng đi sai; thừa/thiếu field domain thì stage
 * sau tự xử lý được.
 */

export type StageId = "A" | "B" | "C" | "D";

/**
 * Đọc số từ env — CHỊU ĐƯỢC CHUỖI RỖNG.
 *
 * Bẫy đã dính lúc 2:14 sáng 29/07: docker-compose khai
 * `ZINO_INTAKE_TIMEOUT_MS: ${ZINO_INTAKE_TIMEOUT_MS:-}` nên container nhận
 * biến ĐƯỢC ĐẶT nhưng RỖNG. `Number(process.env.X ?? 45000)` không cứu được
 * vì `??` chỉ bắt null/undefined — kết quả `Number("")` = 0 → timeout 0ms →
 * mọi stage abort tức thì.
 *
 * Dùng hàm này cho MỌI số đọc từ env.
 */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Đọc chuỗi từ env — CHỊU ĐƯỢC CHUỖI RỖNG. Cùng một cái bẫy với `envInt`.
 *
 * `process.env.ZINO_MODEL ?? "claude-sonnet-5"` trông vô hại, nhưng `??` chỉ
 * bắt null/undefined. Khai `ZINO_MODEL: ${ZINO_MODEL:-}` trong compose là biến
 * ĐƯỢC ĐẶT bằng chuỗi rỗng, và kết quả là `model: ""` — API từ chối mọi request,
 * bot câm hoàn toàn.
 *
 * Quy tắc: biến nào có mặt trong `docker-compose.yml` dạng `${X:-}` thì PHẢI
 * đọc qua `envStr` hoặc `envInt`, không bao giờ qua `??`.
 */
export function envStr(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === null || raw.trim() === "" ? fallback : raw.trim();
}

export const STAGE_NAME: Record<StageId, string> = {
  A: "Trip Alignment",
  B: "Offer Scout",
  C: "Itinerary Composer",
  D: "Action Packager"
};

/** Status hợp lệ theo từng stage. Ngoài danh sách này = output hỏng. */
export const STAGE_STATUSES: Record<StageId, readonly string[]> = {
  A: ["needs_user_input", "ready_for_scout", "blocked"],
  B: ["needs_source_data", "needs_user_input", "ready_for_composer", "blocked"],
  C: ["options_ready", "blocked"],
  D: ["needs_owner_confirm", "package_ready", "blocked"]
} as const;

/**
 * Output của một stage.
 *
 * `message_to_user` là string đã parse — tức `\n` trong JSON gốc đã thành ký tự
 * xuống dòng thật. Gửi thẳng chuỗi này cho Zalo, không đụng vào nữa.
 */
export interface StageOutput {
  status: string;
  message_to_user: string | null;
  /** Toàn bộ field domain, giữ nguyên để truyền sang stage sau */
  [key: string]: unknown;
}

export class StageOutputError extends Error {
  constructor(
    readonly stage: StageId,
    readonly reason: string,
    readonly raw: string
  ) {
    super(`Stage ${stage} trả output không hợp lệ: ${reason}`);
  }
}

/**
 * Bóc JSON từ text agent trả về.
 *
 * Cần thiết vì Managed Agents KHÔNG đảm bảo JSON — khác với Messages API có
 * `output_config.format` ép grammar. Agent hay bọc kết quả trong ```json hoặc
 * kèm một câu dẫn trước/sau.
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim();

  // Trường hợp sạch nhất
  try {
    return JSON.parse(text);
  } catch {
    /* thử tiếp */
  }

  // ```json ... ``` hoặc ``` ... ```
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* thử tiếp */
    }
  }

  // Object đầu tiên tới ngoặc đóng cuối cùng — cứu được khi agent nói thêm
  // vài câu quanh JSON.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      /* hết cách */
    }
  }

  return null;
}

/**
 * Validate phần transport. Ném StageOutputError để caller quyết định có gửi
 * lượt sửa lỗi vào cùng session hay bỏ cuộc.
 */
export function parseStageOutput(stage: StageId, raw: string): StageOutput {
  const parsed = extractJson(raw);

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new StageOutputError(stage, "không phải JSON object", raw);
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.status !== "string") {
    throw new StageOutputError(stage, "thiếu field `status`", raw);
  }
  if (!STAGE_STATUSES[stage].includes(obj.status)) {
    throw new StageOutputError(
      stage,
      `status "${obj.status}" không thuộc [${STAGE_STATUSES[stage].join(", ")}]`,
      raw
    );
  }

  // null hợp lệ (spec: "hoặc null"), undefined thì coi như null
  const msg = obj.message_to_user;
  if (msg !== null && msg !== undefined && typeof msg !== "string") {
    throw new StageOutputError(stage, "`message_to_user` phải là string hoặc null", raw);
  }

  return { ...obj, status: obj.status, message_to_user: (msg as string) ?? null };
}

/**
 * Lời nhắc gửi lại vào chính session khi output hỏng.
 *
 * Rẻ vì session đã giữ nguyên ngữ cảnh — không phải gửi lại payload đầu vào.
 * Chỉ thử ĐÚNG MỘT LẦN; hỏng tiếp thì coi như stage blocked.
 */
export function repairPrompt(stage: StageId, err: StageOutputError): string {
  return [
    "Output vừa rồi không dùng được: " + err.reason + ".",
    "Hãy trả lời LẠI, chỉ một JSON object thuần, không có ```, không có câu dẫn.",
    `Bắt buộc có: "status" (một trong: ${STAGE_STATUSES[stage].join(" | ")}) và ` +
      `"message_to_user" (chuỗi tiếng Việt hoàn chỉnh, hoặc null).`,
    "Giữ nguyên các field còn lại như lần trước."
  ].join("\n");
}

/** Trạng thái run — đồng thời là bộ định tuyến ở webhook. */
export type RunStatus =
  | "running_a"
  | "running_b"
  | "running_c"
  | "running_d"
  | "awaiting_user"
  | "awaiting_selection"
  | "done"
  | "blocked"
  | "failed"
  | "expired"
  | "cancelled";

/** Các trạng thái coi như đã kết thúc — khớp với partial index trong bootstrap.sql */
export const TERMINAL_STATUSES: readonly RunStatus[] = [
  "done",
  "blocked",
  "failed",
  "expired",
  "cancelled"
];

/** Run bị bỏ quên quá lâu thì dọn, để nhóm mở được run mới. */
export const RUN_TTL_MS = envInt("ZINO_PIPELINE_TTL_MS", 24 * 60 * 60 * 1000);

/**
 * Timeout theo stage — đo bằng spike thật, không phải đoán.
 *
 * B: 87s cho một lượt đầy đủ (cold start 3.3s + gọi MCP 2s + 77s SINH JSON
 * 9276 ký tự với effort=high). Nút thắt là output, không phải thu thập.
 * Để 180s cho có biên; giảm được nếu agent đổi sang effort=medium.
 *
 * C: nhiều khả năng còn nặng hơn B — nó nuốt toàn bộ offers rồi dựng 3 variant.
 * Để rộng cho tới khi đo được.
 */
export const STAGE_TIMEOUT_MS: Record<StageId, number> = {
  A: envInt("ZINO_STAGE_A_TIMEOUT_MS", 45_000),
  B: envInt("ZINO_STAGE_B_TIMEOUT_MS", 180_000),
  C: envInt("ZINO_STAGE_C_TIMEOUT_MS", 180_000),
  D: envInt("ZINO_STAGE_D_TIMEOUT_MS", 60_000)
};

/** agent_id của 4 agent team dựng trên Claude Console. */
export function agentIdFor(stage: StageId): string | null {
  return process.env[`ZINO_AGENT_${stage}_ID`] ?? null;
}

export function pipelineEnabled(): boolean {
  return process.env.ZINO_PIPELINE_ENABLED === "1";
}

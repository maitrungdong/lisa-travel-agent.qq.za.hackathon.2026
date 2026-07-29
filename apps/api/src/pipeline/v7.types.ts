/**
 * Contract Agent System v7.1 — ba agent: intake_router → planning_brain → zalo_finalizer.
 *
 * Khác v2 ở chỗ căn bản: đây KHÔNG phải pipeline cố định. Phần lớn tin nhắn
 * dừng ngay ở Intake (`target: "deliver"`) và không bao giờ chạm Brain. Chỉ
 * khi nhóm gõ đúng `BẮT ĐẦU RESEARCH` mới tốn một lượt Brain nặng.
 *
 * Backend ở đây cố tình "ngu": không hiểu ý định, không viết chữ cho user,
 * không quyết định follow-up nào còn trong phạm vi (v7 §3.1). Chỉ gọi agent,
 * parse JSON, áp state patch, kiểm invariant, gửi nguyên `message_to_user`.
 */

import { envInt } from "./pipeline.types";

export type V7Agent = "INTAKE" | "BRAIN" | "FINALIZER";

export const V7_AGENT_LABEL: Record<V7Agent, string> = {
  INTAKE: "Intake Router",
  BRAIN: "Planning Brain",
  FINALIZER: "Zalo Finalizer"
};

export function v7AgentId(agent: V7Agent): string | null {
  return process.env[`ZINO_AGENT_${agent}_ID`] || null;
}

export function v7Enabled(): boolean {
  return process.env.ZINO_V7_ENABLED === "1";
}

/**
 * Timeout theo agent.
 *
 * BRAIN rộng nhất: opus-5 effort high, ngân sách tới 4 web_search + 4 web_fetch
 * + 2 bash, lại phải sinh cả draft lẫn evidence lẫn quality. Đo thật cho
 * v2_offer_scout (sonnet-5, nhẹ hơn nhiều) đã là 87s — trong đó 77s chỉ để
 * SINH JSON, không phải tìm kiếm. Nên để rộng cho tới khi có số đo của Brain.
 */
export const V7_TIMEOUT_MS: Record<V7Agent, number> = {
  INTAKE: envInt("ZINO_INTAKE_TIMEOUT_MS", 45_000),
  BRAIN: envInt("ZINO_BRAIN_TIMEOUT_MS", 300_000),
  FINALIZER: envInt("ZINO_FINALIZER_TIMEOUT_MS", 90_000)
};

/* ==================================================================== */
/* Trigger                                                              */
/* ==================================================================== */

/** Chữ chính xác mà nhóm phải gõ để cho phép chạy research (v7 §2.5). */
export const RESEARCH_TRIGGER = "BẮT ĐẦU RESEARCH";

/**
 * Chuẩn hoá theo đúng v7 §2.5: trim, bỏ phân biệt hoa thường, có thể bỏ dấu
 * câu cuối. Ngoài ra KHÔNG chấp nhận gì khác.
 *
 * Hàm này chỉ dùng để LOG và đo, không dùng để định tuyến — chính Intake mới
 * là bên quyết định (§2.2 cấm backend tự phân loại ngữ nghĩa). Giữ lại vì khi
 * Intake không nhận ra trigger, biết được user đã gõ đúng hay chưa là thông
 * tin gỡ lỗi quan trọng.
 */
export function looksLikeResearchTrigger(text: string): boolean {
  const norm = text
    .normalize("NFC")
    .trim()
    .replace(/[.!…]+$/u, "")
    .trim()
    .toUpperCase();
  if (norm === RESEARCH_TRIGGER) return true;

  /**
   * Đường lui cho chat nhóm.
   *
   * Zalo chèn `"@Tên Bot "` vào đầu mọi tin gửi bot trong nhóm, và tên bot có
   * dấu cách nên `stripBotMention` chỉ gỡ sạch được khi biết `ZALO_BOT_NAME`.
   * Chưa cấu hình biến đó thì so sánh chính xác ở trên luôn trượt — tức là
   * trigger duy nhất mở Brain không bao giờ bấm được, đúng trong môi trường
   * sản phẩm này sinh ra để chạy.
   *
   * Nới đúng một nấc: CHỈ khi tin bắt đầu bằng mention thì mới chấp nhận
   * trigger đứng ở cuối. Không phải "chứa đâu đó" — `BẮT ĐẦU RESEARCH` phải là
   * phần kết của câu, nên "đừng BẮT ĐẦU RESEARCH vội" vẫn bị từ chối.
   */
  return /^@/u.test(text.trim()) && norm.endsWith(RESEARCH_TRIGGER);
}

/* ==================================================================== */
/* Lỗi                                                                  */
/* ==================================================================== */

export class V7ValidationError extends Error {
  constructor(
    readonly agent: V7Agent,
    readonly reason: string,
    readonly raw?: unknown
  ) {
    super(`${V7_AGENT_LABEL[agent]} trả kết quả không hợp lệ: ${reason}`);
  }
}

/* ==================================================================== */
/* Kiểu output                                                          */
/* ==================================================================== */

export interface IntakeResult {
  status: string;
  route: {
    target: "deliver" | "brain";
    interaction_type?: string;
    primary_intent?: string;
    request_mode?: string;
    brain_effort?: string | null;
    confidence?: number;
    reason_code?: string;
  };
  handoff: {
    deliverable_type?: string | null;
    brief_complete?: boolean;
    missing_blockers?: unknown[];
    owner_confirmation?: string;
    scope_summary?: string | null;
    [k: string]: unknown;
  };
  state_patch?: unknown;
  message_to_user: string | null;
  [k: string]: unknown;
}

export interface BrainResult {
  status: string;
  response_kind?: string;
  decision_summary?: string;
  state_patch?: unknown;
  draft_message_to_user: string;
  evidence: unknown[];
  quality: Record<string, unknown>;
  [k: string]: unknown;
}

export interface FinalizerResult {
  status: string;
  message_to_user: string;
  reply_contract: Record<string, unknown>;
  state_patch?: unknown;
  [k: string]: unknown;
}

/* ==================================================================== */
/* Parse                                                                */
/* ==================================================================== */

/**
 * v7 §3.2: "Reject code fences or prose outside JSON."
 *
 * Nhưng thực nghiệm hôm 29/07 cho thấy agent Managed Agents CÓ bọc ```json
 * dù prompt cấm — `v2_offer_scout` làm đúng như vậy. Nên vẫn bóc fence, chỉ
 * ghi log để biết prompt cần siết. Từ chối cứng ở đây là tự bắn vào chân
 * ngay hôm demo.
 */
export function parseAgentJson(agent: V7Agent, raw: string): Record<string, unknown> {
  const text = String(raw ?? "").trim();
  const candidates: (string | null | undefined)[] = [
    text,
    text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1],
    sliceOuterBraces(text)
  ];

  for (const cand of candidates) {
    if (!cand) continue;
    try {
      const v = JSON.parse(cand.trim());
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* thử ứng viên kế */
    }
  }
  throw new V7ValidationError(agent, "không phải một JSON object", text.slice(0, 500));
}

function sliceOuterBraces(t: string): string | null {
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  return a >= 0 && b > a ? t.slice(a, b + 1) : null;
}

/* ==================================================================== */
/* Validator — v7 §10                                                   */
/* ==================================================================== */

/** §10.1 + §6.9. Invariant của cổng Brain nằm ở đây, không nằm trong service. */
export function validateIntake(o: Record<string, unknown>): IntakeResult {
  const bad = (r: string) => {
    throw new V7ValidationError("INTAKE", r, o);
  };

  const route = o.route as IntakeResult["route"] | undefined;
  if (!route || typeof route !== "object") bad("thiếu `route`");
  if (route!.target !== "deliver" && route!.target !== "brain") {
    bad(`route.target phải là "deliver" hoặc "brain", nhận được ${JSON.stringify(route!.target)}`);
  }

  const handoff = (o.handoff ?? {}) as IntakeResult["handoff"];
  const msg = o.message_to_user;

  if (route!.target === "deliver") {
    if (typeof msg !== "string" || msg.trim().length === 0) {
      bad("target=deliver nhưng message_to_user rỗng — user sẽ không nhận được gì");
    }
  } else {
    // Cổng Brain — v7 §6.9. Sai một điều kiện là Brain chạy oan, tốn nhất hệ thống.
    if (msg !== null) bad("target=brain thì message_to_user phải là null");
    if (handoff.brief_complete !== true) bad("target=brain nhưng brief_complete != true");
    if (!Array.isArray(handoff.missing_blockers)) bad("missing_blockers không phải mảng");
    else if (handoff.missing_blockers.length > 0) {
      bad(`còn ${handoff.missing_blockers.length} blocker chưa gỡ`);
    }
    if (handoff.owner_confirmation !== "confirmed") {
      bad(`owner_confirmation = ${JSON.stringify(handoff.owner_confirmation)}, cần "confirmed"`);
    }
    if (typeof handoff.scope_summary !== "string" || handoff.scope_summary.trim().length === 0) {
      bad("scope_summary rỗng");
    }
  }

  return o as unknown as IntakeResult;
}

/** §10.2 */
export function validateBrain(o: Record<string, unknown>): BrainResult {
  const bad = (r: string) => {
    throw new V7ValidationError("BRAIN", r, o);
  };
  if (typeof o.status !== "string") bad("thiếu `status`");
  if (typeof o.draft_message_to_user !== "string" || !o.draft_message_to_user.trim()) {
    bad("thiếu `draft_message_to_user`");
  }
  if (!Array.isArray(o.evidence)) bad("thiếu `evidence`");
  if (!o.quality || typeof o.quality !== "object") bad("thiếu `quality`");
  return o as unknown as BrainResult;
}

/** §10.3 */
export function validateFinalizer(o: Record<string, unknown>): FinalizerResult {
  const bad = (r: string) => {
    throw new V7ValidationError("FINALIZER", r, o);
  };
  if (typeof o.message_to_user !== "string" || !o.message_to_user.trim()) {
    bad("thiếu `message_to_user`");
  }
  if (!o.reply_contract || typeof o.reply_contract !== "object") bad("thiếu `reply_contract`");
  return o as unknown as FinalizerResult;
}

/**
 * Chuỗi thoát flow. Khớp trong `zalo.controller.ts` bằng regex.
 *
 * Để ở đây vì mọi tin lỗi đều phải nhắc tới nó — nếu đổi chữ thì phải đổi cả
 * hai nơi, và hằng số chung là cách rẻ nhất để không quên.
 */
export const ESCAPE_WORD = "thoát";

/**
 * §10.4 — tin nhắn dự phòng khi output agent hỏng.
 *
 * Cố ý ngắn và không bịa câu trả lời thay thế. Không lộ chi tiết prompt/tool.
 *
 * PHẢI NHẮC LỐI THOÁT. Khi flow v7 đang mở thì MỌI tin nhắn của nhóm đi thẳng
 * vào Intake (`zalo.controller.ts` `routeToPipeline`), nghĩa là 20 tool còn lại
 * — ghi chi phí, nhắc hẹn, đọc bill, Partner Network — tạm thời không với tới
 * được. Nếu Intake hỏng lặp lại mà user không biết gõ "thoát", cả nhóm mắc kẹt
 * cho tới khi TTL 24h quét. Một dòng chữ ở đây rẻ hơn nhiều so với hậu quả đó.
 */
export const SAFE_FALLBACK_MESSAGE =
  "Mình chưa xử lý trọn vẹn yêu cầu này. Bạn gửi lại tin nhắn cuối giúp mình nhé.\n" +
  `Nếu vẫn không được, nhắn "${ESCAPE_WORD}" để mình quay lại bình thường.`;

/** Tin khi agent chạy quá lâu. Cũng phải có lối thoát, vì cùng lý do trên. */
export const TIMEOUT_MESSAGE =
  "Mình tìm lâu quá mà chưa xong 😅 Bạn thử nhờ lại, hoặc thu hẹp yêu cầu giúp mình nhé.\n" +
  `Muốn dừng hẳn thì nhắn "${ESCAPE_WORD}".`;

/**
 * Số lượt hỏng LIÊN TIẾP trước khi backend tự đóng flow.
 *
 * Vì sao cần: `handleFailure` cố ý giữ flow sống sau lỗi validate và lỗi
 * timeout — đúng cho sự cố thoáng qua, nhưng với lỗi lặp lại (prompt hỏng, agent
 * bị xoá trên Console, key hết hạn) thì nó biến thành một cái bẫy: mỗi lượt user
 * nhắn lại đều rơi vào đúng lỗi cũ. Đếm hai lần rồi tự mở cửa.
 *
 * Chọn 2 chứ không phải 1: một lần hỏng rất hay là do agent trả JSON bị cắt, và
 * lượt sau thường tự khỏi.
 */
export const MAX_CONSECUTIVE_FAILURES = 2;

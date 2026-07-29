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
   * Đường lui cho chat nhóm: chấp nhận trigger đứng CUỐI câu.
   *
   * Zalo chèn `"@Tên Bot "` vào đầu mọi tin gửi bot trong nhóm. Tên bot có dấu
   * cách nên `stripBotMention` chỉ gỡ trọn khi biết `ZALO_BOT_NAME`; chưa cấu
   * hình thì còn sót `"ZINO - Trợ lý nhu cầu BẮT ĐẦU RESEARCH"` và so sánh
   * chính xác ở trên trượt — tức là công tắc duy nhất mở Brain không bấm được.
   *
   * ⚠ Bản trước thêm điều kiện "tin phải bắt đầu bằng @" để giới hạn nới lỏng.
   * Sai, và sai theo kiểu khó thấy: hàm này nhận text ĐÃ qua `stripBotMention`,
   * nên dấu `@` luôn bị gỡ trước khi tới đây. Điều kiện đó không bao giờ đúng,
   * và hai lớp phòng vệ triệt tiêu lẫn nhau. Đo thật 29/07: ba lượt user gõ
   * đúng trigger mà log không hề đánh dấu.
   *
   * Chỉ khớp ở CUỐI, không phải "chứa đâu đó" — nên "đừng BẮT ĐẦU RESEARCH
   * vội" vẫn bị từ chối. Nhận nhầm ở đây tốn một lượt Brain; bỏ sót thì cả
   * tính năng chính không dùng được.
   */
  return norm.endsWith(RESEARCH_TRIGGER);
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
  /** §7 nói là chuỗi; agent thật trả object {rationale, key_caveats,…} */
  decision_summary?: string | Record<string, unknown>;
  state_patch?: unknown;
  /** Có thể vắng — agent thật đóng gói nội dung trong `answer_payload` */
  draft_message_to_user?: string;
  answer_payload?: Record<string, unknown>;
  evidence?: unknown[];
  quality?: Record<string, unknown>;
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

/**
 * §10.1 + §6.9. Invariant của cổng Brain nằm ở đây, không nằm trong service.
 *
 * `hasPriorBrainRun` — lượt này có phải LẦN ĐẦU giao việc cho Brain không.
 *
 * Cổng năm điều kiện được viết cho lần bàn giao đầu tiên: mục đích là ngăn một
 * lượt Brain 200 giây chạy oan trên yêu cầu còn mơ hồ. Nhưng người dùng còn có
 * lượt TIẾP THEO — chọn phương án, đổi một ràng buộc — và ở đó `scope_summary`
 * đã chốt từ lượt trước, đang nằm trong `thin_state`, và Brain nhận được nó.
 * Bắt Intake khai lại là thừa, và §6.9 không hề nói tới tình huống này.
 *
 * ĐO THẬT 29/07 09:22: sau một lượt research thành công, user chọn phương án
 * xe → Intake trả `target=brain`, `brain_task="selection"`, `scope_summary`
 * rỗng → bị chặn, mất luôn lượt chọn.
 *
 * Tín hiệu dùng để nới là thứ BACKEND tự biết chắc — đã từng tạo session Brain
 * cho run này chưa — chứ không phải đoán theo hình dạng state của agent.
 */
export function validateIntake(
  o: Record<string, unknown>,
  opts: { hasPriorBrainRun?: boolean } = {}
): IntakeResult {
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
    const scopeOk =
      typeof handoff.scope_summary === "string" && handoff.scope_summary.trim().length > 0;
    // Lượt đầu bắt buộc có scope; lượt tiếp theo thì scope đã nằm trong thin_state
    if (!scopeOk && !opts.hasPriorBrainRun) bad("scope_summary rỗng");
  }

  return o as unknown as IntakeResult;
}

/**
 * §10.2, nhưng NỚI theo agent thật.
 *
 * ĐO THẬT 29/07 09:06: Brain chạy 155,4s, trả 12.556 ký tự JSON hợp lệ với
 * `{status, response_kind, decision_summary: {...}, answer_payload: {...}}` —
 * KHÔNG có `draft_message_to_user`, `evidence`, `quality`. Bản validate cũ đòi
 * đủ ba field đó nên ném lỗi và vứt trọn 155 giây công việc, rồi gửi cho nhóm
 * một câu xin lỗi.
 *
 * Sai lầm ở đây là siết chặt thứ backend KHÔNG ĐỌC. Cả khối `brain_result`
 * được truyền nguyên vẹn sang Finalizer; Finalizer mới là bên soạn chữ. Nên
 * điều kiện đúng chỉ có hai: có `status`, và có ít nhất một thứ để Finalizer
 * làm việc. Thiếu `evidence`/`quality` thì ghi log — đó là tín hiệu prompt cần
 * siết, không phải lý do vứt kết quả.
 */
export function validateBrain(o: Record<string, unknown>): BrainResult {
  const bad = (r: string) => {
    throw new V7ValidationError("BRAIN", r, o);
  };
  if (typeof o.status !== "string" || !o.status.trim()) bad("thiếu `status`");

  const isObj = (v: unknown) => !!v && typeof v === "object";
  const hasContent =
    (typeof o.draft_message_to_user === "string" && o.draft_message_to_user.trim().length > 0) ||
    isObj(o.answer_payload) ||
    isObj(o.decision_summary) ||
    (typeof o.decision_summary === "string" && o.decision_summary.trim().length > 0);

  if (!hasContent) {
    bad("không có draft_message_to_user, answer_payload hay decision_summary — Finalizer sẽ không có gì để soạn");
  }
  return o as unknown as BrainResult;
}

/**
 * Rút một dòng tóm tắt người đọc được từ `decision_summary`.
 *
 * Cần vì §7 nói field này là chuỗi còn agent thật trả object — gọi thẳng
 * `.trim()` lên nó là `TypeError`, và vì `persistTurn` bọc try/catch nên lỗi
 * đó chỉ hiện thành một dòng warn rồi Mini App trống trơn mà không ai biết vì sao.
 */
export function brainSummaryText(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const pick = o.rationale ?? o.summary ?? o.text;
  if (typeof pick === "string" && pick.trim()) return pick.trim();
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
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

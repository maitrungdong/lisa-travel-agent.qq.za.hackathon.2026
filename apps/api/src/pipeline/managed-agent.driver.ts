import { Injectable, Logger } from "@nestjs/common";
import {
  envStr,
  parseStageOutput,
  repairPrompt,
  StageOutputError,
  STAGE_TIMEOUT_MS,
  agentIdFor,
  type StageId,
  type StageOutput
} from "./pipeline.types";

/**
 * Gọi Claude Managed Agents — 4 agent team đã dựng sẵn trên Console.
 *
 * VÌ SAO DÙNG fetch THAY VÌ SDK:
 * Tài liệu Managed Agents chỉ có ví dụ Python/curl; tên method tương ứng bên
 * TypeScript chưa xác minh được. REST thì ổn định và soi được bằng curl khi
 * lỗi. Đổi sang SDK sau cũng chỉ phải sửa ba hàm private ở cuối file này.
 *
 * ⚠ BA ĐIỂM CẦN SPIKE XÁC MINH TRƯỚC KHI TIN:
 *   1. Đường dẫn endpoint (/v1/sessions...) — suy từ doc, chưa gọi thật
 *   2. Hình dạng event trả về (agent.message.content là mảng block?)
 *   3. Thời gian dựng sandbox lần đầu — quyết định ZINO_STAGE_B_TIMEOUT_MS
 *
 * Cả ba đều lộ ra ngay lần chạy đầu tiên; log ở dưới in đủ để chẩn đoán.
 */

const API_BASE = envStr("ANTHROPIC_API_BASE", "https://api.anthropic.com");
const BETA_HEADER = envStr("ZINO_MANAGED_AGENTS_BETA", "managed-agents-2026-04-01");

/**
 * Stage chạy quá lâu.
 *
 * KHÔNG được retry: agent vẫn đang chạy trên hạ tầng Anthropic sau khi client
 * bỏ cuộc, nên gọi lại là chạy song song hai lượt cùng một việc — tốn tiền,
 * và lượt sau ghi đè state của lượt trước. JobsService mặc định retry 3 lần
 * nên phải phân biệt lỗi này với lỗi mạng.
 */
export class StageTimeoutError extends Error {
  constructor(
    readonly stage: string,
    readonly sessionId: string,
    readonly ms: number
  ) {
    super(`Stage ${stage} quá ${ms / 1000}s (session ${sessionId} có thể vẫn đang chạy)`);
  }
}

export interface StageCallResult {
  output: StageOutput;
  sessionId: string;
  /** Có phải đã tốn thêm một lượt sửa JSON không — theo dõi để biết prompt yếu */
  repaired: boolean;
  elapsedMs: number;
}

@Injectable()
export class ManagedAgentDriver {
  private readonly log = new Logger(ManagedAgentDriver.name);

  /**
   * Key RIÊNG cho Managed Agents.
   *
   * API key gắn với một workspace, và 4 agent của team nằm ở workspace khác
   * với key mà AgentService đang dùng. Tách biến ra để:
   *  • không phải đụng vào ANTHROPIC_API_KEY đang nuôi con bot chạy tốt
   *  • đổi workspace cho pipeline mà không làm nguội prompt cache của bot
   *
   * Không đặt thì rơi về key chung — đúng cho trường hợp cùng workspace.
   */
  private get apiKey(): string {
    return process.env.ZINO_AGENT_API_KEY || process.env.ANTHROPIC_API_KEY || "";
  }

  private get environmentId(): string {
    return process.env.ZINO_AGENT_ENV_ID ?? "";
  }

  /**
   * Gọi MỘT agent bất kỳ và trả về text thô.
   *
   * Tách khỏi `runStage` để dùng chung cho cả hai kiến trúc: pipeline 4 stage
   * (v2) và ba agent Intake/Brain/Finalizer (v7). Phần validate output khác
   * nhau hoàn toàn giữa hai bên nên để caller tự lo.
   */
  async runAgent(opts: {
    agentId: string;
    payload: unknown;
    timeoutMs: number;
    traceId: string;
    /** Nhãn ngắn cho log và tiêu đề session, vd "INTAKE" */
    label: string;
    existingSessionId?: string | null;
  }): Promise<{ raw: string; sessionId: string; elapsedMs: number }> {
    const started = Date.now();
    if (!opts.agentId) throw new Error(`Thiếu agent id cho ${opts.label}`);
    if (!this.environmentId) throw new Error("Thiếu biến môi trường ZINO_AGENT_ENV_ID");
    if (!this.apiKey) throw new Error("Thiếu ANTHROPIC_API_KEY / ZINO_AGENT_API_KEY");

    const sessionId =
      opts.existingSessionId ?? (await this.createSession(opts.agentId, opts.label, opts.traceId));

    const body = typeof opts.payload === "string" ? opts.payload : JSON.stringify(opts.payload);
    const raw = await this.sendAndCollect(sessionId, body, opts.timeoutMs, opts.label);
    return { raw, sessionId, elapsedMs: Date.now() - started };
  }

  /**
   * Chạy một stage của pipeline v2.
   *
   * `existingSessionId` khác null nghĩa là dùng lại session cũ — bắt buộc cho
   * hai tình huống: A hỏi lại rồi user trả lời (session giữ hộ `current_state`,
   * khỏi tự quản), và B retry khi thiếu source data.
   */
  async runStage(
    stage: StageId,
    payload: unknown,
    opts: { existingSessionId?: string | null; traceId: string }
  ): Promise<StageCallResult> {
    const started = Date.now();
    const agentId = agentIdFor(stage);

    if (!agentId) throw new Error(`Thiếu biến môi trường ZINO_AGENT_${stage}_ID`);
    if (!this.environmentId) throw new Error("Thiếu biến môi trường ZINO_AGENT_ENV_ID");
    if (!this.apiKey) throw new Error("Thiếu ANTHROPIC_API_KEY");

    const sessionId =
      opts.existingSessionId ?? (await this.createSession(agentId, stage, opts.traceId));

    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    let raw = await this.sendAndCollect(sessionId, body, STAGE_TIMEOUT_MS[stage], stage);

    try {
      return {
        output: parseStageOutput(stage, raw),
        sessionId,
        repaired: false,
        elapsedMs: Date.now() - started
      };
    } catch (err) {
      if (!(err instanceof StageOutputError)) throw err;

      // Managed Agents không ép được JSON schema (define-outcomes chỉ chấm
      // rubric), nên đây là lớp phòng thủ duy nhất. Sửa ĐÚNG MỘT LẦN — session
      // còn nguyên ngữ cảnh nên không phải gửi lại payload.
      this.log.warn(`[${opts.traceId}] ${stage} output hỏng (${err.reason}) → xin sửa lại`);
      raw = await this.sendAndCollect(
        sessionId,
        repairPrompt(stage, err),
        STAGE_TIMEOUT_MS[stage],
        stage
      );

      return {
        output: parseStageOutput(stage, raw), // hỏng tiếp thì ném lên, caller cho blocked
        sessionId,
        repaired: true,
        elapsedMs: Date.now() - started
      };
    }
  }

  /** Dọn session khi run kết thúc. Lỗi ở đây không đáng làm hỏng luồng chính. */
  async deleteSessions(sessions: Record<string, string>): Promise<void> {
    await Promise.all(
      Object.values(sessions).map((id) =>
        this.request("DELETE", `/v1/sessions/${id}`).catch((e) =>
          this.log.warn(`Không xoá được session ${id}: ${(e as Error).message}`)
        )
      )
    );
  }

  /* ------------------------------------------------------------------ */
  /* Ba hàm dưới là chỗ duy nhất chạm vào REST của Managed Agents.       */
  /* Đổi sang SDK thì chỉ sửa trong phạm vi này.                          */
  /* ------------------------------------------------------------------ */

  private async createSession(agentId: string, stage: string, traceId: string): Promise<string> {
    const res = await this.request("POST", "/v1/sessions", {
      agent: agentId,
      environment_id: this.environmentId,
      title: `Zino ${stage} · ${traceId}`
    });
    const id = (res as { id?: string }).id;
    if (!id) throw new Error(`Tạo session thất bại: ${JSON.stringify(res).slice(0, 300)}`);
    this.log.debug(`[${traceId}] ${stage} → session ${id}`);
    return id;
  }

  /**
   * Mở stream TRƯỚC rồi mới gửi tin — đúng thứ tự quickstart hướng dẫn, để
   * không mất event nào phát ra trước khi kịp lắng nghe.
   */
  private async sendAndCollect(
    sessionId: string,
    text: string,
    timeoutMs: number,
    stage: string
  ): Promise<string> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);

    try {
      const stream = await fetch(`${API_BASE}/v1/sessions/${sessionId}/events/stream`, {
        method: "GET",
        headers: { ...this.headers(), accept: "text/event-stream" },
        signal: abort.signal
      });
      if (!stream.ok || !stream.body) {
        throw new Error(`Mở stream lỗi ${stream.status}: ${await safeText(stream)}`);
      }

      await this.request("POST", `/v1/sessions/${sessionId}/events`, {
        events: [{ type: "user.message", content: [{ type: "text", text }] }]
      });

      return await readUntilIdle(stream.body, stage);
    } catch (err) {
      if (abort.signal.aborted) throw new StageTimeoutError(stage, sessionId, timeoutMs);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!res.ok) {
      throw new Error(`${method} ${path} → ${res.status}: ${await safeText(res)}`);
    }
    return res.status === 204 ? {} : await res.json();
  }

  private headers(): Record<string, string> {
    return {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": BETA_HEADER,
      "content-type": "application/json"
    };
  }
}

/**
 * Đọc SSE tới khi session báo idle, gom toàn bộ text của `agent.message`.
 *
 * Chỉ gom text — `agent.tool_use` và `tool.result` bỏ qua (đó là B đang đi tìm
 * offer, không phải câu trả lời). Lượt cuối cùng của agent mới là JSON ta cần.
 */
async function readUntilIdle(body: ReadableStream<Uint8Array>, stage: string): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let collected = "";
  let toolCalls = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let ev: Record<string, any>;
        try {
          ev = JSON.parse(payload);
        } catch {
          continue; // dòng keep-alive hoặc chunk chưa đủ
        }

        switch (ev.type) {
          case "agent.message":
            // Mỗi lượt agent nói là một message mới — giữ lượt CUỐI, vì các
            // lượt trước thường là "để tôi tra cứu..." trước khi gọi tool.
            collected = extractText(ev.content) || collected;
            break;
          // MCP dùng event RIÊNG `agent.mcp_tool_use`, không phải `agent.tool_use`.
          // Đếm thiếu thì log báo "0 tool" trong khi agent vừa gọi Booking.
          case "agent.tool_use":
          case "agent.mcp_tool_use":
            toolCalls++;
            break;
          case "session.error":
            throw new Error(`session.error: ${JSON.stringify(ev.error ?? ev).slice(0, 300)}`);
          case "session.status_idle": {
            /**
             * ⚠ stop_reason là OBJECT, không phải string — spike thật trả về
             * `[object Object]`. Chỉ coi là lỗi khi nó thuộc nhóm error_*
             * (error_max_turns, error_max_budget_usd); các giá trị khác cứ
             * lấy text đã gom được.
             */
            const reason =
              typeof ev.stop_reason === "string" ? ev.stop_reason : (ev.stop_reason?.type ?? "");
            if (typeof reason === "string" && reason.startsWith("error")) {
              throw new Error(`Session dừng vì ${reason}`);
            }
            return finish(collected, stage, toolCalls);
          }
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return finish(collected, stage, toolCalls);
}

function finish(collected: string, stage: string, toolCalls: number): string {
  if (!collected.trim()) {
    throw new Error(`Stage ${stage} không trả về text nào (đã gọi ${toolCalls} tool)`);
  }
  return collected;
}

/** content có thể là string, hoặc mảng block {type:"text", text} */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => (typeof b === "string" ? b : ((b as { text?: string })?.text ?? "")))
    .join("");
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "(không đọc được body)";
  }
}

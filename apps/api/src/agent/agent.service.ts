import Anthropic from "@anthropic-ai/sdk";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { DB, type Database } from "../db/database.module";
import { JobsService } from "../jobs/jobs.service";
import { MediaService, visionMime } from "../media/media.service";
import { ConversationService } from "../zalo/conversation.service";
import { buildSystemPrompt } from "./prompt";
import { loadTripState, toolMap, toolsForApi, type ToolContext } from "./tools";

const MODEL = process.env.LISA_MODEL ?? "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 8;
const MAX_TOKENS = 2000;

export interface AgentTurnInput {
  conversationId: number;
  zaloChatId: string;
  senderZaloId: string;
  senderName: string;
  text: string | null;
  imageUrl: string | null;
  imagePath: string | null;
  imageMime: string | null;
}

export interface AgentTurnResult {
  reply: string;
  toolsUsed: string[];
  rounds: number;
}

type Msg = Anthropic.MessageParam;

/**
 * Một lượt hội thoại của Lisa.
 *
 * Thiết kế:
 *  • Hot path dùng Messages API (không phải Managed Agents) vì cần <3s và cần
 *    strict tool schema. Việc dài chạy nền qua job queue.
 *  • Vòng lặp tool có TRẦN CỨNG — model lú không làm treo hệ thống.
 *  • Tool lỗi trả ok:false cho model tự xoay, KHÔNG ném exception ra user.
 */
@Injectable()
export class AgentService {
  private readonly log = new Logger(AgentService.name);
  private readonly client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    maxRetries: 2
  });

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly conversations: ConversationService,
    private readonly media: MediaService,
    private readonly jobs: JobsService
  ) {}

  async runTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
    const conv = await this.db.query.conversations.findFirst({
      where: (c, { eq }) => eq(c.id, input.conversationId)
    });
    if (!conv) throw new Error(`Không tìm thấy conversation ${input.conversationId}`);

    const memory = await this.db.query.groupMemory.findFirst({
      where: (m, { eq }) => eq(m.conversationId, input.conversationId)
    });

    // Tool có thể đổi trip active giữa chừng (create_trip) → giữ ở biến ngoài
    let activeTripId = conv.activeTripId;

    const ctx: ToolContext = {
      db: this.db,
      conversationId: input.conversationId,
      get tripId() {
        return activeTripId;
      },
      zaloChatId: input.zaloChatId,
      senderZaloId: input.senderZaloId,
      senderName: input.senderName,
      publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, ""),
      setActiveTrip: (id) => {
        activeTripId = id;
        void this.conversations.setActiveTrip(input.conversationId, id);
      },
      enqueue: async (kind, payload, runAt) => {
        await this.jobs.enqueue(kind as never, payload, { runAt });
      }
    } as ToolContext;

    const tripState = await loadTripState(ctx);

    const system = buildSystemPrompt({
      chatType: conv.chatType,
      senderName: input.senderName,
      seenCount: conv.seenCount,
      isReturning: conv.seenCount > 1,
      memory: memory?.content ?? "",
      tripState: tripState ? JSON.stringify(tripState, null, 2) : null,
      nowIso: new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    });

    const messages = await this.buildHistory(input);

    const toolsUsed: string[] = [];
    let rounds = 0;
    let finalText = "";
    const turnStarted = Date.now();

    // Tường thuật để `docker compose logs -f api` đọc được như một dòng thời gian.
    // Quan sát được agent đang làm gì là điều kiện tối thiểu để debug nó.
    const tag = `[${input.zaloChatId.slice(-6)}]`;
    this.log.log(
      `${tag} ▶ ${input.senderName}: ${preview(input.text) || "(ảnh)"}` +
        `${input.imagePath ? " 📎ảnh" : ""}` +
        ` · trip=${activeTripId ?? "chưa có"} · nhớ=${memory?.content ? "có" : "trống"}`
    );

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;

      const res = await this.client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages,
        tools: [
          ...toolsForApi(),
          // Server tool của Anthropic — dùng để tra giá/địa điểm thật, chống bịa số
          { type: "web_search_20260318", name: "web_search", max_uses: 4 } as never
        ]
      });

      const textParts = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text);
      if (textParts.length) finalText = textParts.join("\n\n");

      const toolCalls = res.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      if (res.stop_reason !== "tool_use" || toolCalls.length === 0) break;

      messages.push({ role: "assistant", content: res.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of toolCalls) {
        toolsUsed.push(call.name);
        const started = Date.now();
        const result = await this.execute(call.name, call.input as Record<string, unknown>, ctx);
        const ms = Date.now() - started;

        const args = summarizeArgs(call.input as Record<string, unknown>);
        if (result.ok) {
          this.log.log(`${tag}   🔧 ${call.name}(${args}) ✓ ${ms}ms`);
        } else {
          this.log.warn(`${tag}   🔧 ${call.name}(${args}) ✗ ${ms}ms — ${String(result.error)}`);
        }

        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(result),
          is_error: result.ok === false
        });
      }
      messages.push({ role: "user", content: results });
    }

    this.log.log(
      `${tag} ◀ trả lời ${finalText.length} ký tự · ${rounds} vòng · ` +
        `${toolsUsed.length ? toolsUsed.join(", ") : "không dùng tool"} · ` +
        `${((Date.now() - turnStarted) / 1000).toFixed(1)}s`
    );

    if (rounds >= MAX_TOOL_ROUNDS && !finalText) {
      this.log.warn(`Chạm trần ${MAX_TOOL_ROUNDS} vòng tool mà chưa có câu trả lời`);
      finalText = "Mình đang xử lý hơi lâu 😅 Bạn nhắn lại giúp mình rõ hơn nhé?";
    }

    return { reply: finalText.trim(), toolsUsed, rounds };
  }

  /** Chạy tool, bọc lỗi thành ToolResult để model tự xoay xở. */
  private async execute(
    name: string,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<{ ok: boolean; [k: string]: unknown }> {
    const tool = toolMap.get(name);
    if (!tool) return { ok: false, error: `Tool không tồn tại: ${name}` };

    try {
      return await tool.handler(input, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error(`tool ${name} nổ: ${message}`);
      return {
        ok: false,
        error: message,
        hint: "Tool gặp lỗi kỹ thuật. Nói với user là chưa lưu được, đừng giả vờ thành công."
      };
    }
  }

  /** L1 — dựng lịch sử hội thoại, đính ảnh của lượt hiện tại cho vision đọc. */
  private async buildHistory(input: AgentTurnInput): Promise<Msg[]> {
    const rows = await this.conversations.recentMessages(input.conversationId, 14);
    const messages: Msg[] = [];

    for (const row of rows.slice(0, -1)) {
      const text = row.text?.trim();
      if (!text) continue;
      messages.push({
        role: row.role === "assistant" ? "assistant" : "user",
        content:
          row.role === "assistant" ? text : `${row.senderName ?? "Bạn"}: ${text}`
      });
    }

    // Lượt hiện tại — chỗ duy nhất đính ảnh
    const content: Anthropic.ContentBlockParam[] = [];

    if (input.imagePath) {
      const base64 = await this.media.toBase64(input.imagePath);
      if (base64) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: visionMime(input.imageMime ?? "image/jpeg"),
            data: base64
          }
        });
        content.push({
          type: "text",
          text:
            `[Ảnh đính kèm — URL đã lưu: ${input.imageUrl}]\n` +
            "Tự nhận diện đây là hoá đơn, vé/booking, hay ảnh kỷ niệm rồi hành động tương ứng. " +
            "Nếu là hoá đơn → add_expense kèm receipt_photo_url là URL trên. " +
            "Nếu là ảnh kỷ niệm → add_photo với url là URL trên."
        });
      }
    }

    const text = input.text?.trim();
    if (text) content.push({ type: "text", text: `${input.senderName}: ${text}` });

    if (content.length === 0) content.push({ type: "text", text: `${input.senderName} gửi một tin nhắn.` });

    messages.push({ role: "user", content });

    // Messages API bắt buộc lượt đầu là user
    while (messages.length && messages[0].role !== "user") messages.shift();
    return messages;
  }
}

/** Cắt ngắn để log không tràn màn hình. */
function preview(text: string | null, max = 60): string {
  if (!text) return "";
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/**
 * Tóm tắt input của tool cho dễ đọc trên log.
 * Che các trường dài (URL ảnh, nội dung tin nhắn) — chỉ cần biết agent đang
 * làm gì, không cần đọc nguyên payload.
 */
function summarizeArgs(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null || v === "") continue;
    let s: string;
    if (typeof v === "string") s = v.length > 28 ? `"${v.slice(0, 28)}…"` : `"${v}"`;
    else if (Array.isArray(v)) s = `[${v.length}]`;
    else if (typeof v === "object") s = "{…}";
    else s = String(v);
    parts.push(`${k}=${s}`);
    if (parts.length >= 4) {
      parts.push("…");
      break;
    }
  }
  return parts.join(" ");
}

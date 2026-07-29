import Anthropic from "@anthropic-ai/sdk";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DB, type Database } from "../db/database.module";
import { zinoGroupRuntime } from "../db/schema";
import { envStr } from "../pipeline/pipeline.types";
import { ConversationService } from "../zalo/conversation.service";
import { chunkMessage } from "../zalo/render";
import { ZaloClient } from "../zalo/zalo.client";
import { MemoryClient } from "./memory.client";
import {
  GROUP_STORE_DESCRIPTION,
  GROUP_STORE_INSTRUCTIONS,
  R43_FALLBACK_MESSAGE,
  R43_TIMEOUT_MS,
  TRIP_STORE_DESCRIPTION,
  TRIP_STORE_INSTRUCTIONS,
  environmentId,
  groupSeeds,
  oaFileId,
  oaMountPath,
  outcomeAgentId,
  outcomeAgentVersion,
  r43Enabled,
  seededGroupStoreId,
  seededTripStoreId,
  sessionBetaHeader,
  tripSeeds,
  zaloEnvelope
} from "./r43.types";

const API_BASE = envStr("ANTHROPIC_API_BASE", "https://api.anthropic.com");

type Runtime = typeof zinoGroupRuntime.$inferSelect;

export interface R43TurnJob {
  zaloGroupId: string;
  conversationId: number;
  senderZaloId: string;
  senderName: string;
  text: string;
  /** Đường dẫn ảnh đã tải về, nếu có — sẽ upload lên Files rồi mount vào session */
  imagePath?: string | null;
  imageMime?: string | null;
}

/**
 * Kiến trúc R4.3 Memory-first cho kênh chat Zalo.
 *
 * Backend chỉ còn bốn việc (handoff §1): ánh xạ nhóm sang resource của Claude,
 * tạo và tái dùng session, chuyển tiếp text, upload file người dùng.
 * KHÔNG cung cấp tool, KHÔNG giữ trạng thái nghiệp vụ, KHÔNG parse output.
 *
 * ⚠ PHẠM VI: chỉ Zalo. Mini App giữ nguyên v1 và tự ghi DB qua
 * `POST /trips/:id/chat/act`. Hai bề mặt độc lập — đó là điều kiện khiến việc
 * tách này khả thi, và nó chỉ vừa đúng từ 29/07.
 */
@Injectable()
export class R43Service {
  private readonly log = new Logger(R43Service.name);
  private readonly files = new Anthropic({
    apiKey: process.env.ZINO_AGENT_API_KEY || process.env.ANTHROPIC_API_KEY || "",
    timeout: 60_000,
    maxRetries: 1
  });

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly memory: MemoryClient,
    private readonly zalo: ZaloClient,
    private readonly conversations: ConversationService
  ) {}

  usable(): boolean {
    return r43Enabled() && Boolean(environmentId());
  }

  /* ================================================================ */
  /* Provisioning — handoff §6.1                                      */
  /* ================================================================ */

  /**
   * Lấy runtime của nhóm, chưa có thì dựng.
   *
   * Khoá theo nhóm được ép bằng PRIMARY KEY chứ không bằng mutex trong code:
   * hai webhook đến cùng lúc thì một dòng thắng, dòng thua nhận 23505 rồi đọc
   * lại. Không bao giờ có hai bộ store cho một nhóm.
   *
   * Nếu tạo store xong mà seed hoặc tạo session hỏng, ta KHÔNG lưu mapping —
   * lần sau thử lại sẽ tái dùng store đã có qua biến ZINO_DEMO_*, hoặc tạo mới.
   * Đây là chỗ handoff §14 nói "retry chỉ bước còn thiếu"; với quy mô hackathon
   * thì chấp nhận rủi ro tạo dư một store hơn là dựng máy trạng thái phức tạp.
   */
  async ensureRuntime(input: {
    zaloGroupId: string;
    conversationId: number;
    displayName: string | null;
  }): Promise<Runtime> {
    const existing = await this.load(input.zaloGroupId);
    if (existing) return existing;

    const agentId = outcomeAgentId();
    const envId = environmentId();
    if (!agentId) throw new Error("Thiếu ZINO_R43_OUTCOME_AGENT_ID");
    if (!envId) throw new Error("Thiếu ZINO_R43_ENVIRONMENT_ID");

    const key = opaqueKey(input.zaloGroupId);
    const tripKey = `${key}-t1`;

    /**
     * Nhóm demo đã có sẵn hai store — handoff §3 dặn KHÔNG tạo cặp mới, chỉ
     * seed những đường dẫn còn thiếu. Đặt qua env để đổi nhóm demo không phải
     * sửa code.
     */
    const groupStoreId =
      seededGroupStoreId() ||
      (await this.memory.createStore({
        name: `Zino Group — ${key}`,
        description: GROUP_STORE_DESCRIPTION
      }));

    const tripStoreId =
      seededTripStoreId() ||
      (await this.memory.createStore({
        name: `Zino Trip — ${key} — ${tripKey}`,
        description: TRIP_STORE_DESCRIPTION
      }));

    await this.memory.seed(
      groupStoreId,
      groupSeeds({ zaloGroupId: input.zaloGroupId, displayName: input.displayName })
    );
    await this.memory.seed(tripStoreId, tripSeeds());

    const sessionId = await this.createSession(groupStoreId, tripStoreId);

    try {
      const [row] = await this.db
        .insert(zinoGroupRuntime)
        .values({
          zaloGroupId: input.zaloGroupId,
          conversationId: input.conversationId,
          groupMemoryStoreId: groupStoreId,
          activeTripKey: tripKey,
          activeTripMemoryStoreId: tripStoreId,
          activeSessionId: sessionId,
          outcomeAgentId: agentId,
          outcomeAgentVersion: outcomeAgentVersion(),
          oaFileId: oaFileId() || null
        })
        .returning();
      this.log.log(
        `Dựng runtime R4.3 cho nhóm ${key} · group=${groupStoreId} trip=${tripStoreId} session=${sessionId}`
      );
      return row;
    } catch (err) {
      if ((err as { code?: string })?.code !== "23505") throw err;
      // Nhóm khác thắng cuộc đua — dùng của họ, bỏ session vừa tạo
      this.log.warn(`Nhóm ${key} đã được dựng song song, dùng bản của lượt kia`);
      const again = await this.load(input.zaloGroupId);
      if (!again) throw err;
      return again;
    }
  }

  /**
   * Tạo session Outcome với ba resource.
   *
   * ⚠ Memory Store CHỈ gắn được lúc tạo session — doc nói rõ, không thêm được
   * vào session đang chạy. File thì thêm được. Đó là lý do phục hồi session
   * (§6.3) phải tạo session mới với đúng hai store cũ, chứ không "gắn thêm".
   */
  private async createSession(groupStoreId: string, tripStoreId: string): Promise<string> {
    const version = outcomeAgentVersion();
    const resources: Record<string, unknown>[] = [
      {
        type: "memory_store",
        memory_store_id: groupStoreId,
        access: "read_write",
        instructions: GROUP_STORE_INSTRUCTIONS
      },
      {
        type: "memory_store",
        memory_store_id: tripStoreId,
        access: "read_write",
        instructions: TRIP_STORE_INSTRUCTIONS
      }
    ];

    // Catalog OA upload MỘT LẦN lúc deploy, không phải mỗi nhóm (§9)
    if (oaFileId()) {
      resources.push({ type: "file", file_id: oaFileId(), mount_path: oaMountPath() });
    } else {
      this.log.warn("ZINO_OA_FILE_ID trống — agent sẽ không thấy catalog OA đối tác");
    }

    const res = await this.request<{ id?: string }>("POST", "/v1/sessions", {
      agent: version ? { type: "agent", id: outcomeAgentId(), version } : outcomeAgentId(),
      environment_id: environmentId(),
      resources
    });
    if (!res.id) throw new Error(`Tạo session thất bại: ${JSON.stringify(res).slice(0, 300)}`);
    return res.id;
  }

  /* ================================================================ */
  /* Một lượt — handoff §11                                           */
  /* ================================================================ */

  async turn(job: R43TurnJob): Promise<void> {
    if (!this.usable()) {
      this.log.warn(`Bỏ lượt: ZINO_R43_ENABLED chưa bật hoặc thiếu cấu hình`);
      return;
    }

    const rt = await this.load(job.zaloGroupId);
    if (!rt) {
      this.log.error(`Không có runtime cho nhóm ${job.zaloGroupId}`);
      return;
    }

    const tag = `[${rt.activeTripKey}]`;
    const typing = setInterval(() => void this.zalo.sendTyping(job.zaloGroupId), 8_000);
    void this.zalo.sendTyping(job.zaloGroupId);

    try {
      // Ảnh phải được gắn TRƯỚC khi gửi tin liên quan (§12), nếu không agent
      // đọc tin nhắc tới ảnh mà trong sandbox chưa có gì.
      if (job.imagePath) await this.attachFile(rt, job.imagePath, tag);

      const text = await this.send(
        rt,
        zaloEnvelope({
          senderId: job.senderZaloId,
          senderName: job.senderName,
          sentAt: new Date(),
          text: job.text
        }),
        tag
      );

      clearInterval(typing);
      await this.say(job, text);
    } catch (err) {
      clearInterval(typing);
      this.log.error(`${tag} lượt hỏng: ${(err as Error).message}`);
      await this.say(job, R43_FALLBACK_MESSAGE);
    } finally {
      clearInterval(typing);
    }
  }

  /**
   * Gửi một `user.message` rồi đọc stream tới khi phiên thật sự xong.
   *
   * ⚠ CHỖ HIỂM NHẤT CỦA CẢ KIẾN TRÚC. Đo thật 29/07 với v4: khi Outcome giao
   * việc cho sub-agent, stream phát `session.thread_created` rồi
   * `session.thread_status_idle` — thread CHÍNH nghỉ trong khi thread con chạy
   * 136 giây. Thoát ở đó là trả về câu cụt.
   *
   * Nên chỉ `session.status_idle` (mức PHIÊN) mới là tín hiệu xong.
   * `thread_status_idle` bị bỏ qua có chủ đích.
   *
   * Và chỉ gom `agent.message` của thread chính — §11 cấm chuyển tiếp JSON của
   * Rapid/Expert ra cho người dùng.
   */
  private async send(rt: Runtime, text: string, tag: string): Promise<string> {
    const started = Date.now();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), R43_TIMEOUT_MS);

    try {
      const stream = await fetch(`${API_BASE}/v1/sessions/${rt.activeSessionId}/events/stream`, {
        headers: { ...this.headers(), accept: "text/event-stream" },
        signal: abort.signal
      });
      if (!stream.ok || !stream.body) {
        throw new Error(`Mở stream lỗi ${stream.status}`);
      }

      await this.request("POST", `/v1/sessions/${rt.activeSessionId}/events`, {
        events: [{ type: "user.message", content: [{ type: "text", text }] }]
      });

      const reader = stream.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let out = "";
      let childThreads = 0;

      try {
        outer: for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const p = line.slice(5).trim();
            if (!p || p === "[DONE]") continue;
            let ev: Record<string, unknown>;
            try {
              ev = JSON.parse(p);
            } catch {
              continue;
            }

            switch (ev.type) {
              case "agent.message": {
                // Chỉ lấy thread chính; tin của thread con là JSON nội bộ
                if (ev.thread_id) break;
                const t = extractText(ev.content);
                if (t.trim()) out = t;
                break;
              }
              case "session.thread_created":
                childThreads++;
                break;
              case "session.error":
                throw new Error(`session.error: ${JSON.stringify(ev.error ?? ev).slice(0, 300)}`);
              case "session.status_idle":
                // Đây mới là "xong". `thread_status_idle` thì KHÔNG.
                break outer;
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }

      const secs = ((Date.now() - started) / 1000).toFixed(1);
      this.log.log(
        `${tag} R4.3 ${secs}s · ${out.length} ký tự${childThreads ? ` · ${childThreads} thread con` : ""}`
      );

      if (!out.trim()) {
        // §14: text rỗng thì ghi log id để truy vết, trả lỗi hạ tầng chung
        this.log.error(`${tag} agent trả text rỗng · session=${rt.activeSessionId}`);
        throw new Error("Agent trả về text rỗng");
      }
      return out;
    } catch (err) {
      if (abort.signal.aborted) {
        throw new Error(`Quá ${R43_TIMEOUT_MS / 1000}s (session ${rt.activeSessionId} có thể vẫn chạy)`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Upload ảnh người dùng rồi gắn vào session đang chạy — §12.
   *
   * File gắn được vào session đang chạy (khác Memory Store). Mount read-only;
   * người dùng gửi bản sửa thì upload file mới, không sửa file cũ.
   */
  private async attachFile(rt: Runtime, localPath: string, tag: string): Promise<void> {
    const { createReadStream } = await import("node:fs");
    const { basename } = await import("node:path");
    const safe = basename(localPath).replace(/[^\w.-]/g, "_");
    const mountPath = `/user_uploads/${Date.now()}_${safe}`;

    const uploaded = (await this.files.beta.files.upload({
      file: createReadStream(localPath) as never
    } as never)) as { id?: string };
    if (!uploaded?.id) throw new Error("Upload file thất bại");

    await this.request("POST", `/v1/sessions/${rt.activeSessionId}/resources`, {
      type: "file",
      file_id: uploaded.id,
      mount_path: mountPath
    });
    this.log.log(`${tag} gắn ${mountPath} · ${uploaded.id}`);
  }

  /* ================================================================ */

  private async say(job: R43TurnJob, message: string): Promise<void> {
    const parts = chunkMessage(message);
    for (const [i, part] of parts.entries()) {
      await this.zalo.sendRaw(job.zaloGroupId, part);
      // Ghi lại tin bot: v1 vẫn dùng bảng messages để dựng lịch sử nếu tắt cờ
      await this.conversations.recordOutbound(job.conversationId, part);
      if (i < parts.length - 1) await sleep(350);
    }
  }

  private async load(zaloGroupId: string): Promise<Runtime | null> {
    const [row] = await this.db
      .select()
      .from(zinoGroupRuntime)
      .where(eq(zinoGroupRuntime.zaloGroupId, zaloGroupId))
      .limit(1);
    return row ?? null;
  }

  private headers(): Record<string, string> {
    return {
      "x-api-key": process.env.ZINO_AGENT_API_KEY || process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": sessionBetaHeader(),
      "content-type": "application/json"
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000)
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`${method} ${path} → ${res.status}: ${t.slice(0, 300)}`);
    }
    return res.status === 204 ? ({} as T) : ((await res.json()) as T);
  }
}

/* ------------------------------------------------------------------ */

/**
 * Khoá giả danh cho tên hiển thị trên Console.
 *
 * Handoff §5 khuyên đừng để id Zalo thật xuất hiện trên Console. Hash ngắn là
 * đủ: nó ổn định để tra cứu, mà không lộ danh tính nhóm.
 */
function opaqueKey(zaloGroupId: string): string {
  let h = 0;
  for (let i = 0; i < zaloGroupId.length; i++) h = (h * 31 + zaloGroupId.charCodeAt(i)) | 0;
  return `g${(h >>> 0).toString(36)}`;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (typeof b === "string" ? b : ((b as { text?: string })?.text ?? ""))).join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

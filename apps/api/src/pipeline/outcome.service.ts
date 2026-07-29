import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, notInArray } from "drizzle-orm";
import { DB, type Database } from "../db/database.module";
import { pipelineRuns } from "../db/schema";
import { chunkMessage } from "../zalo/render";
import { ConversationService } from "../zalo/conversation.service";
import { ZaloClient } from "../zalo/zalo.client";
import { ManagedAgentDriver, StageTimeoutError } from "./managed-agent.driver";
import {
  assertNonEmptyReply,
  OUTCOME_FALLBACK_MESSAGE,
  OUTCOME_SESSION_KEY,
  OUTCOME_STAGE,
  OUTCOME_TIMEOUT_MS,
  outcomeAgentId,
  outcomeEnabled
} from "./outcome.types";
import { RUN_TTL_MS, TERMINAL_STATUSES } from "./pipeline.types";

type Run = typeof pipelineRuns.$inferSelect;

export interface OutcomeTurnJob {
  runId: number;
  userMessage: string;
}

/**
 * Hành trình lên kế hoạch bằng `v4_outcome_agent` — kiến trúc v4 Agent-only.
 *
 * TOÀN BỘ TRÁCH NHIỆM của lớp này, theo §11 của bản handoff:
 *   giữ đúng session cho mỗi hành trình · chuyển tiếp text nguyên văn hai chiều
 *   · không chạy hai lượt song song · xử lý lỗi hạ tầng.
 *
 * Và những gì nó CỐ TÌNH không làm: phân loại ý định, parse output, map
 * "Chọn 1/2", lưu progress/brief/option, dựng card hay button.
 *
 * VỊ TRÍ TRONG HỆ — điểm quan trọng nhất:
 * `AgentService` với 21 tool VẪN là cửa trước trên Zalo. Lớp này chỉ được gọi
 * qua tool, khi model thấy tin nhắn thuộc về hành trình lên kế hoạch.
 *
 * Lệch §4.1 ("backend không cần phân loại intent") đúng một nấc, có chủ đích.
 * Cái giá phải trả nếu làm đúng chữ: Outcome Agent thành cửa vào duy nhất, mất
 * sạch 21 tool trên Zalo — và vì Mini App chỉ đọc DB, mà DB chỉ được ghi bởi
 * chính 21 tool đó, Mini App sẽ không còn gì để hiển thị. Tách hai bề mặt xong
 * thì bề mặt kia chết đói.
 *
 * Nên: Zalo dùng v4 cho hành trình lên kế hoạch, Mini App giữ nguyên `ChatAgent`
 * với card và nút bấm. Mỗi bề mặt dùng thứ nó làm được tốt nhất.
 */
@Injectable()
export class OutcomeService {
  private readonly log = new Logger(OutcomeService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly zalo: ZaloClient,
    private readonly driver: ManagedAgentDriver,
    private readonly conversations: ConversationService
  ) {}

  /* ================================================================ */
  /* Vòng đời hành trình                                              */
  /* ================================================================ */

  /**
   * Hành trình đang mở của hội thoại, nếu có.
   *
   * Lọc theo `stage = 'O'` để không đụng vào run của hệ v7 — hai kiến trúc
   * dùng chung bảng nhưng không được nhìn thấy nhau.
   */
  async findActive(conversationId: number): Promise<Run | null> {
    const [row] = await this.db
      .select()
      .from(pipelineRuns)
      .where(
        and(
          eq(pipelineRuns.conversationId, conversationId),
          eq(pipelineRuns.stage, OUTCOME_STAGE),
          notInArray(pipelineRuns.status, TERMINAL_STATUSES as unknown as string[])
        )
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Lấy hành trình đang mở, chưa có thì tạo.
   *
   * Partial unique index `pipeline_runs_one_active_uq` bảo đảm mỗi hội thoại
   * chỉ một hành trình — đúng yêu cầu §9 "chỉ một active run trên mỗi
   * conversation", và ép bởi DB nên không phụ thuộc vào backend nhớ kiểm.
   */
  async ensureRun(input: {
    conversationId: number;
    zaloChatId: string;
    actorId: string;
    actorName: string;
  }): Promise<Run> {
    const existing = await this.findActive(input.conversationId);
    if (existing) return existing;

    try {
      const [row] = await this.db
        .insert(pipelineRuns)
        .values({
          conversationId: input.conversationId,
          zaloChatId: input.zaloChatId,
          ownerZaloId: input.actorId,
          ownerName: input.actorName,
          stage: OUTCOME_STAGE,
          status: "awaiting_user",
          traceId: randomUUID(),
          thinState: {},
          expiresAt: new Date(Date.now() + RUN_TTL_MS)
        })
        .returning();
      this.log.log(`Mở hành trình v4 run#${row.id} · hội thoại ${input.conversationId}`);
      return row;
    } catch (err) {
      // Hai người cùng nhờ lên kế hoạch một lúc → index chặn, đọc lại của người kia
      if ((err as { code?: string })?.code !== "23505") throw err;
      const again = await this.findActive(input.conversationId);
      if (!again) throw err;
      return again;
    }
  }

  /** Đóng hành trình. Session bên Anthropic dọn luôn cho khỏi thành rác. */
  async close(runId: number, status: "done" | "cancelled" | "failed" = "cancelled"): Promise<void> {
    const run = await this.load(runId);
    if (!run) return;
    await this.save(runId, { status });
    void this.driver.deleteSessions((run.agentSessions ?? {}) as Record<string, string>);
    this.log.log(`run#${runId} → ${status}`);
  }

  /* ================================================================ */
  /* Một lượt — chuyển tiếp text hai chiều                            */
  /* ================================================================ */

  async turn(job: OutcomeTurnJob): Promise<void> {
    if (!outcomeEnabled()) {
      this.log.warn(`Bỏ lượt run#${job.runId}: ZINO_OUTCOME_ENABLED chưa bật`);
      return;
    }

    const run = await this.load(job.runId);
    if (!run) return;
    if ((TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
      this.log.debug(`run#${run.id} đã ${run.status}, bỏ lượt`);
      return;
    }

    const tag = `[${run.traceId.slice(0, 8)}]`;
    void this.zalo.sendTyping(run.zaloChatId);

    const sessions = (run.agentSessions ?? {}) as Record<string, string>;
    const existingSessionId = sessions[OUTCOME_SESSION_KEY] ?? null;

    try {
      /**
       * Gửi NGUYÊN VĂN text của user — §4.1.
       *
       * Không bọc `thin_state`, không kèm metadata, không tóm tắt lại. Lịch sử
       * hội thoại trong session chính là working memory duy nhất của v4 (§5),
       * nên bọc thêm chỉ làm nhiễu và tốn token.
       *
       * `existingSessionId` là mấu chốt: "Chọn 2" phải vào đúng session đã hiển
       * thị hai lựa chọn đó. Mất session thì agent không đoán — nó hỏi lại tên
       * phương án (§5).
       */
      const { raw, sessionId, elapsedMs } = await this.driver.runAgent({
        agentId: outcomeAgentId(),
        payload: job.userMessage,
        timeoutMs: OUTCOME_TIMEOUT_MS,
        traceId: run.traceId,
        label: "OUTCOME",
        existingSessionId
      });

      const reply = assertNonEmptyReply(raw);

      if (sessions[OUTCOME_SESSION_KEY] !== sessionId) {
        await this.save(run.id, {
          agentSessions: { ...sessions, [OUTCOME_SESSION_KEY]: sessionId }
        });
      }
      await this.save(run.id, { status: "awaiting_user" });

      this.log.log(
        `${tag} OUTCOME ${(elapsedMs / 1000).toFixed(1)}s · ${reply.length} ký tự` +
          `${existingSessionId ? "" : " · session mới"}`
      );

      await this.say(run, reply);
    } catch (err) {
      await this.handleFailure(run, tag, err);
    }
  }

  /* ================================================================ */

  /**
   * §10 — chỉ xử lý lỗi hạ tầng, không diễn giải lỗi nghiệp vụ.
   *
   * Giữ nguyên session và cho user thử lại; KHÔNG âm thầm tạo journey mới, vì
   * làm vậy là mất toàn bộ lịch sử quyết định mà chính nó là bộ nhớ của v4.
   */
  private async handleFailure(run: Run, tag: string, err: unknown): Promise<void> {
    if (err instanceof StageTimeoutError) {
      // Session vẫn chạy tiếp phía Anthropic — gọi lại là hai lượt song song
      this.log.error(`${tag} timeout: ${err.message}`);
      await this.say(run, OUTCOME_FALLBACK_MESSAGE);
      await this.save(run.id, { status: "awaiting_user" });
      return;
    }

    const message = (err as Error)?.message ?? String(err);
    // 404 nghĩa là agent id sai hoặc agent nằm ở workspace khác với API key —
    // đã dính đúng lỗi này đợt v7, mất một lúc mới tìm ra. Nói thẳng trong log.
    if (/\b404\b/.test(message)) {
      this.log.error(
        `${tag} Agent API 404 — kiểm ZINO_AGENT_OUTCOME_ID và xem agent có cùng workspace với ZINO_AGENT_API_KEY không`
      );
      await this.say(run, OUTCOME_FALLBACK_MESSAGE);
      await this.save(run.id, { status: "awaiting_user" });
      return;
    }

    throw err; // lỗi mạng thoáng qua → JobsService retry với backoff
  }

  /**
   * Gửi nguyên văn, chỉ cắt cho vừa 2000 ký tự — §4.2 yêu cầu hiển thị nguyên
   * văn, chỉ áp escaping bắt buộc của transport.
   *
   * Dùng `sendRaw` chứ KHÔNG `sendMarkdown`: `render.ts` dịch markdown sang ký
   * tự Unicode, mà output v4 đã là plain text có sẵn `✓ → ○` và URL. Cho nó đi
   * qua bộ render là hỏng định dạng agent đã dựng.
   */
  private async say(run: Run, message: string): Promise<void> {
    const parts = chunkMessage(message);
    for (const [i, part] of parts.entries()) {
      await this.zalo.sendRaw(run.zaloChatId, part);
      /**
       * BẮT BUỘC ghi lại tin của bot. Không ghi thì `AgentService.buildHistory`
       * coi mọi tin sau đó là một loạt chưa được trả lời — kết thúc hành trình
       * là nó nuốt một lúc hai chục tin rồi trả lời gộp.
       */
      await this.conversations.recordOutbound(run.conversationId, part);
      if (i < parts.length - 1) await sleep(350);
    }
  }

  private async load(runId: number): Promise<Run | null> {
    const [row] = await this.db
      .select()
      .from(pipelineRuns)
      .where(eq(pipelineRuns.id, runId))
      .limit(1);
    return row ?? null;
  }

  private async save(
    runId: number,
    patch: Partial<typeof pipelineRuns.$inferInsert>
  ): Promise<void> {
    await this.db
      .update(pipelineRuns)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(pipelineRuns.id, runId));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, notInArray } from "drizzle-orm";
import { DB, type Database } from "../db/database.module";
import { pipelineRuns } from "../db/schema";
import { chunkMessage } from "../zalo/render";
import { ConversationService } from "../zalo/conversation.service";
import { ZaloClient } from "../zalo/zalo.client";
import { ManagedAgentDriver, StageTimeoutError } from "./managed-agent.driver";
import { V7ContextService } from "./v7.context";
import { RUN_TTL_MS, TERMINAL_STATUSES, type RunStatus } from "./pipeline.types";
import { applyStatePatch, type JsonObject } from "./state-patch";
import {
  parseAgentJson,
  SAFE_FALLBACK_MESSAGE,
  V7ValidationError,
  V7_AGENT_LABEL,
  V7_TIMEOUT_MS,
  looksLikeResearchTrigger,
  v7AgentId,
  validateBrain,
  validateFinalizer,
  validateIntake,
  type V7Agent
} from "./v7.types";

type Run = typeof pipelineRuns.$inferSelect;

export interface V7TurnJob {
  runId: number;
  userMessage: string;
  actorId?: string;
  actorName?: string;
}

/**
 * Orchestrator Agent System v7.1.
 *
 * Toàn bộ trách nhiệm của lớp này (v7 §3.1):
 *   cấp ngữ cảnh · gọi agent · parse JSON · áp state patch · kiểm invariant ·
 *   gửi `message_to_user` NGUYÊN VĂN.
 *
 * Và những gì nó cố tình KHÔNG làm:
 *   hiểu ý định · viết chữ cho user · dựng section/card · tự quyết follow-up
 *   nào còn trong phạm vi · tự nhận ra `BẮT ĐẦU RESEARCH`.
 *
 * Điểm khác căn bản so với pipeline v2: đây KHÔNG phải chuỗi cố định. Phần lớn
 * tin nhắn dừng ngay ở Intake và không bao giờ chạm Brain — đó mới là chỗ tiết
 * kiệm, vì Brain là thứ đắt và chậm nhất hệ thống.
 */
@Injectable()
export class V7Service {
  private readonly log = new Logger(V7Service.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly zalo: ZaloClient,
    private readonly driver: ManagedAgentDriver,
    private readonly context: V7ContextService,
    private readonly conversations: ConversationService
  ) {}

  /* ================================================================ */

  async findActive(conversationId: number): Promise<Run | null> {
    const [row] = await this.db
      .select()
      .from(pipelineRuns)
      .where(
        and(
          eq(pipelineRuns.conversationId, conversationId),
          notInArray(pipelineRuns.status, TERMINAL_STATUSES as unknown as string[])
        )
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * Lấy run đang chạy, chưa có thì tạo.
   *
   * v7 không có khái niệm "owner" (§0 khai tử), nhưng cột `owner_zalo_id` là
   * NOT NULL từ thời v2 — ghi người mở flow vào đó để giữ nguyên schema, và
   * KHÔNG dùng nó để chặn ai cả.
   */
  async ensureRun(input: {
    conversationId: number;
    zaloChatId: string;
    actorId: string;
    actorName: string;
  }): Promise<Run> {
    const existing = await this.findActive(input.conversationId);
    if (existing) return existing;

    const [row] = await this.db
      .insert(pipelineRuns)
      .values({
        conversationId: input.conversationId,
        zaloChatId: input.zaloChatId,
        ownerZaloId: input.actorId,
        ownerName: input.actorName,
        stage: "A",
        status: "awaiting_user",
        traceId: randomUUID(),
        thinState: {},
        expiresAt: new Date(Date.now() + RUN_TTL_MS)
      })
      .returning();
    this.log.log(`Mở flow v7 run#${row.id} cho hội thoại ${input.conversationId}`);
    return row;
  }

  /**
   * Kết liễu một run hỏng — worker gọi khi job đã hết lượt retry.
   *
   * KHÔNG có bước này thì run kẹt ở trạng thái non-terminal, `findActive` vẫn
   * trả về nó, và webhook tiếp tục route MỌI tin nhắn vào v7 — nhóm đó mất
   * luôn cả 19 tool của AgentService cho tới khi TTL 24h quét. Đây là hệ quả
   * tệ hơn nhiều so với việc tính năng mới không chạy.
   */
  async abandon(runId: number, status: RunStatus = "failed"): Promise<string | null> {
    const run = await this.load(runId);
    if (!run) return null;
    await this.save(runId, { status });
    void this.driver.deleteSessions((run.agentSessions ?? {}) as Record<string, string>);
    this.log.warn(`run#${runId} → ${status}, đóng flow để nhóm dùng lại được bot`);
    return run.zaloChatId;
  }

  /* ================================================================ */
  /* Một lượt — v7 §3.2                                               */
  /* ================================================================ */

  async turn(job: V7TurnJob): Promise<void> {
    const run = await this.load(job.runId);
    if (!run) return;
    if ((TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
      this.log.debug(`run#${run.id} đã ${run.status}, bỏ lượt`);
      return;
    }

    const tag = `[${run.traceId.slice(0, 8)}]`;
    void this.zalo.sendTyping(run.zaloChatId);

    try {
      /* ---------- 1. Intake — MỌI tin nhắn đều đi qua đây (§2.2) ---------- */
      /**
       * Bơm ngữ cảnh DB vào `thin_state` dưới khoá `zino_context`.
       *
       * Doc v7 §5 cố ý giữ thin_state rất mỏng, nhưng chạy đúng vậy thì agent
       * quên sạch những gì Zino đã học về nhóm (L3), không biết nhóm đang có
       * chuyến nào (L2), và không thấy mạng lưới OA đối tác. Ba thứ đó mới là
       * phần khác biệt của sản phẩm này.
       *
       * Đây là dữ liệu DẪN XUẤT — dựng lại mỗi lượt, không lưu ngược vào DB.
       */
      const zinoContext = await this.context.build(run.conversationId);
      const stateForAgent = {
        ...((run.thinState ?? {}) as JsonObject),
        zino_context: zinoContext
      };

      const intake = validateIntake(
        await this.call(run, "INTAKE", {
          user_message: job.userMessage,
          reference_time: new Date().toISOString(),
          actor: {
            id: job.actorId ?? null,
            name: job.actorName ?? null,
            role: null // §6.7: owner không bao giờ là blocker
          },
          thin_state: stateForAgent
        })
      );

      let state = this.context.stripDerived(
        applyStatePatch(run.thinState as JsonObject, intake.state_patch)
      );
      await this.save(run.id, { thinState: state });

      this.log.log(
        `${tag} INTAKE → ${intake.status} · target=${intake.route.target}` +
          (looksLikeResearchTrigger(job.userMessage) ? " · (user gõ đúng trigger)" : "")
      );

      /* ---------- 2. Nhánh deliver: Intake tự trả lời, dừng ---------- */
      if (intake.route.target === "deliver") {
        await this.say(run, intake.message_to_user);
        // Brief chốt dần qua từng lượt hỏi đáp → lưu sớm để Mini App thấy
        // chuyến đi ngay khi đủ điểm đến + ngày, không phải đợi research xong.
        await this.context.persistTurn({
          conversationId: run.conversationId,
          zaloChatId: run.zaloChatId,
          thinState: state
        });
        await this.save(run.id, { status: mapIntakeStatus(intake.status) });
        if (isTerminal(intake.status)) await this.cleanup(run.id);
        return;
      }

      /* ---------- 3. Brain ---------- */
      // Cổng vào Brain đã được validateIntake kiểm đủ 5 điều kiện (§6.9),
      // nên tới đây là chắc chắn hợp lệ. Brain còn tự kiểm lại lần nữa (§7.4).
      await this.save(run.id, { status: "running_b", stage: "B" });
      const fresh = await this.load(run.id);

      /**
       * Brain có thể chạy vài phút, và §6.9 buộc `message_to_user === null` ở
       * nhánh này — nghĩa là user không nhận được gì suốt thời gian đó. Giữ
       * nhịp "đang soạn tin" để nhóm biết bot còn sống.
       *
       * Đây không phải "viết chữ cho user" nên không phạm §3.1.
       */
      const typing = setInterval(() => void this.zalo.sendTyping(run.zaloChatId), 8_000);
      let brain;
      try {
      brain = validateBrain(
        await this.call(fresh ?? run, "BRAIN", {
          intake_result: intake,
          // Brain cần partner_network và ký ức nhóm không kém gì Intake
          thin_state: { ...(((fresh?.thinState ?? state) as JsonObject) ?? {}), zino_context: zinoContext }
        })
      );
      } finally {
        clearInterval(typing);
      }
      state = this.context.stripDerived(
        applyStatePatch(((fresh?.thinState as JsonObject) ?? state), brain.state_patch)
      );
      await this.save(run.id, { thinState: state });
      this.log.log(`${tag} BRAIN → ${brain.status} · ${brain.response_kind ?? "?"}`);

      /* ---------- 4. Finalizer ---------- */
      await this.save(run.id, { status: "running_c", stage: "C" });
      // Phải nạp lại: `run` là ảnh chụp từ đầu lượt, agentSessions trong đó
      // vẫn rỗng → truyền vào là ghi đè mất session id của Intake và Brain.
      const afterBrain = await this.load(run.id);
      const final = validateFinalizer(
        await this.call(afterBrain ?? run, "FINALIZER", { brain_result: brain })
      );
      state = this.context.stripDerived(applyStatePatch(state, final.state_patch));

      /**
       * §5 đặt reply contract NGAY TRONG thin state (`last_reply_contract`).
       * Thiếu nó thì lượt sau Intake không hiểu "chọn 2" ứng với option nào —
       * nó chỉ còn cách đoán theo thứ tự transcript, đúng thứ §9.8 cấm.
       */
      state = { ...state, last_reply_contract: (final.reply_contract ?? null) as never };

      const blocked = final.status === "blocked";
      await this.save(run.id, {
        thinState: state,
        replyContract: final.reply_contract as never,
        status: blocked ? "blocked" : "awaiting_user",
        stage: "D"
      });
      if (blocked) await this.cleanup(run.id);

      await this.say(run, final.message_to_user);
      this.log.log(`${tag} FINALIZER → ${final.status}`);

      /**
       * Ghi xuống dữ liệu nghiệp vụ SAU KHI đã gửi tin.
       *
       * Thứ tự quan trọng: user nhận câu trả lời trước, việc lưu là đường phụ.
       * Không có bước này thì Mini App trống trơn sau mỗi lượt research —
       * doc v7 không nhắc tới Mini App lần nào.
       */
      await this.context.persistTurn({
        conversationId: run.conversationId,
        zaloChatId: run.zaloChatId,
        thinState: state,
        decisionSummary: brain.decision_summary ?? null
      });
    } catch (err) {
      await this.handleFailure(run, tag, err);
    }
  }

  /* ================================================================ */

  /**
   * §10.4 — output hỏng thì báo ngắn và DỪNG.
   *
   * Cấm hai thứ: lộ chi tiết prompt/tool ra ngoài, và âm thầm chuyển sang agent
   * khác để "chữa cháy". Cả hai đều khiến lỗi trở nên khó truy hơn.
   */
  private async handleFailure(run: Run, tag: string, err: unknown): Promise<void> {
    if (err instanceof V7ValidationError) {
      this.log.error(`${tag} ${V7_AGENT_LABEL[err.agent]}: ${err.reason}`);
      this.log.debug(`${tag} raw: ${JSON.stringify(err.raw).slice(0, 1000)}`);
      await this.say(run, SAFE_FALLBACK_MESSAGE);
      await this.save(run.id, { status: "awaiting_user" }); // flow còn sống, user gửi lại được
      return;
    }

    if (err instanceof StageTimeoutError) {
      // Session vẫn chạy tiếp phía Anthropic → gọi lại là hai lượt song song.
      this.log.error(`${tag} timeout: ${err.message}`);
      await this.say(
        run,
        "Mình tìm lâu quá mà chưa xong 😅 Bạn thử nhờ lại, hoặc thu hẹp yêu cầu giúp mình nhé."
      );
      await this.save(run.id, { status: "awaiting_user" });
      return;
    }

    throw err; // lỗi mạng thoáng qua → JobsService retry
  }

  private async call(run: Run, agent: V7Agent, payload: unknown): Promise<Record<string, unknown>> {
    const agentId = v7AgentId(agent);
    if (!agentId) throw new Error(`Thiếu ZINO_AGENT_${agent}_ID`);

    const sessions = (run.agentSessions ?? {}) as Record<string, string>;
    /**
     * INTAKE và FINALIZER tái dùng session: model rẻ, ngữ cảnh ngắn, tiết kiệm
     * được ~4s dựng sandbox mỗi lượt.
     *
     * BRAIN thì LUÔN tạo session mới: nó là model nặng nhất, mỗi lượt research
     * là một việc độc lập, và ngữ cảnh đã nằm trong `thin_state` truyền vào.
     * Tái dùng chỉ làm context phình lên qua từng lượt — 4s tiết kiệm được
     * không đáng so với rủi ro đó.
     */
    const reuse = agent === "BRAIN" ? null : (sessions[agent] ?? null);

    const { raw, sessionId, elapsedMs } = await this.driver.runAgent({
      agentId,
      payload,
      timeoutMs: V7_TIMEOUT_MS[agent],
      traceId: run.traceId,
      label: agent,
      existingSessionId: reuse
    });

    this.log.debug(
      `[${run.traceId.slice(0, 8)}] ${agent} ${(elapsedMs / 1000).toFixed(1)}s · ${raw.length} ký tự`
    );

    if (sessions[agent] !== sessionId) {
      await this.save(run.id, { agentSessions: { ...sessions, [agent]: sessionId } });
    }
    return parseAgentJson(agent, raw);
  }

  /** Gửi nguyên văn, chỉ cắt cho vừa 2000 ký tự. Không render markdown (§3.1). */
  private async say(run: Run, message: string | null | undefined): Promise<void> {
    if (!message?.trim()) return;
    const parts = chunkMessage(message);
    for (const [i, part] of parts.entries()) {
      await this.zalo.sendRaw(run.zaloChatId, part);
      /**
       * BẮT BUỘC ghi lại tin của bot.
       *
       * Không ghi thì bảng `messages` chỉ có phía user trong suốt flow, và
       * `AgentService.buildHistory` coi mọi tin sau câu trả lời cuối là MỘT
       * loạt chưa được trả lời — kết thúc flow là nó nuốt một lúc 20 tin rồi
       * trả lời gộp. Job reflection cũng dựng ký ức L3 từ transcript một chiều.
       */
      await this.conversations.recordOutbound(run.conversationId, part);
      if (i < parts.length - 1) await sleep(350);
    }
  }

  private async cleanup(runId: number): Promise<void> {
    const run = await this.load(runId);
    if (run) void this.driver.deleteSessions((run.agentSessions ?? {}) as Record<string, string>);
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

/* ------------------------------------------------------------------ */

/** Status của Intake → status của run. Chỉ hai giá trị là kết thúc flow. */
function mapIntakeStatus(status: string): RunStatus {
  if (status === "cancelled") return "cancelled";
  if (status === "blocked") return "blocked";
  return "awaiting_user";
}

function isTerminal(status: string): boolean {
  return status === "cancelled" || status === "blocked";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

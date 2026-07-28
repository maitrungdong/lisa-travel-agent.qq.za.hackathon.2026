import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, lt, notInArray } from "drizzle-orm";
import { DB, type Database } from "../db/database.module";
import { conversations, pipelineRuns } from "../db/schema";
import { JobsService } from "../jobs/jobs.service";
import { chunkMessage } from "../zalo/render";
import { ZaloClient } from "../zalo/zalo.client";
import { ManagedAgentDriver, StageTimeoutError } from "./managed-agent.driver";
import {
  RUN_TTL_MS,
  STAGE_NAME,
  StageOutputError,
  TERMINAL_STATUSES,
  envInt,
  type RunStatus,
  type StageId
} from "./pipeline.types";

type Run = typeof pipelineRuns.$inferSelect;

/** Payload của job `pipeline_step`. */
export interface StepJob {
  runId: number;
  stage: StageId;
  /** Lượt A đầu tiên, hoặc câu trả lời của user cho lượt A tiếp theo */
  userMessage?: string;
  /** Ai vừa nhắn (dùng cho `actor` trong payload A) */
  actorId?: string;
  actorName?: string;
  /** Chỉ có ở stage D */
  candidateId?: string;
  /** Lượt gọi lại B sau `needs_source_data` — gửi lời nhắc, không gửi lại payload cũ */
  retry?: boolean;
}

/**
 * State machine của pipeline 4 agent.
 *
 * NGUYÊN TẮC ĐIỀU PHỐI (theo 4-ai-agents.md): không agent nào gọi agent khác.
 * Toàn bộ "trí thông minh" của lớp này chỉ là đọc `status` rồi quyết định
 * dừng hay đẩy stage kế vào hàng đợi.
 *
 * MỖI STAGE MỘT JOB, không phải một vòng lặp dài. Đổi lại bốn thứ:
 *  • retry/backoff của JobsService hoạt động ở mức từng stage
 *  • stream SSE chỉ mở ~20s mỗi lần thay vì giữ suốt cả pipeline
 *  • dedupeKey = chatId → pipeline và AgentService không bao giờ giẫm chân nhau
 *  • hai điểm chờ người trở thành trạng thái nghỉ thật, không job nào treo
 */
@Injectable()
export class PipelineService {
  private readonly log = new Logger(PipelineService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jobs: JobsService,
    private readonly zalo: ZaloClient,
    private readonly driver: ManagedAgentDriver
  ) {}

  /* ================================================================== */
  /* Truy vấn — webhook dùng để định tuyến                              */
  /* ================================================================== */

  /** Run chưa kết thúc của hội thoại. Mỗi hội thoại tối đa một cái (unique index). */
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
   * Tạo run mới. Trả null nếu nhóm đã có run đang chạy — unique partial index
   * `pipeline_runs_one_active_uq` là chốt chặn, không phải câu if ở tầng ứng dụng.
   */
  async createRun(input: {
    conversationId: number;
    zaloChatId: string;
    ownerZaloId: string;
    ownerName: string;
  }): Promise<{ runId: number; traceId: string } | null> {
    const traceId = randomUUID();
    try {
      const [row] = await this.db
        .insert(pipelineRuns)
        .values({
          conversationId: input.conversationId,
          zaloChatId: input.zaloChatId,
          ownerZaloId: input.ownerZaloId,
          ownerName: input.ownerName,
          stage: "A",
          status: "running_a",
          traceId,
          expiresAt: new Date(Date.now() + RUN_TTL_MS)
        })
        .returning({ id: pipelineRuns.id });
      return { runId: row.id, traceId };
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  async cancelRun(runId: number, reason: RunStatus = "cancelled"): Promise<void> {
    await this.finish(runId, reason);
  }

  /** Dọn run bị bỏ quên, để nhóm mở được run mới. Worker gọi định kỳ. */
  async expireStale(): Promise<number> {
    const rows = await this.db
      .update(pipelineRuns)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          lt(pipelineRuns.expiresAt, new Date()),
          notInArray(pipelineRuns.status, TERMINAL_STATUSES as unknown as string[])
        )
      )
      .returning({ id: pipelineRuns.id });
    if (rows.length) this.log.warn(`Hết hạn ${rows.length} run bị bỏ quên`);
    return rows.length;
  }

  /* ================================================================== */
  /* Worker entry                                                        */
  /* ================================================================== */

  async step(job: StepJob): Promise<void> {
    const run = await this.load(job.runId);
    if (!run) return;

    if ((TERMINAL_STATUSES as readonly string[]).includes(run.status)) {
      this.log.debug(`run#${run.id} đã ${run.status}, bỏ qua stage ${job.stage}`);
      return;
    }

    // Che khoảng lặng — B có thể chạy hàng chục giây
    void this.zalo.sendTyping(run.zaloChatId);

    const label = `[${run.traceId.slice(0, 8)}] ${job.stage} ${STAGE_NAME[job.stage]}`;
    try {
      switch (job.stage) {
        case "A":
          return await this.stepA(run, job, label);
        case "B":
          return await this.stepB(run, job, label);
        case "C":
          return await this.stepC(run, label);
        case "D":
          return await this.stepD(run, job, label);
      }
    } catch (err) {
      // Output hỏng cả sau lượt sửa → coi như stage bó tay, không retry vô ích
      if (err instanceof StageOutputError) {
        this.log.error(`${label} bó tay: ${err.reason}`);
        await this.say(run, "Mình gặp trục trặc khi lên kế hoạch 😢 Bạn thử nhờ lại nhé.");
        await this.finish(run.id, "failed");
        return;
      }

      /**
       * Timeout KHÔNG retry.
       *
       * Session vẫn chạy tiếp trên hạ tầng Anthropic sau khi ta bỏ cuộc, nên
       * gọi lại là hai lượt song song cùng một việc — tốn tiền gấp đôi và lượt
       * sau ghi đè state của lượt trước. Thà dừng sạch và nói thật với user.
       */
      if (err instanceof StageTimeoutError) {
        this.log.error(`${label} timeout: ${err.message}`);
        await this.say(
          run,
          "Mình dò lâu quá mà chưa xong 😅 Bạn thử nhờ lại, hoặc cho mình gợi ý cụ thể hơn nhé."
        );
        await this.finish(run.id, "failed");
        return;
      }

      throw err; // lỗi mạng thoáng qua → để JobsService retry
    }
  }

  /* ------------------------------ A ------------------------------ */

  private async stepA(run: Run, job: StepJob, label: string): Promise<void> {
    const payload = {
      mode: await this.chatMode(run),
      trigger: "bot_mention",
      trace_id: run.traceId,
      actor: {
        id: job.actorId ?? run.ownerZaloId,
        name: job.actorName ?? run.ownerName ?? "",
        role: (job.actorId ?? run.ownerZaloId) === run.ownerZaloId ? "owner" : "member"
      },
      roles: { owner: run.ownerZaloId, payer: null, members: [run.ownerZaloId] },
      user_message: job.userMessage ?? "",
      answers: [],
      /**
       * Session Managed Agents đã giữ hộ lịch sử, nên đây chỉ là bản sao dự
       * phòng cho trường hợp phải tạo session mới.
       */
      current_state: run.alignmentResult ?? {},
      /**
       * Vá lỗ hổng vòng B → A: câu hỏi do B đặt ra nhưng user trả lời cho A.
       * Thiếu field này thì A nhận câu trả lời mà không biết đang trả lời gì.
       */
      pending_question: run.pendingQuestion ?? null
    };

    const { output, sessionId } = await this.call(run, "A", payload, label);
    await this.save(run.id, {
      alignmentResult: output,
      agentSessions: { ...(run.agentSessions as object), A: sessionId },
      pendingQuestion: null
    });
    await this.say(run, output.message_to_user);

    switch (output.status) {
      case "ready_for_scout":
        await this.advance(run, "B", "running_b");
        break;
      case "needs_user_input":
        await this.save(run.id, { status: "awaiting_user" });
        break;
      default:
        await this.finish(run.id, "blocked");
    }
  }

  /* ------------------------------ B ------------------------------ */

  private async stepB(run: Run, job: StepJob, label: string): Promise<void> {
    /**
     * Lượt retry KHÔNG gửi lại payload cũ.
     *
     * Đã kiểm bằng spike thật: với `source_inputs: []`, B trả `needs_source_data`
     * kèm `unfilled_slots` và `next_best_action` — nó chờ runtime đưa dữ liệu vào.
     * Gửi lại đúng payload đó thì B trả lời y hệt, retry thành vô nghĩa.
     *
     * Backend Zino không có scraper, nhưng agent thì CÓ: nó gắn sẵn MCP server
     * của Booking.com và web_search. Nên lượt hai là một lời nhắc dùng chính
     * công cụ của nó, gửi vào cùng session (ngữ cảnh còn nguyên, khỏi gửi lại
     * alignment_result).
     */
    const payload = job.retry
      ? buildScoutNudge(run.sourcingResult)
      : {
          alignment_result: run.alignmentResult,
          trace_id: run.traceId,
          reference_date: today(),
          source_inputs: [],
          parsed_offers: []
        };

    const { output, sessionId } = await this.call(run, "B", payload, label);
    await this.save(run.id, {
      sourcingResult: output,
      agentSessions: { ...(run.agentSessions as object), B: sessionId }
    });
    await this.say(run, output.message_to_user);

    switch (output.status) {
      case "ready_for_composer":
        await this.advance(run, "C", "running_c");
        break;

      case "needs_source_data":
        // backend.md: gọi lại B TỐI ĐA MỘT LẦN. Không có trần này thì B thiếu
        // dữ liệu sẽ quay vòng mãi và đốt session-hour.
        if (run.scoutRetries < 1) {
          await this.save(run.id, { scoutRetries: run.scoutRetries + 1 });
          await this.enqueue(run, "B", { retry: true });
        } else {
          this.log.warn(`${label} vẫn thiếu source sau 1 lần thử lại`);
          await this.finish(run.id, "blocked");
        }
        break;

      case "needs_user_input":
        // Câu trả lời sẽ đi về A, nên phải mang theo câu hỏi của B
        await this.save(run.id, {
          status: "awaiting_user",
          stage: "A",
          pendingQuestion: { from: "B", message: output.message_to_user, raw: output.questions ?? null }
        });
        break;

      default:
        await this.finish(run.id, "blocked");
    }
  }

  /* ------------------------------ C ------------------------------ */

  private async stepC(run: Run, label: string): Promise<void> {
    const payload = {
      alignment_result: run.alignmentResult,
      sourcing_result: run.sourcingResult,
      trace_id: run.traceId,
      /**
       * Backend chưa có dịch vụ bản đồ. Để rỗng nghĩa là C phải tự ước lượng
       * thời gian di chuyển — và phải nói rõ điều đó trong simulation_disclosure.
       */
      geo_matrix: {},
      n_variants: envInt("ZINO_N_VARIANTS", 3)
    };

    const { output, sessionId } = await this.call(run, "C", payload, label);
    await this.save(run.id, {
      planningResult: output,
      agentSessions: { ...(run.agentSessions as object), C: sessionId }
    });
    await this.say(run, output.message_to_user);

    if (output.status === "options_ready") {
      await this.save(run.id, { status: "awaiting_selection", stage: "D" });
    } else {
      await this.finish(run.id, "blocked");
    }
  }

  /* ------------------------------ D ------------------------------ */

  private async stepD(run: Run, job: StepJob, label: string): Promise<void> {
    const payload = {
      reference_time: new Date().toISOString(),
      mode: await this.chatMode(run),
      trace_id: run.traceId,
      selection: {
        candidate_id: job.candidateId ?? run.selectedCandidateId,
        selected_by: run.ownerZaloId,
        selected_by_role: "owner"
      },
      sourcing_result: run.sourcingResult,
      planning_result: run.planningResult,
      policy: buildPolicy(run.ownerZaloId)
    };

    const { output, sessionId } = await this.call(run, "D", payload, label);
    await this.save(run.id, {
      packageResult: output,
      selectedCandidateId: job.candidateId ?? run.selectedCandidateId,
      agentSessions: { ...(run.agentSessions as object), D: sessionId }
    });
    await this.say(run, output.message_to_user);

    switch (output.status) {
      case "package_ready":
        await this.finish(run.id, "done");
        break;
      case "needs_owner_confirm":
        // Vẫn chờ owner — tin nhắn tiếp theo của owner sẽ kích hoạt lại D
        await this.save(run.id, { status: "awaiting_selection" });
        break;
      default:
        await this.finish(run.id, "blocked");
    }
  }

  /* ================================================================== */
  /* Hạ tầng dùng chung                                                  */
  /* ================================================================== */

  private async call(run: Run, stage: StageId, payload: unknown, label: string) {
    const sessions = (run.agentSessions ?? {}) as Record<string, string>;
    const res = await this.driver.runStage(stage, payload, {
      existingSessionId: sessions[stage] ?? null,
      traceId: run.traceId
    });
    this.log.log(
      `${label} → ${res.output.status} · ${(res.elapsedMs / 1000).toFixed(1)}s` +
        (res.repaired ? " · ĐÃ PHẢI SỬA JSON" : "")
    );
    return res;
  }

  /**
   * Gửi nguyên `message_to_user`, chỉ cắt cho vừa 2000 ký tự.
   *
   * KHÔNG render markdown, KHÔNG ghép thêm câu dẫn — theo đúng backend.md:
   * "Backend không ghép câu dẫn, câu hỏi, phương án hoặc action card thành text."
   */
  private async say(run: Run, message: string | null | undefined): Promise<void> {
    if (!message?.trim()) return;
    const parts = chunkMessage(message);
    for (const [i, part] of parts.entries()) {
      await this.zalo.sendRaw(run.zaloChatId, part);
      if (i < parts.length - 1) await sleep(350);
    }
  }

  private async advance(run: Run, next: StageId, status: RunStatus): Promise<void> {
    await this.save(run.id, { stage: next, status });
    await this.enqueue(run, next);
  }

  private async enqueue(run: Run, stage: StageId, extra: Partial<StepJob> = {}): Promise<void> {
    await this.jobs.enqueue(
      "pipeline_step",
      { runId: run.id, stage, ...extra } satisfies StepJob,
      // Cùng khoá với agent_turn → không bao giờ chạy song song trong một nhóm
      { dedupeKey: run.zaloChatId }
    );
  }

  private async finish(runId: number, status: RunStatus): Promise<void> {
    const run = await this.load(runId);
    await this.save(runId, { status });
    if (run) {
      void this.driver.deleteSessions((run.agentSessions ?? {}) as Record<string, string>);
    }
  }

  private async load(runId: number): Promise<Run | null> {
    const [row] = await this.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId)).limit(1);
    return row ?? null;
  }

  private async save(runId: number, patch: Partial<typeof pipelineRuns.$inferInsert>): Promise<void> {
    await this.db
      .update(pipelineRuns)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(pipelineRuns.id, runId));
  }

  private async chatMode(run: Run): Promise<string> {
    const [conv] = await this.db
      .select({ chatType: conversations.chatType })
      .from(conversations)
      .where(eq(conversations.id, run.conversationId))
      .limit(1);
    return conv?.chatType === "group" ? "group" : "direct";
  }
}

/* -------------------------------------------------------------------- */

/**
 * Policy cho D.
 *
 * Spec gốc dùng số 0 cho `max_money_at_risk` / `per_action_cap`, mơ hồ giữa
 * "không được rủi ro đồng nào" và "không giới hạn" — mơ hồ ở tham số an toàn
 * tiền bạc là loại bug tệ nhất. Ở đây dùng `null` cho "không giới hạn" và
 * thêm `dry_run` tường minh: hackathon thì luôn bật, agent không được tự
 * thực thi bất cứ hành động nào tốn tiền.
 */
function buildPolicy(ownerId: string) {
  const cap = process.env.ZINO_PER_ACTION_CAP;
  return {
    dry_run: process.env.ZINO_POLICY_DRY_RUN !== "0",
    max_money_at_risk: 0,
    per_action_cap: cap ? Number(cap) : null,
    allowed_action_types: (
      process.env.ZINO_ALLOWED_ACTIONS ??
      "send_inquiry,prefill_booking,share_for_approval,add_to_calendar"
    )
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    roles: { owner: ownerId, payer: ownerId }
  };
}

/**
 * Lời nhắc cho lượt B thứ hai.
 *
 * Dựng từ chính `unfilled_slots` + `next_best_action` mà B vừa trả về — B tự
 * nói nó cần gì, ta đọc lại cho nó nghe rồi bảo nó tự đi lấy bằng công cụ của
 * mình. Gửi dạng text vào session cũ nên không tốn lại context của
 * alignment_result.
 */
function buildScoutNudge(previous: unknown): string {
  const summary = (previous as { sourcing_summary?: { unfilled_slots?: unknown[] } })
    ?.sourcing_summary;
  const slots = Array.isArray(summary?.unfilled_slots) ? summary.unfilled_slots : [];

  const lines = slots.map((s) => {
    const o = s as { slot_id?: string; next_best_action?: string };
    return `- ${o.slot_id ?? "?"}: ${o.next_best_action ?? ""}`.trim();
  });

  return [
    "Không có source_inputs nào từ bên ngoài, và sẽ không có.",
    "Hãy TỰ lấy dữ liệu bằng công cụ của bạn (MCP booking, web_search, web_fetch)",
    "để lấp các slot còn thiếu:",
    lines.length ? lines.join("\n") : "- toàn bộ shopping_list",
    "",
    "Lấy được bao nhiêu thì trả bấy nhiêu — offer thật quan trọng hơn đủ slot.",
    "Nếu một slot thật sự không có dữ liệu, ghi vào fallback_used và " +
      "simulation_disclosure thay vì bịa giá.",
    "Trả về đúng JSON theo schema như lần trước."
  ].join("\n");
}

function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === "23505";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

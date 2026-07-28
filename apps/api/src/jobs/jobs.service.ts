import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, lte, or, sql } from "drizzle-orm";
import { DB, type Database } from "../db/database.module";
import { jobs } from "../db/schema";

export type JobKind =
  | "agent_turn"
  | "reflection"
  | "deep_plan"
  | "recap"
  | "reminder"
  /** Partner Network: user nhắn OA đối tác → agent trả lời thay merchant */
  | "merchant_reply";

export interface Job {
  id: number;
  kind: JobKind;
  dedupeKey: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

const MAX_ATTEMPTS = 3;
/** Job "running" quá lâu coi như worker chết → cho phép nhận lại */
const STALE_LOCK_MS = 5 * 60 * 1000;

/**
 * Hàng đợi chạy trên Postgres — không cần Redis cho quy mô hackathon.
 *
 * Hai tính chất quan trọng:
 *  1. `FOR UPDATE SKIP LOCKED` → nhiều worker lấy việc song song không giẫm chân.
 *  2. `dedupeKey` → mọi job cùng khoá (thường là zaloChatId) chạy TUẦN TỰ.
 *     Không có nó, 2 tin nhắn liên tiếp trong 1 nhóm sẽ chạy 2 agent turn song
 *     song và ghi đè state của nhau.
 */
@Injectable()
export class JobsService {
  private readonly log = new Logger(JobsService.name);
  private readonly workerId = `w-${randomUUID().slice(0, 8)}`;

  constructor(@Inject(DB) private readonly db: Database) {}

  async enqueue(
    kind: JobKind,
    payload: Record<string, unknown>,
    opts: { dedupeKey?: string; runAt?: Date } = {}
  ): Promise<number> {
    const [row] = await this.db
      .insert(jobs)
      .values({
        kind,
        dedupeKey: opts.dedupeKey ?? null,
        payload,
        runAt: opts.runAt ?? new Date(),
        status: "pending"
      })
      .returning({ id: jobs.id });
    return row.id;
  }

  /**
   * Nhận 1 job sẵn sàng chạy.
   *
   * Điều kiện chọn:
   *  - status pending, đã tới runAt
   *  - KHÔNG có job nào khác cùng dedupeKey đang running  ← đây là chốt serialize
   */
  async claim(): Promise<Job | null> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);

    const rows = await this.db.execute<{
      id: number;
      kind: JobKind;
      dedupe_key: string | null;
      payload: Record<string, unknown>;
      attempts: number;
    }>(sql`
      WITH next AS (
        SELECT j.id
        FROM ${jobs} j
        WHERE j.status = 'pending'
          AND j.run_at <= ${now}
          AND (
            j.dedupe_key IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM ${jobs} r
              WHERE r.dedupe_key = j.dedupe_key
                AND r.status = 'running'
                AND r.locked_at > ${staleBefore}
            )
          )
        ORDER BY j.run_at ASC, j.id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE ${jobs} SET
        status = 'running',
        locked_by = ${this.workerId},
        locked_at = ${now},
        attempts = ${jobs.attempts} + 1
      WHERE id IN (SELECT id FROM next)
      RETURNING id, kind, dedupe_key, payload, attempts
    `);

    const r = rows.rows?.[0];
    if (!r) return null;
    return {
      id: r.id,
      kind: r.kind,
      dedupeKey: r.dedupe_key,
      payload: r.payload ?? {},
      attempts: r.attempts
    };
  }

  async complete(id: number): Promise<void> {
    await this.db.update(jobs).set({ status: "done", lockedBy: null }).where(eq(jobs.id, id));
  }

  /** Lỗi → retry với backoff; hết lượt thì đánh failed. */
  async fail(job: Job, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    const giveUp = job.attempts >= MAX_ATTEMPTS;

    if (giveUp) {
      this.log.error(`Job ${job.id} (${job.kind}) bỏ cuộc sau ${job.attempts} lần: ${message}`);
      await this.db
        .update(jobs)
        .set({ status: "failed", lastError: message, lockedBy: null })
        .where(eq(jobs.id, job.id));
      return;
    }

    const backoffMs = 2 ** job.attempts * 5_000; // 10s, 20s
    this.log.warn(`Job ${job.id} (${job.kind}) lỗi, thử lại sau ${backoffMs / 1000}s: ${message}`);
    await this.db
      .update(jobs)
      .set({
        status: "pending",
        lastError: message,
        lockedBy: null,
        lockedAt: null,
        runAt: new Date(Date.now() + backoffMs)
      })
      .where(eq(jobs.id, job.id));
  }

  /** Job kẹt "running" quá lâu (worker chết giữa chừng) → trả về pending. */
  async reclaimStale(): Promise<number> {
    const staleBefore = new Date(Date.now() - STALE_LOCK_MS);
    const res = await this.db
      .update(jobs)
      .set({ status: "pending", lockedBy: null, lockedAt: null })
      .where(
        and(
          eq(jobs.status, "running"),
          or(lte(jobs.lockedAt, staleBefore), sql`${jobs.lockedAt} IS NULL`)
        )
      )
      .returning({ id: jobs.id });
    if (res.length) this.log.warn(`Thu hồi ${res.length} job treo`);
    return res.length;
  }
}

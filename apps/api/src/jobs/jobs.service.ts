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
  | "merchant_reply"
  /**
   * Một stage của pipeline 4 agent. Job xong thì tự đẩy job kế vào hàng đợi,
   * nên A→B→C là ba job nối nhau chứ không phải một vòng lặp dài — retry và
   * backoff nhờ vậy hoạt động ở mức từng stage.
   */
  | "pipeline_step"
  /** Một lượt v7: Intake → (deliver | Brain → Finalizer). Xem V7Service. */
  | "v7_turn"
  /**
   * Một lượt của hành trình v4: chuyển tiếp text vào `v4_outcome_agent` rồi
   * gửi nguyên văn output về nhóm. Xem OutcomeService.
   */
  | "outcome_turn";

export interface Job {
  id: number;
  kind: JobKind;
  dedupeKey: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

const MAX_ATTEMPTS = 3;
/**
 * Job "running" quá lâu coi như worker chết → cho phép nhận lại.
 *
 * PHẢI LỚN HƠN tổng timeout của lượt dài nhất. Một lượt v7 là
 * Intake 45s + Brain 300s + Finalizer 90s = 435s; để 5 phút như trước thì
 * giữa lúc Brain đang chạy, `claim()` đã coi khoá là hết hạn và một worker
 * thứ hai có thể chạy song song cùng hội thoại — đúng thứ v7 §3.3 cấm.
 */
const STALE_LOCK_MS = 15 * 60 * 1000;

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

  /**
   * Gộp nhiều tin đến gần nhau thành MỘT lượt agent.
   *
   * Vì sao cần: trong nhóm, 5 người mention bot cùng lúc sẽ tạo 5 job. Chạy
   * tuần tự thì người cuối chờ ~15s, tốn 5 lần token, và mỗi lượt Zino chỉ
   * thấy một mẩu — trả lời rời rạc, không nắm được cả cuộc trao đổi.
   *
   * Cách làm: job đầu tiên được hẹn chạy sau `windowMs`. Tin đến trong cửa sổ
   * đó KHÔNG tạo job mới, chỉ đẩy lùi thời điểm chạy một chút. Khi cửa sổ đóng,
   * một lượt duy nhất đọc toàn bộ tin chưa trả lời từ DB.
   *
   * Trả về id job đang gom, hoặc null nếu đã gộp vào job có sẵn.
   */
  async enqueueCoalesced(
    kind: JobKind,
    payload: Record<string, unknown>,
    dedupeKey: string,
    windowMs: number
  ): Promise<number | null> {
    const runAt = new Date(Date.now() + windowMs);

    // Có job pending cùng khoá → chỉ dời lịch, không tạo thêm.
    // Trần dời: không quá 2 cửa sổ kể từ lúc tạo, để một người nhắn liên tục
    // không giữ Zino im lặng mãi.
    const bumped = await this.db.execute<{ id: number }>(sql`
      UPDATE ${jobs}
      SET run_at = LEAST(${runAt}, created_at + ${sql.raw(`interval '${Math.round((windowMs * 2) / 1000)} seconds'`)})
      WHERE id = (
        SELECT id FROM ${jobs}
        WHERE kind = ${kind} AND dedupe_key = ${dedupeKey} AND status = 'pending'
        ORDER BY id DESC LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `);

    if (bumped.rows?.[0]) {
      this.log.debug(`Gộp vào job#${bumped.rows[0].id} (${dedupeKey})`);
      return null;
    }

    return this.enqueue(kind, payload, { dedupeKey, runAt });
  }

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

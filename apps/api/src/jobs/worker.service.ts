import Anthropic from "@anthropic-ai/sdk";
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { and, eq, lte } from "drizzle-orm";
import { AgentService } from "../agent/agent.service";
import { REFLECTION_PROMPT } from "../agent/prompt";
import { DB, type Database } from "../db/database.module";
import { activities, reminders, trips } from "../db/schema";
import { MediaService } from "../media/media.service";
import { MerchantAgentService } from "../oa/merchant-agent.service";
import { OutcomeService, type OutcomeTurnJob } from "../pipeline/outcome.service";
import { PipelineService, type StepJob } from "../pipeline/pipeline.service";
import { envStr } from "../pipeline/pipeline.types";
import { V7Service, type V7TurnJob } from "../pipeline/v7.service";
import { v7Enabled } from "../pipeline/v7.types";
import { renderRecapHtml, type RecapPayload } from "../trips/recap";
import { TripsService } from "../trips/trips.service";
import { ConversationService } from "../zalo/conversation.service";
import { ZaloClient } from "../zalo/zalo.client";
import { JobsService, type Job } from "./jobs.service";

const POLL_MS = 1_000;
/**
 * Nhịp poll khi hàng đợi rỗng.
 *
 * Trước là 3.000ms và đó là nguồn độ trễ LỚN NHẤT mà người dùng cảm nhận được:
 * webhook hẹn job chạy sau cửa sổ gộp 1,2s, nhưng sau mốc đó job còn nằm chờ
 * thêm một khoảng phân bố đều trong [0, IDLE_MS] cho tới vòng poll kế. Tức là
 * trung bình +1,5s và xấu nhất +3s cho MỌI câu trả lời, bất kể model nhanh cỡ
 * nào.
 *
 * Hạ xuống 500ms đổi lấy nhiều truy vấn `claim()` rỗng hơn — chúng đi qua index
 * `jobs_poll_idx (status, run_at)` và không trả về dòng nào, nên rẻ. Muốn triệt
 * để thì dùng LISTEN/NOTIFY, nhưng đó là việc sau hackathon.
 */
const IDLE_MS = 500;
const REFLECTION_DELAY_MS = 10 * 60 * 1000;

/**
 * Worker chạy trong cùng process với API (đủ cho quy mô hackathon).
 * Muốn tách riêng chỉ cần chạy 1 container nữa với WORKER_ONLY=1 —
 * hàng đợi trên Postgres đã an toàn với nhiều worker.
 */
@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(WorkerService.name);
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  /**
   * Client cho việc chạy nền (deep_plan, recap intro, reflection).
   *
   * PHẢI có timeout. Job đang chạy giữ khoá `dedupe_key` của hội thoại, và
   * `STALE_LOCK_MS` là 15 phút — một request treo không timeout sẽ khoá cả nhóm
   * đó khỏi mọi lượt agent trong suốt 15 phút. `deep_plan` là việc nặng nhất ở
   * đây (opus-5 + tối đa 8 lượt web_search) nên 5 phút là biên rộng nhưng vẫn
   * an toàn so với 15.
   */
  private readonly anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    timeout: 5 * 60 * 1000,
    maxRetries: 1
  });

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jobs: JobsService,
    private readonly agent: AgentService,
    private readonly zalo: ZaloClient,
    private readonly conversations: ConversationService,
    private readonly media: MediaService,
    private readonly merchant: MerchantAgentService,
    private readonly trips: TripsService,
    private readonly pipeline: PipelineService,
    private readonly v7: V7Service,
    private readonly outcome: OutcomeService
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.WORKER_ENABLED === "0") {
      this.log.warn("Worker tắt (WORKER_ENABLED=0)");
      return;
    }
    this.running = true;
    void this.jobs.reclaimStale();
    void this.loop();
    this.log.log("Worker đã chạy");
  }

  onModuleDestroy(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }

  private async loop(): Promise<void> {
    while (this.running) {
      let didWork = false;
      try {
        await this.fireDueReminders();
        await this.sweepStaleRuns();
        const job = await this.jobs.claim();
        if (job) {
          didWork = true;
          await this.handle(job);
        }
      } catch (err) {
        this.log.error(`Vòng lặp worker lỗi: ${(err as Error).message}`);
      }
      await sleep(didWork ? POLL_MS : IDLE_MS);
    }
  }

  private async handle(job: Job): Promise<void> {
    const started = Date.now();
    try {
      switch (job.kind) {
        case "agent_turn":
          await this.handleAgentTurn(job);
          break;
        case "deep_plan":
          await this.handleDeepPlan(job);
          break;
        case "recap":
          await this.handleRecap(job);
          break;
        case "reflection":
          await this.handleReflection(job);
          break;
        case "merchant_reply":
          // Partner Network: trả lời lead thay OA đối tác rồi đẩy về nhóm Zino
          await this.merchant.handleLead(job.payload.leadId as number);
          break;
        case "v7_turn":
          // Job cũ còn trong hàng đợi sau khi tắt cờ → bỏ, đừng chạy nữa
          if (!v7Enabled()) {
            this.log.warn(`Bỏ job#${job.id} v7_turn: ZINO_V7_ENABLED=0`);
            break;
          }
          await this.v7.turn(job.payload as unknown as V7TurnJob);
          break;
        case "outcome_turn":
          // Một lượt hành trình v4. Cờ tắt giữa chừng thì job cũ bị bỏ, không chạy tiếp.
          await this.outcome.turn(job.payload as unknown as OutcomeTurnJob);
          break;
        case "pipeline_step":
          // Một stage của pipeline 4 agent; stage này xong sẽ tự đẩy stage kế
          await this.pipeline.step(job.payload as unknown as StepJob);
          break;
        default:
          this.log.warn(`Job kind lạ: ${job.kind}`);
      }
      await this.jobs.complete(job.id);
      this.log.log(`job#${job.id} ${job.kind} xong trong ${Date.now() - started}ms`);
    } catch (err) {
      await this.jobs.fail(job, err);
      // Báo user khi lượt hội thoại hỏng hẳn — im lặng là tệ nhất
      if (job.attempts >= 3 && (job.kind === "agent_turn" || job.kind === "v7_turn")) {
        /**
         * Với v7 phải ĐÓNG RUN trước khi báo.
         *
         * Run kẹt ở trạng thái non-terminal khiến webhook tiếp tục route mọi
         * tin nhắn vào v7, lại fail, lại im — nhóm mất luôn 19 tool của
         * AgentService. Một lượt hỏng thì chỉ được mất một lượt.
         */
        let chatId = job.payload.zaloChatId as string | undefined;
        if (job.kind === "v7_turn") {
          chatId = (await this.v7.abandon(job.payload.runId as number)) ?? chatId;
        }
        if (chatId) {
          await this.zalo.sendRaw(
            chatId,
            "Mình gặp trục trặc kỹ thuật, chưa xử lý được tin vừa rồi 😢 Bạn thử nhắn lại giúp mình nhé."
          );
        }
      }
    }
  }

  /**
   * Dọn run pipeline bị bỏ quên (owner không bao giờ chọn phương án).
   *
   * Không có bước này thì unique index `một hội thoại một run active` sẽ khoá
   * nhóm đó vĩnh viễn — không ai lên kế hoạch mới được nữa.
   * Chạy 5 phút một lần là đủ; TTL mặc định 24h.
   */
  private lastSweepAt = 0;
  private async sweepStaleRuns(): Promise<void> {
    if (Date.now() - this.lastSweepAt < 5 * 60 * 1000) return;
    this.lastSweepAt = Date.now();
    await this.pipeline.expireStale();
  }

  /* ---------------------------------------------------------------- */

  private async handleAgentTurn(job: Job): Promise<void> {
    const p = job.payload as Record<string, never>;
    const chatId = p.zaloChatId as unknown as string;

    const result = await this.agent.runTurn({
      conversationId: p.conversationId as unknown as number,
      zaloChatId: chatId,
      senderZaloId: p.senderZaloId as unknown as string,
      senderName: p.senderName as unknown as string,
      text: (p.text as unknown as string) ?? null,
      imageUrl: (p.imageUrl as unknown as string) ?? null,
      imagePath: (p.imagePath as unknown as string) ?? null,
      imageMime: (p.imageMime as unknown as string) ?? null
    });

    // Agent có thể trả về nhiều tin khi nó chủ động tách theo từng người/chủ đề.
    // Gửi tuần tự, giãn nhẹ để Zalo giữ đúng thứ tự.
    for (const [i, reply] of result.replies.entries()) {
      const text = reply.to ? `@${reply.to} ${reply.text}` : reply.text;
      await this.zalo.sendMarkdown(chatId, text);
      await this.conversations.recordOutbound(p.conversationId as unknown as number, text);
      if (i < result.replies.length - 1) await sleep(600);
    }

    // Lên lịch reflection — nếu nhóm còn nhắn tiếp, job sau sẽ ghi đè kết quả
    await this.jobs.enqueue(
      "reflection",
      { conversationId: p.conversationId },
      { runAt: new Date(Date.now() + REFLECTION_DELAY_MS), dedupeKey: `reflect:${chatId}` }
    );
  }

  /** Nghiên cứu sâu bằng web_search rồi ghi thẳng lịch trình vào DB. */
  private async handleDeepPlan(job: Job): Promise<void> {
    const { conversationId, zaloChatId, tripId, focus } = job.payload as {
      conversationId: number;
      zaloChatId: string;
      tripId: number;
      focus: string;
    };

    const trip = await this.db.query.trips.findFirst({ where: eq(trips.id, tripId) });
    if (!trip) return;

    const days = Math.max(
      1,
      Math.round((trip.endDate.getTime() - trip.startDate.getTime()) / 86_400_000) + 1
    );

    const res = await this.anthropic.messages.create({
      model: envStr("ZINO_PLANNER_MODEL", "claude-opus-5"),
      max_tokens: 4000,
      system:
        "Bạn là chuyên gia lập lịch trình du lịch Việt Nam. Dùng web_search để tra CỨU THẬT: " +
        "giá vé, giờ mở cửa, khoảng cách, thời tiết mùa đó, quán ăn được đánh giá tốt. " +
        "TUYỆT ĐỐI không bịa giá. Nếu không tra được thì ghi 'giá tham khảo, cần xác nhận'. " +
        "Trả lời bằng tiếng Việt, dạng plain text (không markdown), gọn dưới 1800 ký tự, " +
        "cấu trúc theo từng ngày, mỗi mốc có giờ + tên + giá ước tính.",
      messages: [
        {
          role: "user",
          content:
            `Lên lịch trình ${days} ngày cho chuyến "${trip.name}" tới ${trip.destination}.\n` +
            `Từ ${trip.startDate.toISOString().slice(0, 10)} đến ${trip.endDate.toISOString().slice(0, 10)}.\n` +
            (trip.budgetPerPerson ? `Ngân sách: ${trip.budgetPerPerson.toLocaleString("vi-VN")}đ/người.\n` : "") +
            `Yêu cầu riêng: ${focus}`
        }
      ],
      tools: [{ type: "web_search_20260318", name: "web_search", max_uses: 8 } as never]
    });

    const plan = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n\n")
      .trim();

    if (!plan) return;

    await this.db.insert(activities).values({
      tripId,
      kind: "plan",
      content: "Zino đã research và đề xuất lịch trình chi tiết"
    });

    await this.zalo.sendMarkdown(zaloChatId, `📋 Lịch trình mình vừa research xong đây!\n\n${plan}`);
    await this.conversations.recordOutbound(conversationId, plan);
  }

  /**
   * Dựng trang HTML tổng kết chuyến đi.
   *
   * Bố cục và MỌI con số do `renderRecapHtml` dựng bằng code — tất định, có
   * unit test, khớp từng đồng với màn Chi phí của Mini App. Claude chỉ viết
   * một đoạn lời tựa 2–3 câu; model lỗi hay hết quota thì bỏ đoạn đó, trang
   * vẫn ra đầy đủ. Trước đây cả trang do LLM sinh: mỗi lần một kiểu, và một
   * cú timeout giữa demo là mất trắng phần "trang tổng kết".
   */
  private async handleRecap(job: Job): Promise<void> {
    const { conversationId, zaloChatId, tripId, tone } = job.payload as {
      conversationId: number;
      zaloChatId: string;
      tripId: number;
      tone: string;
    };

    const data = await this.trips.recap(tripId);
    const intro = await this.writeRecapIntro(data, tone);
    const base = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
    const html = renderRecapHtml(data, {
      intro,
      publicUrl: base ? `${base}/trip/${tripId}/` : null
    });

    const url = await this.media.writeRecap(tripId, html);

    await this.db.insert(activities).values({
      tripId,
      kind: "recap",
      content: `Đã dựng trang tổng kết: ${url}`
    });
    await this.db.update(trips).set({ status: "done" }).where(eq(trips.id, tripId));

    const msg = `🎉 Trang tổng kết chuyến đi xong rồi nè!\n\n${url}\n\nGửi link này cho cả nhóm cùng xem lại nhé 💛`;
    await this.zalo.sendRaw(zaloChatId, msg);
    await this.conversations.recordOutbound(conversationId, msg);
  }

  /**
   * Lời tựa cho trang tổng kết — phần DUY NHẤT của trang do LLM viết.
   * Lỗi gì cũng nuốt và trả null: thiếu lời tựa thì trang vẫn đủ ý, còn ném
   * lỗi ra thì job fail và cả trang tổng kết biến mất.
   */
  private async writeRecapIntro(data: RecapPayload, tone: string): Promise<string | null> {
    try {
      const res = await this.anthropic.messages.create({
        model: envStr("ZINO_RECAP_MODEL", "claude-sonnet-5"),
        max_tokens: 300,
        system:
          "Bạn là Zino, trợ lý của nhóm bạn thân. Viết lời tựa cho trang tổng kết chuyến đi: " +
          "2–3 câu tiếng Việt, ấm áp, gợi lại kỷ niệm cụ thể có trong dữ liệu. " +
          "Trả về DUY NHẤT đoạn văn, không markdown, không tiêu đề, không emoji quá 1 cái.",
        messages: [
          {
            role: "user",
            content: `Giọng điệu: ${tone}\n\nDữ liệu chuyến đi:\n${JSON.stringify(
              {
                trip: data.trip,
                stats: data.stats,
                days: data.days,
                notes: data.notes.slice(0, 8),
                photoCaptions: data.photos.map((p) => p.caption).filter(Boolean).slice(0, 8)
              },
              null,
              2
            )}`
          }
        ]
      });

      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      return text || null;
    } catch (err) {
      this.log.warn(`Không viết được lời tựa recap: ${String(err)}`);
      return null;
    }
  }

  /**
   * Trích bộ nhớ dài hạn từ transcript — đây là chỗ hệ thống "tiến hoá".
   * Dùng Haiku vì rẻ và chạy thường xuyên.
   */
  private async handleReflection(job: Job): Promise<void> {
    const conversationId = job.payload.conversationId as number;

    // Chỉ phản tư khi phiên đã nguội, tránh ghi đè giữa chừng
    const last = await this.conversations.lastMessageAt(conversationId);
    if (last && Date.now() - last.getTime() < REFLECTION_DELAY_MS - 60_000) return;

    const rows = await this.conversations.recentMessages(conversationId, 40);
    if (rows.length < 4) return;

    const current = await this.db.query.groupMemory.findFirst({
      where: (m, { eq: e }) => e(m.conversationId, conversationId)
    });

    const transcript = rows
      .map((r) => `${r.role === "assistant" ? "Zino" : (r.senderName ?? "User")}: ${r.text ?? "[ảnh]"}`)
      .join("\n");

    const res = await this.anthropic.messages.create({
      model: envStr("ZINO_REFLECTION_MODEL", "claude-haiku-4-5-20251001"),
      max_tokens: 1200,
      system: REFLECTION_PROMPT,
      messages: [
        {
          role: "user",
          content: `# Bộ nhớ hiện tại\n${current?.content || "(trống)"}\n\n# Hội thoại\n${transcript}`
        }
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              memory: {
                type: "string",
                description:
                  "Bộ nhớ MỚI hoàn chỉnh sau khi cập nhật, dạng danh sách gạch đầu dòng. " +
                  "Gộp và viết lại cho gọn, không chồng chất."
              },
              changed: { type: "boolean", description: "Có gì thay đổi so với bộ nhớ cũ không" }
            },
            required: ["memory", "changed"],
            additionalProperties: false
          }
        }
      }
    } as never);

    const text = (res as Anthropic.Message).content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    try {
      const parsed = JSON.parse(text) as { memory: string; changed: boolean };
      if (parsed.changed && parsed.memory.trim()) {
        await this.conversations.saveMemory(conversationId, parsed.memory.trim());
        this.log.log(`Cập nhật bộ nhớ hội thoại ${conversationId}`);
      }
    } catch {
      this.log.warn("Reflection trả JSON không parse được, bỏ qua");
    }
  }

  /** Push chủ động — Bot API không có cửa sổ 48h nên gửi lúc nào cũng được. */
  private async fireDueReminders(): Promise<void> {
    const due = await this.db
      .select()
      .from(reminders)
      .where(and(eq(reminders.sent, false), lte(reminders.fireAt, new Date())))
      .limit(5);

    for (const r of due) {
      const conv = await this.db.query.conversations.findFirst({
        where: (c, { eq: e }) => e(c.id, r.conversationId)
      });
      if (!conv) continue;

      /**
       * CHỈ đánh dấu đã gửi khi Zalo thật sự nhận.
       *
       * Trước đây `sent = true` được ghi vô điều kiện, nên một cú 429 hay một
       * lúc mạng chập chờn là lời nhắc biến mất vĩnh viễn — không ai nhận được,
       * và không có dấu vết nào để biết. Để nguyên `sent = false` thì vòng lặp
       * sau thử lại; tệ nhất là nhắc muộn vài giây, còn hơn không nhắc.
       */
      const sent = await this.zalo.sendMarkdown(conv.zaloChatId, `⏰ ${r.message}`);
      if (sent === 0) {
        this.log.warn(`Chưa gửi được nhắc nhở #${r.id} — giữ lại để thử vòng sau`);
        continue;
      }

      await this.db
        .update(reminders)
        .set({ sent: true, sentAt: new Date() })
        .where(eq(reminders.id, r.id));
      this.log.log(`Đã gửi nhắc nhở #${r.id}`);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

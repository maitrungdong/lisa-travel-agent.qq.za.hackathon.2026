import Anthropic from "@anthropic-ai/sdk";
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { and, eq, lte } from "drizzle-orm";
import { AgentService } from "../agent/agent.service";
import { REFLECTION_PROMPT } from "../agent/prompt";
import { loadTripState, type ToolContext } from "../agent/tools";
import { DB, type Database } from "../db/database.module";
import { activities, reminders, trips } from "../db/schema";
import { MediaService } from "../media/media.service";
import { ConversationService } from "../zalo/conversation.service";
import { ZaloClient } from "../zalo/zalo.client";
import { JobsService, type Job } from "./jobs.service";

const POLL_MS = 1_000;
const IDLE_MS = 3_000;
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
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jobs: JobsService,
    private readonly agent: AgentService,
    private readonly zalo: ZaloClient,
    private readonly conversations: ConversationService,
    private readonly media: MediaService
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
        default:
          this.log.warn(`Job kind lạ: ${job.kind}`);
      }
      await this.jobs.complete(job.id);
      this.log.log(`job#${job.id} ${job.kind} xong trong ${Date.now() - started}ms`);
    } catch (err) {
      await this.jobs.fail(job, err);
      // Báo user khi lượt hội thoại hỏng hẳn — im lặng là tệ nhất
      if (job.kind === "agent_turn" && job.attempts >= 3) {
        const chatId = job.payload.zaloChatId as string;
        if (chatId) {
          await this.zalo.sendRaw(
            chatId,
            "Mình gặp trục trặc kỹ thuật, chưa xử lý được tin vừa rồi 😢 Bạn thử nhắn lại giúp mình nhé."
          );
        }
      }
    }
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

    if (result.reply) {
      await this.zalo.sendMarkdown(chatId, result.reply);
      await this.conversations.recordOutbound(p.conversationId as unknown as number, result.reply);
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
      model: process.env.LISA_PLANNER_MODEL ?? "claude-opus-5",
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
      content: "Lisa đã research và đề xuất lịch trình chi tiết"
    });

    await this.zalo.sendMarkdown(zaloChatId, `📋 Lịch trình mình vừa research xong đây!\n\n${plan}`);
    await this.conversations.recordOutbound(conversationId, plan);
  }

  /** Dựng trang HTML tổng kết chuyến đi từ dữ liệu đã thu thập. */
  private async handleRecap(job: Job): Promise<void> {
    const { conversationId, zaloChatId, tripId, tone } = job.payload as {
      conversationId: number;
      zaloChatId: string;
      tripId: number;
      tone: string;
    };

    const ctx = { db: this.db, tripId } as unknown as ToolContext;
    const state = await loadTripState(ctx);
    if (!state) return;

    const res = await this.anthropic.messages.create({
      model: process.env.LISA_RECAP_MODEL ?? "claude-sonnet-5",
      max_tokens: 8000,
      system:
        "Bạn dựng trang web tổng kết chuyến đi. Trả về DUY NHẤT một file HTML hoàn chỉnh, " +
        "self-contained (CSS inline trong <style>, không CDN, không JS ngoài). " +
        "Mobile-first, đẹp, ấm áp, tiếng Việt. Gồm: hero tên chuyến + ngày, timeline lịch trình, " +
        "gallery ảnh (dùng đúng URL được cung cấp, thẻ <img> loading=lazy), " +
        "bảng chi tiêu tổng kết, các ghi chú/kỷ niệm. " +
        "KHÔNG bọc trong ```html. Bắt đầu bằng <!DOCTYPE html>.",
      messages: [
        {
          role: "user",
          content: `Giọng điệu: ${tone}\n\nDữ liệu chuyến đi:\n${JSON.stringify(state, null, 2)}`
        }
      ]
    });

    let html = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    html = html.replace(/^```html?\s*/i, "").replace(/```\s*$/, "");
    if (!html.toLowerCase().includes("<!doctype")) html = `<!DOCTYPE html>\n${html}`;

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
      .map((r) => `${r.role === "assistant" ? "Lisa" : (r.senderName ?? "User")}: ${r.text ?? "[ảnh]"}`)
      .join("\n");

    const res = await this.anthropic.messages.create({
      model: process.env.LISA_REFLECTION_MODEL ?? "claude-haiku-4-5-20251001",
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

      await this.zalo.sendMarkdown(conv.zaloChatId, `⏰ ${r.message}`);
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

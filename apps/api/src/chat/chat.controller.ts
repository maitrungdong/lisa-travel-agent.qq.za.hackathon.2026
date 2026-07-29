import Anthropic from "@anthropic-ai/sdk";
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Logger,
  Param,
  ParseIntPipe,
  Post
} from "@nestjs/common";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { checkTrip, summarize, type Issue } from "../checks/itinerary-check";
import { ChatAgent } from "./chat.agent";
import { DB, type Database } from "../db/database.module";
import { chatActions, events, expenseSplits, expenses, notes } from "../db/schema";
import { DecisionsService } from "../decisions/decisions.service";
import { envStr } from "../pipeline/pipeline.types";
import { TripsService } from "../trips/trips.service";
import { revalidate, type Proposal, type ProposalContext } from "./proposals";

const askSchema = z.object({
  message: z.string().min(1).max(1000),
  actorZaloId: z.string().optional(),
  actorName: z.string().optional()
});

const actSchema = z.object({
  /** Client sinh một lần cho mỗi thẻ — chống bấm hai lần tạo hai bản ghi */
  token: z.string().min(8).max(64),
  actorZaloId: z.string().min(1),
  actorName: z.string().optional(),
  proposal: z.unknown()
});

export interface ChatActResult {
  done: boolean;
  /** Câu báo lại cho người dùng, hiện ngay trong khung chat */
  message: string;
  /** true = token này đã chạy trước đó, không ghi thêm lần nữa */
  alreadyDone?: boolean;
}

/**
 * Một nút bấm trong câu trả lời của Zino.
 *
 * `kind` là hợp đồng giữa API và Mini App: app biết cách render và biết bấm vào
 * thì đi đâu. Cố tình để một tập ĐÓNG và nhỏ — nếu để agent tự bịa ra kiểu
 * hành động mới thì app không biết xử lý và người dùng bấm vào một nút chết.
 */
export interface ChatAction {
  kind:
    | "open_tab" // chuyển tab trong app
    | "scroll_to_event" // cuộn tới một mục lịch trình
    | "open_decision" // mở thẻ chờ chốt
    | "add_expense" // mở form thêm khoản chi
    | "scan_qr" // mở camera quét QR thanh toán
    | "copy_to_chat" // copy câu hỏi để dán vào nhóm Zalo
    | "confirm"; // BẤM LÀ GHI THẬT — gọi POST /trips/:id/chat/act
  label: string;
  /** Tuỳ `kind`: tên tab, id sự kiện, hoặc câu cần copy */
  value?: string;
  /**
   * Chỉ có với `kind: "confirm"`. Nội dung sắp được ghi.
   *
   * Client gửi lại nguyên vẹn khi bấm, nhưng server KHÔNG tin nó — `revalidate`
   * kiểm lại từ đầu bằng đúng hàm đã dùng lúc dựng thẻ.
   */
  proposal?: Proposal;
}

export interface ChatCard {
  level: "error" | "warn" | "info" | "neutral";
  title: string;
  detail?: string;
  actions: ChatAction[];
}

export interface ChatReply {
  text: string;
  cards: ChatCard[];
  /** deterministic = tính bằng code · llm = model viết và qua được cổng kiểm chứng */
  source: "deterministic" | "llm";
  /** Tool nào đã chạy — hiện lên UI để người dùng biết số liệu lấy từ đâu */
  usedTools?: string[];
  /** Có lý do = câu của model đã bị chặn và thay bằng câu tất định */
  gateBlocked?: string;
  /** Có lý do = agent không chạy được, câu này do code tính. Hỏng phải thấy được. */
  degraded?: string;
}

/**
 * Chat với Zino NGAY TRONG Mini App.
 *
 * Vì sao cần, khi đã có chat nhóm Zalo: Bot API không gửi được nút bấm —
 * endpoint của nó chỉ có sendMessage/sendPhoto/sendSticker/sendChatAction/
 * sendVoice. Mọi thứ giàu hơn text đều phải sống trong Mini App. Nên đây là
 * chỗ duy nhất Zino vừa nói được vừa đưa nút bấm làm việc luôn.
 *
 * Nguyên tắc: việc SOÁT là tất định (checkTrip, có 17 test), model chỉ được
 * DIỄN GIẢI. Model bịa ra một vấn đề không có, hoặc bỏ sót một vấn đề có thật,
 * đều đắt hơn hẳn cái lợi của việc để nó tự do.
 */
@Controller()
export class ChatController {
  private readonly log = new Logger(ChatController.name);
  /**
   * Client cho ĐƯỜNG LUI (khi ChatAgent hỏng, xem `ask`).
   *
   * Phải có timeout, và lý do khắt khe hơn chỗ khác: đây là đường chạy ĐỒNG BỘ
   * của `POST /trips/:id/chat` — người dùng đang ngồi nhìn màn hình chờ. Nó lại
   * chỉ chạy đúng lúc agent chính vừa hỏng, tức là lúc hệ thống đã có vấn đề;
   * treo thêm ở đây là biến một lỗi thành một màn hình đứng im.
   *
   * 30s > 25s của `TOOL_TIMEOUT_MS` trong ChatAgent nhưng vẫn dưới `read 120s`
   * của nginx, nên nginx không bao giờ là bên cắt trước.
   */
  private readonly anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    timeout: 30_000,
    maxRetries: 1
  });

  constructor(
    private readonly trips: TripsService,
    private readonly decisions: DecisionsService,
    private readonly agent: ChatAgent,
    @Inject(DB) private readonly db: Database
  ) {}

  /**
   * Thực thi một đề xuất sau khi người dùng bấm nút trên thẻ.
   *
   * Đây là chỗ DUY NHẤT trong luồng chat ghi được dữ liệu, và nó cố tình nằm
   * ngoài tầm với của model: model chỉ soạn được đề xuất, con người bấm, rồi
   * server kiểm lại. Ba việc bắt buộc trước khi ghi:
   *
   *  1. `actorZaloId` phải là thành viên của chuyến. Ẩn nút ở UI không phải quyền.
   *  2. `revalidate` chạy lại toàn bộ luật trên payload client gửi lên — kể cả
   *     khi thẻ do chính mình dựng ra, đường về vẫn đi qua tay client.
   *  3. `token` chống bấm hai lần. Ghi token TRƯỚC, ai thua cuộc đua thì nhận
   *     lại kết quả cũ chứ không tạo bản ghi thứ hai.
   */
  @Post("trips/:id/chat/act")
  async act(
    @Param("id", ParseIntPipe) tripId: number,
    @Body() body: unknown
  ): Promise<ChatActResult> {
    const parsed = actSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const { token, actorZaloId, proposal } = parsed.data;

    const mem = await this.trips.listMembers(tripId);
    const actor = mem.find((m) => m.zaloUserId === actorZaloId);
    if (!actor) throw new ForbiddenException("Bạn không thuộc chuyến đi này");

    const trip = await this.trips.getTrip(tripId);
    const ctx: ProposalContext = {
      tripStart: new Date(trip.startDate).toISOString(),
      tripEnd: new Date(trip.endDate).toISOString(),
      members: mem.map((m) => ({ zaloUserId: m.zaloUserId, displayName: m.displayName })),
      actorZaloId
    };

    const check = revalidate(proposal, ctx);
    if (!check.ok) throw new BadRequestException(check.reason);
    const p = check.value;

    // Giành quyền ghi. Thua = ai đó (hoặc chính lần bấm trước) đã làm rồi.
    const claimed = await this.db
      .insert(chatActions)
      .values({ token, tripId, kind: p.kind, actor: actorZaloId, payload: p })
      .onConflictDoNothing()
      .returning();

    if (claimed.length === 0) {
      const [prev] = await this.db
        .select()
        .from(chatActions)
        .where(eq(chatActions.token, token));
      return {
        done: true,
        alreadyDone: true,
        message: prev?.message ?? "Việc này mình đã làm rồi."
      };
    }

    const { resultId, message } = await this.execute(tripId, p, actor);
    await this.db
      .update(chatActions)
      .set({ resultId, message })
      .where(eq(chatActions.token, token));

    this.log.log(`trip#${tripId}: ${actor.displayName} xác nhận ${p.kind} → #${resultId}`);
    return { done: true, message };
  }

  /** Ghi thật. Chỉ được gọi sau khi đã kiểm đủ ba bước ở `act`. */
  private async execute(
    tripId: number,
    p: Proposal,
    actor: { zaloUserId: string; displayName: string }
  ): Promise<{ resultId: number; message: string }> {
    switch (p.kind) {
      case "expense": {
        const [row] = await this.db
          .insert(expenses)
          .values({
            tripId,
            title: p.title,
            amount: p.amount,
            category: p.category,
            paidBy: p.paidBy,
            paidByName: p.paidByName,
            spentAt: new Date(),
            // `source: "user"` chứ KHÔNG phải "zino": khoản này do người dùng
            // quyết, Zino chỉ soạn hộ. Đặt "zino" thì `isRealTransaction` coi nó
            // là giao dịch thật và KHOÁ luôn số tiền, không ai sửa lại được.
            source: "user",
            createdBy: actor.zaloUserId,
            splitMode: p.splitWith.length ? "custom" : "equal"
          })
          .returning();

        if (p.splitWith.length) {
          const chosen = p.splitWith;
          const base = Math.floor(p.amount / chosen.length);
          const remainder = p.amount - base * chosen.length;
          const mem = await this.trips.listMembers(tripId);
          await this.db.insert(expenseSplits).values(
            chosen.map((id, i) => ({
              expenseId: row.id,
              memberZaloId: id,
              memberName: mem.find((m) => m.zaloUserId === id)?.displayName ?? null,
              shareAmount: i === 0 ? base + remainder : base
            }))
          );
        }
        return {
          resultId: row.id,
          message: `Đã ghi ${fmtVnd(p.amount)} — ${p.title}, ${p.paidByName} trả.`
        };
      }

      case "note": {
        const [row] = await this.db
          .insert(notes)
          .values({
            tripId,
            content: p.content,
            kind: p.noteKind,
            authorZaloId: actor.zaloUserId,
            authorName: actor.displayName
          })
          .returning();
        return { resultId: row.id, message: "Đã lưu vào ghi chú của chuyến." };
      }

      case "event": {
        const [row] = await this.db
          .insert(events)
          .values({
            tripId,
            title: p.title,
            startsAt: new Date(p.startsAt),
            location: p.location,
            kind: p.eventKind,
            note: p.note,
            estimatedCost: p.estimatedCost,
            status: "done",
            source: "user",
            createdBy: actor.zaloUserId
          })
          .returning();
        return { resultId: row.id, message: `Đã thêm "${p.title}" vào lịch trình.` };
      }
    }
  }

  /**
   * MODEL CẦM LÁI (mức B).
   *
   * Bản trước định tuyến bằng regex rồi mới gọi model cho phần còn lại. Đổi lại
   * vì regex không hiểu "chuyến này có gì đáng lo không" hay "tối nay ăn ở đâu
   * rồi nhỉ" — mà đó mới là cách người ta hỏi thật.
   *
   * Đánh đổi được kiểm soát bằng ba lớp trong ChatAgent: tool chỉ đọc, model
   * không làm phép tính, và cổng kiểm chứng số liệu trước khi chữ tới người dùng.
   *
   * Agent hỏng vì bất kỳ lý do gì (hết quota, timeout, JSON lỗi) thì rơi về
   * đúng bộ định tuyến regex cũ — vẫn trả lời được, chỉ kém tự nhiên hơn.
   */
  @Post("trips/:id/chat")
  async ask(@Param("id", ParseIntPipe) tripId: number, @Body() body: unknown): Promise<ChatReply> {
    const parsed = askSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const text = parsed.data.message.trim();

    try {
      const r = await this.agent.run(tripId, text, parsed.data.actorZaloId);
      if (r.gateBlocked) {
        this.log.warn(`trip#${tripId}: cổng kiểm chứng chặn câu của model (${r.gateBlocked})`);
      }
      if (r.degraded) {
        this.log.error(`trip#${tripId}: agent chạy chế độ dự phòng — ${r.degraded}`);
      }
      return {
        text: r.text,
        cards: r.cards,
        source: r.source,
        usedTools: r.usedTools,
        gateBlocked: r.gateBlocked,
        degraded: r.degraded
      };
    } catch (err) {
      this.log.error(`Agent hỏng, rơi về định tuyến regex: ${String(err)}`);
      const intent = routeIntent(text);
      if (intent === "money") return this.runMoney(tripId);
      if (intent === "today") return this.runToday(tripId);
      if (intent === "check") return this.runCheck(tripId);
      return this.runFreeform(tripId, text);
    }
  }

  /** Gợi ý câu hỏi mở màn — app hiện thành chip bấm được khi chat còn trống. */
  @Post("trips/:id/chat/suggestions")
  suggestions(): { label: string; message: string }[] {
    return [
      { label: "Soát lại chuyến đi", message: "Soát lại chuyến đi giúp mình" },
      { label: "Hôm nay có gì", message: "Hôm nay có gì" },
      { label: "Tiền nong sao rồi", message: "Tiền nong sao rồi" }
    ];
  }

  /* ------------------------------------------------------------------ */

  private async gather(tripId: number) {
    const [full, decision, paid] = await Promise.all([
      this.trips.fullTrip(tripId),
      this.decisions.activeForTrip(tripId),
      this.trips.paidPairs(tripId)
    ]);
    const paidKeys = new Set(paid.map((p) => `${p.from}>${p.to}`));
    return {
      full,
      decision,
      unpaid: full.settlement.settlements.filter((s) => !paidKeys.has(`${s.from}>${s.to}`))
    };
  }

  /** UC1 — "Soát lại chuyến đi giúp mình". */
  private async runCheck(tripId: number): Promise<ChatReply> {
    const { full, decision, unpaid } = await this.gather(tripId);

    const issues = checkTrip({
      trip: {
        id: full.trip.id,
        name: full.trip.name,
        startDate: full.trip.startDate,
        endDate: full.trip.endDate,
        budgetPerPerson: full.trip.budgetPerPerson == null ? null : Number(full.trip.budgetPerPerson)
      },
      events: full.events.map((e) => ({
        id: e.id,
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        kind: e.kind,
        location: e.location,
        status: e.status,
        failReason: e.failReason,
        estimatedCost: e.estimatedCost == null ? null : Number(e.estimatedCost)
      })),
      memberCount: full.members.length,
      totalSpent: full.settlement.totalSpent,
      unpaidTransfers: unpaid.map((s) => ({
        fromName: s.fromName,
        toName: s.toName,
        amount: s.amount
      })),
      openDecision: decision ? { title: decision.title, pendingNames: decision.pendingNames } : null
    });

    return {
      text: summarize(issues),
      cards: issues.slice(0, 6).map((i) => this.toCard(i)),
      source: "deterministic"
    };
  }

  /** Mỗi loại vấn đề có đúng một hành động hợp lý — không nhồi 3 nút cho mọi thẻ. */
  private toCard(i: Issue): ChatCard {
    const actions: ChatAction[] = [];
    switch (i.code) {
      case "event_failed":
        actions.push(
          { kind: "copy_to_chat", label: "Nhờ Zino tìm lại", value: `@Zino tìm lại giúp mình "${i.title}"` },
          { kind: "scroll_to_event", label: "Xem lịch trình", value: String(i.eventId ?? "") }
        );
        break;
      case "event_overlap":
      case "event_outside_trip":
        actions.push({ kind: "scroll_to_event", label: "Xem mục này", value: String(i.eventId ?? "") });
        break;
      case "no_stay":
        actions.push({
          kind: "copy_to_chat",
          label: "Nhờ Zino tìm chỗ ở",
          value: "@Zino tìm giúp mình chỗ ở cho đêm còn trống"
        });
        break;
      case "empty_day":
        actions.push({
          kind: "copy_to_chat",
          label: "Nhờ Zino gợi ý",
          value: "@Zino gợi ý giúp mình vài chỗ chơi cho ngày còn trống"
        });
        break;
      case "over_budget":
        actions.push({ kind: "open_tab", label: "Xem chi phí", value: "expenses" });
        break;
      case "open_decision":
        actions.push({ kind: "open_decision", label: "Mở thẻ bình chọn" });
        break;
      case "unpaid_transfer":
        actions.push({ kind: "open_tab", label: "Tick đã trả", value: "expenses" });
        break;
    }
    return { level: i.level, title: i.title, detail: i.detail, actions };
  }

  /** UC2 — "Tiền nong sao rồi". */
  private async runMoney(tripId: number): Promise<ChatReply> {
    const { full, unpaid } = await this.gather(tripId);
    const s = full.settlement;
    const budget =
      full.trip.budgetPerPerson != null && full.members.length > 0
        ? Number(full.trip.budgetPerPerson) * full.members.length
        : null;

    const lines = [`Cả nhóm đã tiêu ${vnd(s.totalSpent)}`];
    if (budget != null) {
      const left = budget - s.totalSpent;
      lines.push(left >= 0 ? `còn ${vnd(left)} trong ngân sách` : `vượt ngân sách ${vnd(-left)}`);
    }
    lines.push(
      unpaid.length === 0
        ? "Không ai còn nợ ai."
        : `Còn ${unpaid.length} khoản chưa chuyển.`
    );

    const cards: ChatCard[] = unpaid.map((t) => ({
      level: "info",
      title: `${t.fromName} → ${t.toName}`,
      detail: vnd(t.amount),
      actions: [{ kind: "open_tab", label: "Tick đã trả", value: "expenses" }]
    }));

    cards.push({
      level: "neutral",
      title: "Vừa tiêu gì đó?",
      detail: "Quét mã QR trên hoá đơn, mình điền sẵn số tiền cho.",
      actions: [
        { kind: "scan_qr", label: "Quét QR hoá đơn" },
        { kind: "add_expense", label: "Nhập tay" }
      ]
    });

    return { text: lines.join(" · "), cards, source: "deterministic" };
  }

  /** UC3 — "Hôm nay có gì". */
  private async runToday(tripId: number): Promise<ChatReply> {
    const { full } = await this.gather(tripId);
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const items = full.events
      .filter((e) => new Date(new Date(e.startsAt).getTime() + 7 * 3600_000).toISOString().slice(0, 10) === today)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

    if (items.length === 0) {
      return {
        text: "Hôm nay lịch trống.",
        cards: [
          {
            level: "neutral",
            title: "Chưa có hoạt động nào hôm nay",
            actions: [
              {
                kind: "copy_to_chat",
                label: "Nhờ Zino gợi ý",
                value: `@Zino gợi ý giúp mình vài chỗ chơi hôm nay ở ${full.trip.destination}`
              }
            ]
          }
        ],
        source: "deterministic"
      };
    }

    return {
      text: `Hôm nay có ${items.length} hoạt động.`,
      cards: items.map((e) => ({
        level: e.status === "failed" ? "error" : e.status === "pending" ? "warn" : "neutral",
        title: `${hhmm(e.startsAt)} · ${e.title}`,
        detail: [e.location, e.status === "pending" ? "đang giữ chỗ" : null, e.failReason]
          .filter(Boolean)
          .join(" · "),
        actions: [{ kind: "scroll_to_event", label: "Xem lịch trình", value: String(e.id) }]
      })),
      source: "deterministic"
    };
  }

  /**
   * ĐƯỜNG LUI — model trả lời không tool, chỉ dùng khi ChatAgent hỏng hẳn.
   *
   * Giữ lại thay vì xoá: nó không phụ thuộc tool-use nên còn sống được cả khi
   * model từ chối gọi tool hoặc SDK đổi hành vi. Rẻ, và là lớp đáy cuối cùng.
   *
   * Không cho tool ở đây là có chủ ý: chat trong app phải trả lời trong một
   * nhịp. Việc cần research hay gọi đối tác thì đẩy về Zino trong nhóm, nơi đã
   * có sẵn hàng đợi và cơ chế push chủ động.
   */
  private async runFreeform(tripId: number, question: string): Promise<ChatReply> {
    const { full, decision, unpaid } = await this.gather(tripId);
    const context = {
      trip: full.trip,
      events: full.events.map((e) => ({ title: e.title, startsAt: e.startsAt, status: e.status })),
      members: full.members.map((m) => m.displayName),
      totalSpent: full.settlement.totalSpent,
      unpaid: unpaid.map((u) => `${u.fromName} → ${u.toName}: ${u.amount}`),
      openDecision: decision?.title ?? null
    };

    try {
      const res = await this.anthropic.messages.create({
        model: envStr("ZINO_CHAT_MODEL", "claude-haiku-4-5-20251001"),
        max_tokens: 500,
        system:
          "Bạn là Zino, trợ lý của một nhóm bạn đi du lịch. Trả lời NGẮN (2-3 câu), tiếng Việt, " +
          "thân mật. CHỈ dùng dữ liệu được cung cấp; không biết thì nói không biết và gợi ý " +
          "hỏi trong nhóm Zalo để mình research. Không bịa giá, không bịa địa điểm.",
        messages: [{ role: "user", content: `Dữ liệu:\n${JSON.stringify(context)}\n\nCâu hỏi: ${question}` }]
      });
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();

      return {
        text: text || "Mình chưa trả lời được câu này.",
        // Việc cần research thật thì đẩy về nhóm — nơi Zino có hàng đợi và web search
        cards: [
          {
            level: "neutral",
            title: "Cần mình tìm kiếm thật?",
            detail: "Hỏi trong nhóm Zalo để mình research rồi báo lại.",
            actions: [{ kind: "copy_to_chat", label: "Hỏi trong nhóm", value: `@Zino ${question}` }]
          }
        ],
        source: "llm"
      };
    } catch (err) {
      this.log.warn(`Chat freeform lỗi: ${String(err)}`);
      return {
        text: "Mình đang không nghĩ được, bạn thử hỏi lại sau nhé.",
        cards: [],
        source: "llm"
      };
    }
  }
}

function routeIntent(text: string): "check" | "money" | "today" | "freeform" {
  const t = text.toLowerCase();
  // Khớp từ khoá thay vì để model phân loại: ba ý định này chạy bằng code và
  // phải chắc chắn vào đúng nhánh, không phụ thuộc model hôm nay đọc thế nào.
  if (/soát|soat|kiểm tra|kiem tra|rà|ra soat|check/.test(t)) return "check";
  if (/tiền|tien|chi phí|chi phi|nợ|no ai|chia tiền|ngân sách|ngan sach/.test(t)) return "money";
  if (/hôm nay|hom nay|today|lịch hôm|sắp tới|sap toi/.test(t)) return "today";
  return "freeform";
}

const vnd = (n: number) =>
  `${Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}đ`;

const hhmm = (v: string | Date) => {
  const d = new Date(new Date(v).getTime() + 7 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

/** Định dạng tiền cho câu báo lại. Không dùng Intl — output đổi theo ICU môi trường. */
function fmtVnd(n: number): string {
  return `${Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}₫`;
}

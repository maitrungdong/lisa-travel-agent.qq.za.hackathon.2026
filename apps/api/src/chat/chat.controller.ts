import Anthropic from "@anthropic-ai/sdk";
import { BadRequestException, Body, Controller, Logger, Param, ParseIntPipe, Post } from "@nestjs/common";
import { z } from "zod";
import { checkTrip, summarize, type Issue } from "../checks/itinerary-check";
import { DecisionsService } from "../decisions/decisions.service";
import { TripsService } from "../trips/trips.service";

const askSchema = z.object({
  message: z.string().min(1).max(1000),
  actorZaloId: z.string().optional(),
  actorName: z.string().optional()
});

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
    | "copy_to_chat"; // copy câu hỏi để dán vào nhóm Zalo
  label: string;
  /** Tuỳ `kind`: tên tab, id sự kiện, hoặc câu cần copy */
  value?: string;
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
  /** deterministic = tính bằng code · llm = model diễn giải */
  source: "deterministic" | "llm";
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
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

  constructor(
    private readonly trips: TripsService,
    private readonly decisions: DecisionsService
  ) {}

  @Post("trips/:id/chat")
  async ask(@Param("id", ParseIntPipe) tripId: number, @Body() body: unknown): Promise<ChatReply> {
    const parsed = askSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues);
    const text = parsed.data.message.trim();

    const intent = routeIntent(text);
    if (intent === "check") return this.runCheck(tripId);
    if (intent === "money") return this.runMoney(tripId);
    if (intent === "today") return this.runToday(tripId);
    return this.runFreeform(tripId, text);
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
   * Câu hỏi tự do — model trả lời dựa trên dữ liệu chuyến đi, KHÔNG có tool.
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
        model: process.env.ZINO_CHAT_MODEL ?? "claude-haiku-4-5-20251001",
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

import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import { checkTrip, summarize, type Issue } from "../checks/itinerary-check";
import { DecisionsService } from "../decisions/decisions.service";
import { TripsService } from "../trips/trips.service";
import { envStr } from "../pipeline/pipeline.types";
import { gateReply } from "./grounding";
import {
  describeProposal,
  normalizeEvent,
  normalizeExpense,
  normalizeNote,
  type Proposal,
  type ProposalContext
} from "./proposals";

/**
 * Zino trong Mini App — model CẦM LÁI, nhưng không được tự tính.
 *
 * Ba tầng phòng thủ, xếp theo thứ tự chặt dần:
 *
 *  1. Model không có tool ghi. Toàn bộ tool ở đây chỉ ĐỌC. Nó không đặt được
 *     chỗ, không sửa được sổ, không tiêu được tiền của ai.
 *  2. Model không làm phép tính. Mọi số cần nói — kể cả số dẫn xuất như "còn
 *     lại bao nhiêu" — đều do tool tính sẵn và trả về.
 *  3. Cổng kiểm chứng (`gateReply`). Sau khi model viết xong, mọi con số trong
 *     câu phải truy ngược được về kết quả tool. Không truy được thì vứt câu của
 *     model, dùng câu tất định. Đây là chỗ biến "tin model" thành "kiểm được model".
 *
 * Hành động (nút bấm) do CODE sinh từ kết quả tool, không phải do model đề xuất
 * — model bịa ra một eventId là người dùng bấm vào hư không.
 */

export interface AgentAction {
  kind:
    | "open_tab"
    | "scroll_to_event"
    | "open_decision"
    | "add_expense"
    | "scan_qr"
    | "copy_to_chat"
    /** Nút thực thi thật: bấm là server ghi dữ liệu. Kèm `proposal`. */
    | "confirm";
  label: string;
  value?: string;
  /** Chỉ có với `kind: "confirm"` — nội dung sắp ghi, server kiểm lại trước khi làm. */
  proposal?: Proposal;
}

export interface AgentCard {
  level: "error" | "warn" | "info" | "neutral";
  title: string;
  detail?: string;
  actions: AgentAction[];
}

export interface AgentReply {
  text: string;
  cards: AgentCard[];
  /** llm = model viết và qua được cổng · deterministic = model bị chặn hoặc lỗi */
  source: "llm" | "deterministic";
  /** Tool nào đã được gọi — hiện lên UI để người dùng biết số liệu từ đâu */
  usedTools: string[];
  /** Có bị cổng kiểm chứng chặn không, kèm lý do. Dùng để theo dõi chất lượng. */
  gateBlocked?: string;
  /**
   * Có giá trị = agent KHÔNG chạy được, đây là câu tính bằng code.
   *
   * Thêm field này sau khi mất một vòng deploy để phát hiện model call hỏng:
   * câu trả lời tất định trông y hệt câu bình thường, không ai biết agent đã
   * chết. Hỏng thì phải nhìn thấy ngay từ UI.
   */
  degraded?: string;
}

const MAX_ROUNDS = 4;
const TOOL_TIMEOUT_MS = 25_000;

const SYSTEM = `Bạn là Zino, trợ lý của một nhóm bạn đi du lịch, đang trả lời TRONG Mini App.

QUY TẮC BẮT BUỘC:
- Gọi tool để lấy dữ liệu. TUYỆT ĐỐI không đoán, không nhớ, không bịa số.
- KHÔNG tự làm phép tính. Cần số nào mà tool chưa trả thì nói là chưa có, đừng tự cộng trừ.
- Viết số tiền bằng CHỮ SỐ đúng như tool trả về (vd 8300000 hoặc 8.300.000đ).
  Cấm viết "8 triệu rưỡi", "khoảng 2 trăm nghìn".
- Trả lời NGẮN: 2-3 câu, tiếng Việt, thân mật. Không lặp lại danh sách — app đã
  hiện thẻ chi tiết bên dưới câu trả lời của bạn rồi.
- Việc cần tìm kiếm thật (tìm quán, hỏi đối tác, đặt chỗ) thì nói người dùng
  nhắn trong nhóm Zalo — ở đó bạn mới có công cụ research.

KHI NGƯỜI DÙNG NHỜ LÀM VIỆC (ghi khoản chi, lưu ghi chú, thêm mục lịch trình):
- Gọi tool propose_* tương ứng. Tool KHÔNG ghi gì cả, nó chỉ dựng thẻ xác nhận;
  người dùng bấm nút thì mới thật sự ghi. Nên cứ gọi, đừng hỏi xin phép trước.
- Tool trả về lỗi thì ĐỌC KỸ lý do rồi hỏi lại người dùng đúng thứ còn thiếu.
  Đừng đoán bừa cho đủ tham số.
- Số tiền phải là số nguyên đồng: "350k" là 350000, "2 triệu rưỡi" là 2500000.
- Sau khi gọi propose_*, trả lời NGẮN GỌN một câu kiểu "Mình soạn sẵn rồi, kiểm
  lại rồi bấm nút giúp mình nhé" — KHÔNG nhắc lại số liệu, thẻ đã hiện đủ.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_trip_overview",
    description:
      "Thông tin chung của chuyến: tên, điểm đến, ngày, số người, số hoạt động, tổng chi, ngân sách và SỐ TIỀN CÒN LẠI (đã tính sẵn).",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "run_itinerary_check",
    description:
      "Soát toàn bộ chuyến đi, trả về danh sách vấn đề: mục đặt hỏng, trùng giờ, đêm thiếu chỗ ở, ngày trống, vượt ngân sách, quyết định chưa chốt, nợ chưa trả. Dùng khi người dùng hỏi 'soát', 'kiểm tra', 'có gì cần lo không'.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "get_money_status",
    description:
      "Tình hình tiền: tổng chi, ngân sách, còn lại, chi theo hạng mục, ai cần chuyển cho ai bao nhiêu (đã trừ những khoản đã tick 'đã trả').",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "get_day_plan",
    description:
      "Lịch trình của một ngày. Không truyền `date` thì lấy hôm nay theo giờ Việt Nam.",
    input_schema: {
      type: "object",
      properties: { date: { type: "string", description: "yyyy-mm-dd, giờ VN" } },
      required: []
    }
  },
  {
    name: "propose_expense",
    description:
      "Soạn thẻ xác nhận cho một khoản chi. KHÔNG ghi vào sổ — người dùng bấm nút trên thẻ thì mới ghi. Dùng khi người dùng nói kiểu 'ghi giúp mình 350k tiền ăn tối', 'Linh vừa trả 600k vé'.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Chi cho việc gì, vd 'Ăn tối Gành Hào'" },
        amount: { type: "number", description: "Số tiền, ĐƠN VỊ ĐỒNG, số nguyên. 350k = 350000" },
        category: {
          type: "string",
          enum: ["food", "stay", "transport", "ticket", "shopping", "other"]
        },
        paidBy: { type: "string", description: "Tên người trả. Bỏ trống = người đang chat" },
        splitWith: {
          type: "array",
          items: { type: "string" },
          description: "Tên những người cùng chịu khoản này. Bỏ trống = chia đều cả nhóm"
        }
      },
      required: ["title", "amount"]
    }
  },
  {
    name: "propose_note",
    description:
      "Soạn thẻ xác nhận cho một ghi chú của chuyến đi. KHÔNG ghi ngay. Dùng khi người dùng nói 'nhớ giúp mình...', 'ghi lại là...'.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string" },
        noteKind: { type: "string", enum: ["note", "tip"] }
      },
      required: ["content"]
    }
  },
  {
    name: "propose_event",
    description:
      "Soạn thẻ xác nhận cho một mục lịch trình mới. KHÔNG ghi ngay. Ngày phải nằm trong khoảng chuyến đi — không rõ ngày thì gọi get_trip_overview trước.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        date: { type: "string", description: "yyyy-mm-dd, giờ VN" },
        time: { type: "string", description: "HH:mm, giờ VN. Bỏ trống = 09:00" },
        kind: { type: "string", enum: ["stay", "food", "transport", "activity", "other"] },
        location: { type: "string" },
        note: { type: "string" },
        estimatedCost: { type: "number", description: "Chi phí ước tính, đơn vị đồng" }
      },
      required: ["title", "date"]
    }
  }
];

@Injectable()
export class ChatAgent {
  private readonly log = new Logger(ChatAgent.name);
  private readonly anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

  constructor(
    private readonly trips: TripsService,
    private readonly decisions: DecisionsService
  ) {}

  async run(tripId: number, question: string, actorZaloId?: string): Promise<AgentReply> {
    const collected: Record<string, unknown> = {};
    const usedTools: string[] = [];
    /** Vấn đề từ lần soát gần nhất — dùng để dựng thẻ hành động sau vòng lặp */
    let issues: Issue[] | null = null;
    let unpaidCount = 0;
    /** Đề xuất model đã soạn trong lượt này — mỗi cái thành một thẻ có nút thật */
    const proposals: Proposal[] = [];
    /** Nạp một lần, dùng cho mọi tool propose_* trong lượt */
    let ctx: ProposalContext | null = null;

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const res = await this.anthropic.messages.create(
          {
            // envStr chứ KHÔNG phải `??`: compose đặt ZINO_CHAT_MODEL: ${ZINO_CHAT_MODEL:-}
            // nên biến TỒN TẠI với giá trị rỗng. `??` không bắt được chuỗi rỗng →
            // tên model là "" → Anthropic trả 400 → agent ném lỗi → MỌI câu hỏi
            // đều rơi về câu tất định trong im lặng. Repo đã dính đúng bẫy này
            // một lần với nhóm biến ZINO_* (xem pipeline.types.ts).
            model: envStr("ZINO_CHAT_MODEL", "claude-haiku-4-5-20251001"),
            max_tokens: 700,
            system: SYSTEM,
            tools: TOOLS,
            messages
          },
          { timeout: TOOL_TIMEOUT_MS }
        );

        const toolUses = res.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
        );

        if (toolUses.length === 0) {
          const text = res.content
            .filter((b): b is Anthropic.TextBlock => b.type === "text")
            .map((b) => b.text)
            .join("")
            .trim();

          // Chưa gọi tool nào mà đã trả lời → không có gì để kiểm chứng.
          // Đây thường là câu xã giao; vẫn qua cổng để chắc không lọt số bịa.
          const fallback = this.fallbackText(issues, collected);
          const gate = gateReply(text, collected, fallback);
          if (!gate.passed) {
            this.log.warn(
              `Cổng kiểm chứng chặn (${gate.reason}): ${gate.ungrounded?.join(", ") ?? ""} — câu gốc: ${text.slice(0, 200)}`
            );
          }
          return {
            text: gate.text,
            cards: [...this.proposalCards(proposals, ctx), ...this.buildCards(issues, unpaidCount)],
            source: gate.passed ? "llm" : "deterministic",
            usedTools,
            gateBlocked: gate.passed ? undefined : gate.reason
          };
        }

        messages.push({ role: "assistant", content: res.content });

        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of toolUses) {
          if (use.name.startsWith("propose_")) ctx ??= await this.proposalContext(tripId, actorZaloId);
          const out = await this.callTool(
            tripId,
            use.name,
            use.input as Record<string, unknown>,
            ctx
          );
          if (use.name === "run_itinerary_check") {
            issues = (out as { issues: Issue[] }).issues;
          }
          if (use.name === "get_money_status") {
            unpaidCount = (out as { unpaidTransfers: unknown[] }).unpaidTransfers.length;
          }
          const proposed = (out as { proposal?: Proposal }).proposal;
          if (proposed) proposals.push(proposed);
          collected[use.name] = out;
          if (!usedTools.includes(use.name)) usedTools.push(use.name);
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: JSON.stringify(out)
          });
        }
        messages.push({ role: "user", content: results });
      }

      // Hết vòng mà model vẫn đòi gọi tool — trả kết quả tất định, đừng để treo
      this.log.warn(`Chat agent chạy quá ${MAX_ROUNDS} vòng cho trip#${tripId}`);
      return {
        text: this.fallbackText(issues, collected),
        cards: [...this.proposalCards(proposals, ctx), ...this.buildCards(issues, unpaidCount)],
        source: "deterministic",
        usedTools
      };
    } catch (err) {
      // Model lỗi/timeout thì vẫn phải trả lời được — dữ liệu đã có trong tay
      this.log.error(`Chat agent lỗi: ${String(err)}`);
      const safe = issues ?? (await this.checkIssues(tripId));
      return {
        text: summarize(safe),
        cards: this.buildCards(safe, unpaidCount),
        source: "deterministic",
        usedTools,
        degraded: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)
      };
    }
  }

  /* ---------------------------- tool đọc ---------------------------- */

  private async callTool(
    tripId: number,
    name: string,
    input: Record<string, unknown>
  ): Promise<unknown> {
    switch (name) {
      case "get_trip_overview":
        return this.overview(tripId);
      case "run_itinerary_check":
        return { issues: await this.checkIssues(tripId) };
      case "get_money_status":
        return this.money(tripId);
      case "get_day_plan":
        return this.dayPlan(tripId, typeof input.date === "string" ? input.date : undefined);
      default:
        return { error: `Tool không tồn tại: ${name}` };
    }
  }

  private async overview(tripId: number) {
    const r = await this.trips.recap(tripId);
    // Trả CẢ giá trị dẫn xuất (perPerson, budgetRemaining) để model khỏi phải
    // tính — số nào model tự tính ra sẽ bị cổng kiểm chứng chặn.
    return {
      name: r.trip.name,
      destination: r.trip.destination,
      startDate: r.trip.startDate,
      endDate: r.trip.endDate,
      status: r.trip.status,
      ...r.stats,
      memberNames: r.members.map((m) => m.displayName)
    };
  }

  private async money(tripId: number) {
    const [r, paid] = await Promise.all([this.trips.recap(tripId), this.trips.paidPairs(tripId)]);
    const paidKeys = new Set(paid.map((p) => `${p.from}>${p.to}`));
    return {
      totalSpent: r.stats.totalSpent,
      perPerson: r.stats.perPerson,
      budgetTotal: r.stats.budgetTotal,
      budgetRemaining: r.stats.budgetRemaining,
      byCategory: r.byCategory,
      unpaidTransfers: r.settlement.settlements
        .filter((s) => !paidKeys.has(`${s.from}>${s.to}`))
        .map((s) => ({ from: s.fromName, to: s.toName, amount: s.amount })),
      paidTransfers: r.settlement.settlements
        .filter((s) => paidKeys.has(`${s.from}>${s.to}`))
        .map((s) => ({ from: s.fromName, to: s.toName, amount: s.amount }))
    };
  }

  private async dayPlan(tripId: number, date?: string) {
    const r = await this.trips.recap(tripId);
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const want = date ?? today;
    const day = r.days.find((d) => d.date === want);
    return {
      date: want,
      isToday: want === today,
      found: Boolean(day),
      label: day?.label ?? null,
      estimatedCost: day?.estimatedCost ?? 0,
      items:
        day?.items.map((i) => ({
          id: i.id,
          time: i.time,
          title: i.title,
          location: i.location,
          estimatedCost: i.estimatedCost
        })) ?? []
    };
  }

  private async checkIssues(tripId: number): Promise<Issue[]> {
    const [full, decision, paid] = await Promise.all([
      this.trips.fullTrip(tripId),
      this.decisions.activeForTrip(tripId),
      this.trips.paidPairs(tripId)
    ]);
    const paidKeys = new Set(paid.map((p) => `${p.from}>${p.to}`));
    const unpaid = full.settlement.settlements.filter((s) => !paidKeys.has(`${s.from}>${s.to}`));

    return checkTrip({
      trip: {
        id: full.trip.id,
        name: full.trip.name,
        startDate: full.trip.startDate,
        endDate: full.trip.endDate,
        budgetPerPerson:
          full.trip.budgetPerPerson == null ? null : Number(full.trip.budgetPerPerson)
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
      openDecision: decision
        ? { title: decision.title, pendingNames: decision.pendingNames }
        : null
    });
  }

  /* ------------------------- thẻ hành động ------------------------- */

  /**
   * Nút bấm do CODE sinh từ kết quả tool.
   * Model chỉ được nói; id và giá trị trong nút không đi qua tay nó.
   */
  private buildCards(issues: Issue[] | null, unpaidCount: number): AgentCard[] {
    if (!issues || issues.length === 0) {
      return unpaidCount > 0
        ? [
            {
              level: "info",
              title: "Còn khoản chưa chuyển",
              detail: "Tick 'đã trả' ở tab Chi phí khi xong",
              actions: [{ kind: "open_tab", label: "Mở Chi phí", value: "expenses" }]
            }
          ]
        : [];
    }

    return issues.slice(0, 6).map((i) => {
      const actions: AgentAction[] = [];
      switch (i.code) {
        case "event_failed":
          actions.push(
            {
              kind: "copy_to_chat",
              label: "Nhờ Zino tìm lại",
              value: `@Zino tìm lại giúp mình "${i.title}"`
            },
            { kind: "scroll_to_event", label: "Xem lịch trình", value: String(i.eventId ?? "") }
          );
          break;
        case "event_overlap":
        case "event_outside_trip":
          actions.push({
            kind: "scroll_to_event",
            label: "Xem mục này",
            value: String(i.eventId ?? "")
          });
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
    });
  }

  /**
   * Câu thay thế khi model bị chặn — luôn tất định, luôn đúng số.
   *
   * Phải TRẢ LỜI ĐƯỢC, không được là ngõ cụt. Bản đầu nói "xem các thẻ bên
   * dưới" trong khi `cards` rỗng — người dùng hỏi một câu và nhận lại một lời
   * chỉ trỏ vào chỗ trống. Câu tất định thì kém mượt hơn câu của model là
   * chuyện chấp nhận được; vô dụng thì không.
   *
   * Nên ở đây dựng lại câu trả lời từ chính dữ liệu tool đã lấy, theo thứ tự
   * ưu tiên: kết quả soát → tiền → tổng quan.
   */
  private fallbackText(issues: Issue[] | null, collected: Record<string, unknown>): string {
    if (issues) return summarize(issues);

    const money = collected.get_money_status as
      | { totalSpent: number; budgetRemaining: number | null; unpaidTransfers: unknown[] }
      | undefined;
    if (money) {
      const parts = [`Cả nhóm đã tiêu ${vnd(money.totalSpent)}`];
      if (money.budgetRemaining != null) {
        parts.push(
          money.budgetRemaining >= 0
            ? `còn ${vnd(money.budgetRemaining)} trong ngân sách`
            : `vượt ngân sách ${vnd(-money.budgetRemaining)}`
        );
      }
      parts.push(
        money.unpaidTransfers.length === 0
          ? "không ai còn nợ ai"
          : `còn ${money.unpaidTransfers.length} khoản chưa chuyển`
      );
      return `${parts.join(" · ")}. Mình chỉ nói được con số có trong sổ, không tự cộng trừ thêm.`;
    }

    const trip = collected.get_trip_overview as
      | { name?: string; dayCount?: number; memberCount?: number; totalSpent?: number }
      | undefined;
    if (trip) {
      return (
        `${trip.name ?? "Chuyến này"}: ${trip.dayCount ?? 0} ngày, ${trip.memberCount ?? 0} người, ` +
        `đã tiêu ${vnd(trip.totalSpent ?? 0)}. ` +
        "Mình chỉ nói được con số có trong sổ, không tự tính thêm — hỏi lại theo số liệu thật nhé."
      );
    }

    return "Mình chưa trả lời được câu này. Hỏi trong nhóm Zalo để mình research giúp nhé.";
  }
}

/** Định dạng tiền cho câu tất định. Không dùng Intl — output đổi theo ICU của môi trường. */
function vnd(n: number): string {
  return `${Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}đ`;
}

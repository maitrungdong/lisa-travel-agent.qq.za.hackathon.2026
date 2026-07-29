import Anthropic from "@anthropic-ai/sdk";
import { Injectable, Logger } from "@nestjs/common";
import { checkTrip, summarize, type Issue } from "../checks/itinerary-check";
import { DecisionsService } from "../decisions/decisions.service";
import { TripsService } from "../trips/trips.service";
import { gateReply } from "./grounding";

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
    | "copy_to_chat";
  label: string;
  value?: string;
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
  nhắn trong nhóm Zalo — ở đó bạn mới có công cụ research.`;

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

  async run(tripId: number, question: string): Promise<AgentReply> {
    const collected: Record<string, unknown> = {};
    const usedTools: string[] = [];
    /** Vấn đề từ lần soát gần nhất — dùng để dựng thẻ hành động sau vòng lặp */
    let issues: Issue[] | null = null;
    let unpaidCount = 0;

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const res = await this.anthropic.messages.create(
          {
            model: process.env.ZINO_CHAT_MODEL ?? "claude-haiku-4-5-20251001",
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
            cards: this.buildCards(issues, unpaidCount),
            source: gate.passed ? "llm" : "deterministic",
            usedTools,
            gateBlocked: gate.passed ? undefined : gate.reason
          };
        }

        messages.push({ role: "assistant", content: res.content });

        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const use of toolUses) {
          const out = await this.callTool(tripId, use.name, use.input as Record<string, unknown>);
          if (use.name === "run_itinerary_check") {
            issues = (out as { issues: Issue[] }).issues;
          }
          if (use.name === "get_money_status") {
            unpaidCount = (out as { unpaidTransfers: unknown[] }).unpaidTransfers.length;
          }
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
        cards: this.buildCards(issues, unpaidCount),
        source: "deterministic",
        usedTools
      };
    } catch (err) {
      // Model lỗi/timeout thì vẫn phải trả lời được — dữ liệu đã có trong tay
      this.log.warn(`Chat agent lỗi: ${String(err)}`);
      const safe = issues ?? (await this.checkIssues(tripId));
      return {
        text: summarize(safe),
        cards: this.buildCards(safe, unpaidCount),
        source: "deterministic",
        usedTools
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

  /** Câu thay thế khi model bị chặn — luôn tất định, luôn đúng số. */
  private fallbackText(issues: Issue[] | null, collected: Record<string, unknown>): string {
    if (issues) return summarize(issues);
    if (Object.keys(collected).length > 0) {
      return "Mình đã lấy được dữ liệu chuyến đi, nhưng chưa diễn giải được. Xem các thẻ bên dưới nhé.";
    }
    return "Mình chưa trả lời được câu này. Hỏi trong nhóm Zalo để mình research giúp nhé.";
  }
}

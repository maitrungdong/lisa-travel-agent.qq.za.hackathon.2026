import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, asc, desc, eq } from "drizzle-orm";
import { DB, type Database } from "../db/database.module";
import {
  activities,
  conversations,
  events,
  expenses,
  groupMemory,
  members,
  partnerOas,
  trips
} from "../db/schema";
import type { JsonObject } from "./state-patch";

/**
 * Cầu nối hai chiều giữa hệ ba agent v7 và database của Zino.
 *
 * VÌ SAO CẦN: doc v7 chỉ đặc tả vòng hội thoại — nó không nói gì tới việc lưu
 * dữ liệu, và `thin_state` theo §5 cố tình rất mỏng. Chạy đúng doc thì agent
 * quên sạch những gì Zino đã học về nhóm, và Mini App trống trơn sau mỗi lượt
 * research. Cả hai đều không chấp nhận được với sản phẩm này.
 *
 * Hai chiều:
 *   đọc  — bơm L3 (ký ức nhóm), L2 (chuyến đang hoạt động), mạng lưới OA đối
 *          tác vào payload gửi agent, dưới khoá `zino_context`
 *   ghi  — sau mỗi lượt, ghi tóm tắt quyết định và phương án xuống `trips` /
 *          `activities` để Mini App có cái hiển thị
 *
 * `zino_context` là dữ liệu DẪN XUẤT: dựng lại mỗi lượt, KHÔNG bao giờ được
 * lưu vào `thin_state` trong DB (xem stripDerived).
 */
@Injectable()
export class V7ContextService {
  private readonly log = new Logger(V7ContextService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /* ================================================================ */
  /* ĐỌC — DB → agent                                                  */
  /* ================================================================ */

  /**
   * Ngữ cảnh cho INTAKE — cố tình KHÔNG có `partner_network`.
   *
   * Intake chỉ làm một việc: quyết định `deliver` hay `brain`. Nó không đề
   * xuất phương án, nên danh sách 30 OA đối tác kèm mô tả, khoảng giá và
   * deeplink là token input thuần tuý lãng phí — và lãng phí ở MỌI tin nhắn,
   * kể cả tin hỏi "mấy giờ đi", vì §2.2 bắt mọi tin đi qua Intake.
   *
   * Cái nó THỰC SỰ cần là ký ức nhóm và chuyến đang hoạt động: hai thứ đó
   * quyết định Intake có hỏi lại thứ nhóm đã trả lời từ tuần trước hay không.
   */
  async buildForIntake(conversationId: number): Promise<JsonObject> {
    return this.build(conversationId, { withPartners: false });
  }

  /**
   * Ngữ cảnh cho BRAIN — đầy đủ, có `partner_network`.
   *
   * Brain là bên duy nhất đề xuất phương án, và mạng lưới OA là nguồn cung
   * thật mà nó không thể tự tra bằng web_search.
   */
  async buildForBrain(conversationId: number): Promise<JsonObject> {
    return this.build(conversationId, { withPartners: true });
  }

  /**
   * Ngữ cảnh Zino nhét thêm vào `thin_state` trước khi gọi agent.
   *
   * Tên khoá cố ý đặt tiền tố `zino_` để prompt của agent phân biệt được đâu
   * là state do chính chúng sinh ra, đâu là dữ liệu backend cung cấp.
   */
  private async build(
    conversationId: number,
    opts: { withPartners: boolean }
  ): Promise<JsonObject> {
    const [conv] = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    const [memory, trip, partners] = await Promise.all([
      this.loadMemory(conversationId),
      this.loadActiveTrip(conv?.activeTripId ?? null),
      opts.withPartners ? this.loadPartners() : Promise.resolve(null)
    ]);

    return {
      /** L3 — ký ức bền về nhóm. Đây là thứ khiến Zino khác một chatbot thường. */
      group_memory: memory,
      /** L2 — chuyến đi đang hoạt động, để agent không hỏi lại thứ đã biết */
      active_trip: trip,
      /** Mạng lưới OA đối tác — chỉ Brain thấy; xem buildForIntake */
      ...(partners ? { partner_network: partners } : {}),
      seen_count: conv?.seenCount ?? 0,
      chat_type: conv?.chatType ?? "direct"
    } as JsonObject;
  }

  private async loadMemory(conversationId: number): Promise<string | null> {
    const [row] = await this.db
      .select({ content: groupMemory.content })
      .from(groupMemory)
      .where(eq(groupMemory.conversationId, conversationId))
      .limit(1);
    return row?.content?.trim() ? row.content : null;
  }

  private async loadActiveTrip(tripId: number | null): Promise<JsonObject | null> {
    if (!tripId) return null;
    const [trip] = await this.db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
    if (!trip) return null;

    const [ev, ex, mb] = await Promise.all([
      this.db.select().from(events).where(eq(events.tripId, tripId)).orderBy(asc(events.startsAt)),
      this.db.select().from(expenses).where(eq(expenses.tripId, tripId)),
      this.db.select().from(members).where(eq(members.tripId, tripId))
    ]);

    return {
      id: trip.id,
      name: trip.name,
      destination: trip.destination,
      start_date: trip.startDate.toISOString().slice(0, 10),
      end_date: trip.endDate.toISOString().slice(0, 10),
      status: trip.status,
      budget_per_person_vnd: trip.budgetPerPerson,
      member_count: mb.length,
      members: mb.map((m) => ({ id: m.zaloUserId, name: m.displayName })),
      itinerary_count: ev.length,
      spent_vnd: ex.reduce((s, e) => s + Number(e.amount), 0)
    } as JsonObject;
  }

  /**
   * Mạng lưới OA đối tác — chỉ field cần để agent gợi ý, không đổ cả bảng.
   * Giới hạn 30 để không phình payload gửi mỗi lượt.
   */
  private async loadPartners(): Promise<JsonObject[]> {
    const rows = await this.db
      .select({
        oa_id: partnerOas.oaId,
        name: partnerOas.name,
        category: partnerOas.category,
        city: partnerOas.city,
        price_hint: partnerOas.priceHint,
        deeplink: partnerOas.deeplink
      })
      .from(partnerOas)
      .limit(30);
    return rows as unknown as JsonObject[];
  }

  /**
   * Bỏ dữ liệu dẫn xuất trước khi lưu `thin_state`.
   *
   * Nếu không bỏ, `zino_context` sẽ bị đóng băng vào DB rồi mỗi lượt lại được
   * merge đè lên — ký ức nhóm sẽ đứng yên ở bản chụp của lượt đầu tiên, và
   * bảng `pipeline_runs` phình lên vì chứa cả danh sách partner.
   */
  stripDerived(state: JsonObject): JsonObject {
    const { zino_context: _drop, ...rest } = state as Record<string, unknown>;
    return rest as JsonObject;
  }

  /* ================================================================ */
  /* GHI — agent → DB                                                  */
  /* ================================================================ */

  /**
   * Lưu kết quả một lượt v7 xuống dữ liệu nghiệp vụ.
   *
   * Cố ý KHOAN DUNG: mọi field đều có thể thiếu, thiếu thì bỏ qua chứ không
   * ném lỗi. Đây là đường phụ — hỏng ở đây không được phép làm hỏng câu trả
   * lời đã gửi cho user.
   */
  async persistTurn(input: {
    conversationId: number;
    zaloChatId: string;
    thinState: JsonObject;
    /**
     * Nguồn phụ để tìm brief — thường là output thô của Intake.
     *
     * Cần vì brief có thể nằm trong `normalized_request` của Intake mà KHÔNG
     * bao giờ được merge vào `thin_state` (agent tự quyết `state_patch` gồm
     * những gì). Chỉ nhìn `thin_state` là bỏ sót đúng cái trường hợp đã xảy ra.
     */
    extraSources?: unknown[];
    decisionSummary?: string | null;
  }): Promise<void> {
    try {
      const brief = findTripBrief(input.thinState, ...(input.extraSources ?? []));
      const tripId = await this.upsertTrip(input.conversationId, input.zaloChatId, brief);
      if (!tripId) {
        /**
         * Cảnh báo có chủ đích: `current_brief.trip` là hình dạng do prompt
         * Intake quyết định, doc §5 chỉ ghi `{}`. Nếu Intake đặt tên field
         * khác thì Mini App sẽ trống trơn sau mọi lượt research — mà im lặng.
         * Thà ồn ào lúc diễn tập còn hơn phát hiện lúc lên sân khấu.
         */
        if (brief) {
          this.log.warn(`Có brief nhưng không dựng được chuyến đi: ${JSON.stringify(brief).slice(0, 400)}`);
        } else {
          this.log.warn(
            "KHÔNG tìm thấy brief chuyến đi trong state — Mini App sẽ trống. " +
              `Các khoá cấp 1 đang có: ${Object.keys(input.thinState ?? {}).join(", ") || "(rỗng)"}`
          );
        }
        return;
      }

      if (input.decisionSummary?.trim()) {
        await this.db.insert(activities).values({
          tripId,
          kind: "plan",
          content: input.decisionSummary.trim().slice(0, 2000)
        });
      }

      const options = input.thinState.options;
      if (Array.isArray(options) && options.length) {
        const text = options
          .map((o) => {
            const x = o as Record<string, unknown>;
            return `${x.visible_label ?? x.option_id ?? "?"}. ${x.summary ?? ""}`.trim();
          })
          .join("\n");
        await this.db.insert(activities).values({
          tripId,
          kind: "suggestion",
          content: text.slice(0, 2000)
        });
      }
    } catch (err) {
      // Đường phụ — không được phép làm hỏng luồng chính
      this.log.warn(`Không lưu được kết quả v7: ${(err as Error).message}`);
    }
  }

  /**
   * Tạo hoặc cập nhật chuyến đi từ brief mà Intake đã chốt.
   *
   * Chỉ tạo khi có ĐỦ ba thứ tối thiểu để một chuyến đi có nghĩa: điểm đến,
   * ngày bắt đầu, ngày kết thúc. Thiếu thì trả null — brainstorm và hỏi đáp
   * lặt vặt không nên đẻ ra chuyến đi rác trong Mini App.
   */
  private async upsertTrip(
    conversationId: number,
    zaloChatId: string,
    brief: Record<string, unknown> | null
  ): Promise<number | null> {
    if (!brief) return null;

    const destination = firstString(brief.destinations) ?? asString(brief.destination);
    const win = (brief.date_window ?? {}) as Record<string, unknown>;
    const start = parseDate(win.start);
    const end = parseDate(win.end);
    if (!destination || !start || !end) return null;

    const budget = (brief.budget ?? {}) as Record<string, unknown>;
    const perPerson = asNumber(budget.per_person);
    const pax = asNumber(brief.participant_count);

    const [conv] = await this.db
      .select({ activeTripId: conversations.activeTripId })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1);

    if (conv?.activeTripId) {
      await this.db
        .update(trips)
        .set({
          destination,
          startDate: start,
          endDate: end,
          ...(perPerson ? { budgetPerPerson: perPerson } : {})
        })
        .where(eq(trips.id, conv.activeTripId));
      return conv.activeTripId;
    }

    const [row] = await this.db
      .insert(trips)
      .values({
        conversationId,
        zaloGroupId: zaloChatId,
        name: `${destination}${pax ? ` · ${pax} người` : ""}`,
        destination,
        startDate: start,
        endDate: end,
        status: "planning",
        budgetPerPerson: perPerson ?? null
      })
      .returning({ id: trips.id });

    await this.db
      .update(conversations)
      .set({ activeTripId: row.id })
      .where(eq(conversations.id, conversationId));

    this.log.log(`v7 tạo chuyến đi #${row.id} — ${destination}`);
    return row.id;
  }

  /** Lượt research gần nhất của nhóm, cho Mini App hiển thị. */
  async recentActivity(tripId: number, limit = 20) {
    return this.db
      .select()
      .from(activities)
      .where(and(eq(activities.tripId, tripId)))
      .orderBy(desc(activities.createdAt))
      .limit(limit);
  }
}

/* ------------------------------------------------------------------ */

/**
 * Tìm brief chuyến đi bằng HÌNH DẠNG, không bằng tên khoá.
 *
 * Bản trước dò cứng `current_brief.trip` theo §5 của doc. Đo thật 29/07 09:22:
 * agent để brief ở `normalized_request.trip`. Kết quả là `persistTurn` trượt
 * im lặng suốt — Mini App trống trơn sau một lượt research 4 phút, và chỉ có
 * duy nhất một dòng `warn` báo hiệu.
 *
 * Đây là lần thứ tư trong một ngày hợp đồng trong doc lệch agent thật (§6.8
 * status, §7 Brain, §6.9 scope_summary, giờ tới §5). Dò theo tên khoá là đặt
 * cược vào thứ đã sai bốn lần. Dò theo hình dạng thì prompt đổi tên gì cũng
 * còn chạy: một object vừa có điểm đến vừa có khung ngày thì chỉ có thể là
 * brief chuyến đi.
 *
 * Duyệt theo chiều rộng, giới hạn độ sâu và số node để một `thin_state` phình
 * to không biến hàm này thành điểm treo.
 */
function findTripBrief(...roots: unknown[]): Record<string, unknown> | null {
  const queue: { node: unknown; depth: number }[] = roots.map((node) => ({ node, depth: 0 }));
  let visited = 0;

  while (queue.length && visited < 500) {
    const { node, depth } = queue.shift()!;
    if (!node || typeof node !== "object" || depth > 6) continue;
    visited++;

    if (!Array.isArray(node)) {
      const o = node as Record<string, unknown>;
      const hasDest = o.destinations !== undefined || o.destination !== undefined;
      const hasWindow = o.date_window !== undefined || o.dates !== undefined;
      if (hasDest && hasWindow) return o;
    }

    for (const child of Object.values(node as Record<string, unknown>)) {
      if (child && typeof child === "object") queue.push({ node: child, depth: depth + 1 });
    }
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function firstString(v: unknown): string | null {
  return Array.isArray(v) ? (v.map(asString).find(Boolean) ?? null) : null;
}

function asNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Chỉ nhận YYYY-MM-DD — agent trả "tháng sau" thì bỏ qua, không đoán. */
function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

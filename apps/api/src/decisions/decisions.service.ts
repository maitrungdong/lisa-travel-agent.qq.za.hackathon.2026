import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { DB, type Database } from "../db/database.module";
import { shareTripUrl } from "../common/miniapp-link";
import { activities, conversations, decisionOptions, decisionVotes, decisions, members, trips } from "../db/schema";
import { ZaloClient } from "../zalo/zalo.client";
import { decidedMessage } from "./decision.message";
import { isAgainstMajority, openStatus, tallyVotes, type Tally } from "./tally";

export interface DecisionView {
  id: number;
  tripId: number;
  kind: string;
  title: string;
  status: string;
  recommendedOptionId: number | null;
  recommendationReason: string | null;
  decidedOptionId: number | null;
  decidedByName: string | null;
  decidedAt: string | null;
  againstMajority: boolean;
  options: {
    id: number;
    label: string;
    detail: string | null;
    price: number | null;
    partnerOaId: string | null;
    votes: number;
    voterNames: string[];
    isRecommended: boolean;
  }[];
  pendingNames: string[];
  totalVotes: number;
  memberCount: number;
  isTie: boolean;
}

@Injectable()
export class DecisionsService {
  private readonly log = new Logger(DecisionsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly zalo: ZaloClient
  ) {}

  /** Thành viên của chuyến — nguồn sự thật cho "ai chưa bầu" và cho quyền chốt. */
  private async membersOf(tripId: number) {
    return this.db
      .select({
        zaloUserId: members.zaloUserId,
        displayName: members.displayName,
        role: members.role
      })
      .from(members)
      .where(eq(members.tripId, tripId));
  }

  async listByTrip(tripId: number): Promise<DecisionView[]> {
    const rows = await this.db
      .select()
      .from(decisions)
      .where(eq(decisions.tripId, tripId))
      .orderBy(asc(decisions.createdAt));
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const [opts, votes, mem] = await Promise.all([
      this.db
        .select()
        .from(decisionOptions)
        .where(inArray(decisionOptions.decisionId, ids))
        .orderBy(asc(decisionOptions.sortOrder)),
      this.db.select().from(decisionVotes).where(inArray(decisionVotes.decisionId, ids)),
      this.membersOf(tripId)
    ]);

    return rows.map((d) => {
      const myOpts = opts.filter((o) => o.decisionId === d.id);
      const t = tallyVotes(
        myOpts.map((o) => o.id),
        votes.filter((v) => v.decisionId === d.id),
        mem
      );
      return this.toView(d, myOpts, t, mem.length);
    });
  }

  /** Quyết định đang mở của chuyến — cái thẻ cam ở Tổng quan. */
  async activeForTrip(tripId: number): Promise<DecisionView | null> {
    const all = await this.listByTrip(tripId);
    return all.find((d) => d.status === "open" || d.status === "tie") ?? null;
  }

  private toView(
    d: typeof decisions.$inferSelect,
    opts: (typeof decisionOptions.$inferSelect)[],
    t: Tally,
    memberCount: number
  ): DecisionView {
    return {
      id: d.id,
      tripId: d.tripId,
      kind: d.kind,
      title: d.title,
      status: d.status,
      recommendedOptionId: d.recommendedOptionId,
      recommendationReason: d.recommendationReason,
      decidedOptionId: d.decidedOptionId,
      decidedByName: d.decidedByName,
      decidedAt: d.decidedAt?.toISOString() ?? null,
      againstMajority: d.againstMajority,
      options: opts.map((o) => {
        const tallied = t.perOption.find((p) => p.optionId === o.id);
        return {
          id: o.id,
          label: o.label,
          detail: o.detail,
          price: o.price == null ? null : Number(o.price),
          partnerOaId: o.partnerOaId,
          votes: tallied?.votes ?? 0,
          voterNames: tallied?.voterNames ?? [],
          isRecommended: d.recommendedOptionId === o.id
        };
      }),
      pendingNames: t.pendingNames,
      totalVotes: t.totalVotes,
      memberCount,
      isTie: t.isTie
    };
  }

  /** Zino tạo quyết định sau khi đã research xong. */
  async create(input: {
    tripId: number;
    conversationId?: number | null;
    kind?: string;
    title: string;
    options: { label: string; detail?: string | null; price?: number | null; partnerOaId?: string | null }[];
    recommendedIndex?: number | null;
    recommendationReason?: string | null;
  }): Promise<DecisionView> {
    if (input.options.length < 2) {
      throw new BadRequestException("Cần ít nhất 2 phương án — một phương án thì không phải là chọn");
    }

    const [row] = await this.db
      .insert(decisions)
      .values({
        tripId: input.tripId,
        conversationId: input.conversationId ?? null,
        kind: input.kind ?? "other",
        title: input.title,
        recommendationReason: input.recommendationReason ?? null
      })
      .returning();

    const opts = await this.db
      .insert(decisionOptions)
      .values(
        input.options.map((o, i) => ({
          decisionId: row.id,
          label: o.label,
          detail: o.detail ?? null,
          price: o.price ?? null,
          partnerOaId: o.partnerOaId ?? null,
          sortOrder: i
        }))
      )
      .returning();

    // recommendedIndex → id thật, chỉ biết được sau khi options đã có id
    const idx = input.recommendedIndex;
    if (idx != null && idx >= 0 && idx < opts.length) {
      await this.db
        .update(decisions)
        .set({ recommendedOptionId: opts[idx].id })
        .where(eq(decisions.id, row.id));
    }

    await this.db.insert(activities).values({
      tripId: input.tripId,
      kind: "suggestion",
      content: `Đề xuất ${opts.length} phương án cho "${input.title}"`
    });

    const view = await this.listByTrip(input.tripId);
    return view.find((d) => d.id === row.id)!;
  }

  /**
   * Bỏ phiếu. Đổi ý thì ghi đè, không đẻ thêm dòng.
   * Quyết định đã chốt thì không nhận phiếu nữa — bầu sau khi chốt là vô nghĩa
   * và chỉ làm con số hiển thị lệch với thứ đã xảy ra.
   */
  async vote(
    decisionId: number,
    optionId: number,
    actor: { zaloUserId: string; displayName?: string }
  ): Promise<DecisionView> {
    const [d] = await this.db.select().from(decisions).where(eq(decisions.id, decisionId));
    if (!d) throw new NotFoundException("Không có quyết định này");
    if (d.status === "decided" || d.status === "cancelled") {
      throw new BadRequestException("Quyết định đã chốt, không bầu được nữa");
    }

    const [opt] = await this.db
      .select()
      .from(decisionOptions)
      .where(and(eq(decisionOptions.id, optionId), eq(decisionOptions.decisionId, decisionId)));
    if (!opt) throw new BadRequestException("Phương án không thuộc quyết định này");

    const mem = await this.membersOf(d.tripId);
    if (!mem.some((m) => m.zaloUserId === actor.zaloUserId)) {
      throw new BadRequestException("Bạn không thuộc chuyến đi này");
    }

    await this.db
      .insert(decisionVotes)
      .values({
        decisionId,
        optionId,
        zaloUserId: actor.zaloUserId,
        displayName: actor.displayName ?? null
      })
      .onConflictDoUpdate({
        target: [decisionVotes.decisionId, decisionVotes.zaloUserId],
        set: { optionId, displayName: actor.displayName ?? null, createdAt: new Date() }
      });

    // Cập nhật open ↔ tie để UI nói đúng "đang hoà, chờ người tổ chức chốt"
    const view = (await this.listByTrip(d.tripId)).find((x) => x.id === decisionId)!;
    const next = openStatus({
      isTie: view.isTie,
      everyoneVoted: view.pendingNames.length === 0 && view.memberCount > 0
    } as Tally);
    if (next !== d.status) {
      await this.db.update(decisions).set({ status: next }).where(eq(decisions.id, decisionId));
      view.status = next;
    }
    return view;
  }

  /**
   * Chốt phương án. IDEMPOTENT: ai bấm trước thắng.
   *
   * Cách chặn đua: `UPDATE ... WHERE status IN ('open','tie')` rồi xem có dòng
   * nào trả về không. Hai người bấm cùng lúc thì DB tự phân xử, người sau nhận
   * lại trạng thái đã chốt chứ không tạo bản ghi thứ hai.
   */
  async decide(
    decisionId: number,
    optionId: number,
    actor: { zaloUserId: string; displayName?: string }
  ): Promise<{ view: DecisionView; alreadyDecided: boolean }> {
    const [d] = await this.db.select().from(decisions).where(eq(decisions.id, decisionId));
    if (!d) throw new NotFoundException("Không có quyết định này");

    const mem = await this.membersOf(d.tripId);
    const me = mem.find((m) => m.zaloUserId === actor.zaloUserId);
    if (!me) throw new BadRequestException("Bạn không thuộc chuyến đi này");
    // Wireframe: nút Chốt chỉ người tổ chức thấy. Server vẫn phải tự kiểm —
    // nút bị ẩn không phải là quyền.
    if (me.role !== "organizer") {
      throw new BadRequestException("Chỉ người tổ chức mới chốt được");
    }

    const before = (await this.listByTrip(d.tripId)).find((x) => x.id === decisionId)!;
    if (!before.options.some((o) => o.id === optionId)) {
      throw new BadRequestException("Phương án không thuộc quyết định này");
    }

    const against = isAgainstMajority(
      {
        totalVotes: before.totalVotes,
        leadingOptionIds: before.options
          .filter((o) => o.votes === Math.max(...before.options.map((x) => x.votes)) && o.votes > 0)
          .map((o) => o.id)
      } as Tally,
      optionId
    );

    const updated = await this.db
      .update(decisions)
      .set({
        status: "decided",
        decidedOptionId: optionId,
        decidedBy: actor.zaloUserId,
        decidedByName: actor.displayName ?? me.displayName,
        decidedAt: new Date(),
        againstMajority: against
      })
      .where(and(eq(decisions.id, decisionId), inArray(decisions.status, ["open", "tie"])))
      .returning();

    const view = (await this.listByTrip(d.tripId)).find((x) => x.id === decisionId)!;
    // Người bấm sau nhận lại trạng thái đã chốt — KHÔNG gửi tin lần hai.
    // Nhóm nhận hai tin "đã chốt" cho cùng một việc là mất hết uy tín.
    if (updated.length === 0) return { view, alreadyDecided: true };

    const chosen = view.options.find((o) => o.id === optionId);
    await this.db.insert(activities).values({
      tripId: d.tripId,
      kind: "booking",
      content:
        `Chốt "${chosen?.label ?? optionId}" cho ${d.title}` +
        ` — ${actor.displayName ?? me.displayName} chốt, ${chosen?.votes ?? 0}/${view.memberCount} phiếu` +
        (against ? ", ngược đa số" : "")
    });
    this.log.log(`decision#${decisionId} chốt option#${optionId} (ngược đa số: ${against})`);

    await this.announceDecided(d.tripId, d.conversationId, view);
    return { view, alreadyDecided: false };
  }

  /**
   * Báo lại nhóm ngay sau khi chốt — vòng khép kín app → chat của J2.
   *
   * Nuốt mọi lỗi: chốt đã ghi vào DB rồi, Zalo có chập chờn thì cũng không được
   * phép làm hỏng thao tác người dùng vừa làm. Mất tin nhắn còn hơn mất quyết định.
   */
  private async announceDecided(
    tripId: number,
    conversationId: number | null,
    view: DecisionView
  ): Promise<void> {
    try {
      const chatId = await this.resolveChatId(tripId, conversationId);
      if (!chatId) return;
      // Một hàm duy nhất dựng link, và nó LUÔN kèm ?trip= — xem common/miniapp-link.ts
      const appUrl = shareTripUrl(tripId);
      await this.zalo.sendRich(chatId, decidedMessage(view, appUrl));
    } catch (err) {
      this.log.warn(`Không báo được kết quả chốt về nhóm: ${String(err)}`);
    }
  }

  private async resolveChatId(tripId: number, conversationId: number | null): Promise<string | null> {
    if (conversationId) {
      const [c] = await this.db
        .select({ chatId: conversations.zaloChatId })
        .from(conversations)
        .where(eq(conversations.id, conversationId));
      if (c?.chatId) return c.chatId;
    }
    const [t] = await this.db
      .select({ groupId: trips.zaloGroupId, convId: trips.conversationId })
      .from(trips)
      .where(eq(trips.id, tripId));
    if (t?.groupId) return t.groupId;
    if (t?.convId) {
      const [c] = await this.db
        .select({ chatId: conversations.zaloChatId })
        .from(conversations)
        .where(eq(conversations.id, t.convId));
      return c?.chatId ?? null;
    }
    return null;
  }

  /** Tổng số quyết định đã chốt — dùng cho mục "Nhóm đã chốt gì" ở J6. */
  async decidedCount(tripId: number): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(decisions)
      .where(and(eq(decisions.tripId, tripId), eq(decisions.status, "decided")));
    return row?.n ?? 0;
  }
}

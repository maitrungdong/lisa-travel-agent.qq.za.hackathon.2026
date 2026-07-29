import { and, asc, eq } from "drizzle-orm";
import {
  activities,
  events,
  expenses,
  members,
  notes,
  photos,
  reminders,
  trips
} from "../../db/schema";
import { shareTripUrl } from "../../common/miniapp-link";
import { S, schema, type ToolContext, type ToolDef, type ToolResult } from "./types";

/** Snapshot đầy đủ của chuyến đi — dùng cho cả tool và cho grounding prompt. */
export async function loadTripState(ctx: ToolContext): Promise<Record<string, unknown> | null> {
  if (!ctx.tripId) return null;

  const trip = await ctx.db.query.trips.findFirst({ where: eq(trips.id, ctx.tripId) });
  if (!trip) return null;

  const [ev, ex, mb, nt, ph] = await Promise.all([
    ctx.db.select().from(events).where(eq(events.tripId, trip.id)).orderBy(asc(events.startsAt)),
    ctx.db.select().from(expenses).where(eq(expenses.tripId, trip.id)),
    ctx.db.select().from(members).where(eq(members.tripId, trip.id)),
    ctx.db.select().from(notes).where(eq(notes.tripId, trip.id)).orderBy(asc(notes.takenAt)),
    ctx.db.select().from(photos).where(eq(photos.tripId, trip.id))
  ]);

  const totalSpent = ex.reduce((s, e) => s + Number(e.amount), 0);

  return {
    id: trip.id,
    name: trip.name,
    destination: trip.destination,
    startDate: trip.startDate.toISOString(),
    endDate: trip.endDate.toISOString(),
    status: trip.status,
    budgetPerPerson: trip.budgetPerPerson,
    memberCount: mb.length,
    members: mb.map((m) => ({ id: m.zaloUserId, name: m.displayName })),
    itinerary: ev.map((e) => ({
      id: e.id,
      title: e.title,
      startsAt: e.startsAt.toISOString(),
      location: e.location,
      kind: e.kind,
      estimatedCost: e.estimatedCost
    })),
    expenses: ex.map((e) => ({
      id: e.id,
      title: e.title,
      amount: Number(e.amount),
      category: e.category,
      paidByName: e.paidByName
    })),
    totalSpent,
    noteCount: nt.length,
    photoCount: ph.length,
    recentNotes: nt.slice(-5).map((n) => ({ content: n.content, author: n.authorName }))
  };
}

async function logActivity(ctx: ToolContext, kind: string, content: string): Promise<void> {
  if (!ctx.tripId) return;
  await ctx.db.insert(activities).values({ tripId: ctx.tripId, kind, content });
}

function needTrip(ctx: ToolContext): ToolResult | null {
  if (ctx.tripId) return null;
  return {
    ok: false,
    error: "Nhóm chưa có chuyến đi nào đang hoạt động",
    hint: "Gọi create_trip trước, hoặc hỏi user về chuyến đi họ muốn tạo."
  };
}

export const tripTools: ToolDef[] = [
  {
    name: "get_trip_state",
    description:
      "Đọc lại trạng thái chuyến đi đang hoạt động.\n\n" +
      "⚠ ĐỪNG GỌI để trả lời câu hỏi về chuyến đi. Toàn bộ trạng thái ĐÃ NẰM SẴN " +
      "trong phần '🧳 Chuyến đi đang hoạt động' của bối cảnh — gọi tool này chỉ nhân " +
      "đôi cùng một dữ liệu và làm lượt trả lời chậm thêm khoảng 10 giây.\n\n" +
      "CHỈ dùng khi: vừa ghi dữ liệu bằng tool khác (create_trip, add_event, add_expense…) " +
      "và cần đọc lại để xác nhận đã lưu đúng.",
    input_schema: schema({}, []),
    handler: async (_input, ctx) => {
      const state = await loadTripState(ctx);
      if (!state) return { ok: false, error: "Chưa có chuyến đi nào đang hoạt động" };
      return { ok: true, trip: state };
    }
  },

  {
    name: "create_trip",
    description:
      "Tạo chuyến đi mới cho nhóm. CHỈ gọi khi đã xác nhận với user đủ: điểm đến, ngày đi, ngày về. " +
      "Sau khi tạo, chuyến này trở thành chuyến đang hoạt động của nhóm.",
    confirmRequired: true,
    input_schema: schema(
      {
        name: S.str('Tên chuyến đi, vd "Đà Nẵng hè 2026"'),
        destination: S.str('Điểm đến chính, vd "Đà Nẵng"'),
        start_date: S.date("Ngày bắt đầu"),
        end_date: S.date("Ngày kết thúc"),
        member_count: S.int("Số người tham gia (nếu user có nói)"),
        budget_per_person: S.int("Ngân sách dự kiến mỗi người, đơn vị VND (nếu user có nói)")
      },
      ["name", "destination", "start_date", "end_date"]
    ),
    handler: async (input, ctx) => {
      const start = new Date(input.start_date);
      const end = new Date(input.end_date);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return { ok: false, error: "Ngày không hợp lệ", hint: "Dùng định dạng ISO 8601" };
      }
      if (end < start) {
        return { ok: false, error: "Ngày về trước ngày đi", hint: "Hỏi lại user cho chắc" };
      }

      const [trip] = await ctx.db
        .insert(trips)
        .values({
          conversationId: ctx.conversationId,
          zaloGroupId: ctx.zaloChatId,
          name: input.name,
          destination: input.destination,
          startDate: start,
          endDate: end,
          budgetPerPerson: input.budget_per_person ?? null,
          status: "planning"
        })
        .returning();

      // Người tạo mặc định là thành viên đầu tiên
      await ctx.db
        .insert(members)
        .values({ tripId: trip.id, zaloUserId: ctx.senderZaloId, displayName: ctx.senderName })
        .onConflictDoNothing();

      ctx.setActiveTrip(trip.id);
      await ctx.db.insert(activities).values({
        tripId: trip.id,
        kind: "plan",
        content: `Tạo chuyến đi ${trip.name} (${trip.destination})`
      });

      /**
       * Đẩy link Mini App thành MỘT TIN RIÊNG ngay sau khi chốt chuyến.
       *
       * Do backend quyết định, không để model tự nhớ: nó lúc nhớ lúc quên, mà
       * đây là thời điểm duy nhất cả nhóm cùng chú ý và sẵn sàng mở app.
       *
       * `shareTripUrl` lo phần khó — deep link Mini App kèm `?trip=` để mở
       * đúng chuyến vừa tạo, và rơi về trang tổng kết web nếu chưa cấu hình
       * `ZINO_MINIAPP_URL`.
       */
      /**
       * Cố ý KHÔNG nhắc "bỏ phiếu" nữa (sửa 29/07).
       *
       * Bỏ phiếu và chốt nay diễn ra ngay trong chat qua `propose_options` +
       * `record_decision`. Câu cũ mời nhóm vào app bấm nút, tạo hai lối làm
       * cùng một việc — người dùng không biết nghe bên nào.
       *
       * Mini App giữ đúng một vai: nơi XEM lại lịch trình, đặt chỗ và sổ tiền.
       */
      ctx.pushFollowUp(
        `📱 Mở Mini App để xem lịch trình và chi phí của chuyến "${trip.name}":\n` +
          shareTripUrl(trip.id)
      );

      return {
        ok: true,
        trip_id: trip.id,
        message: `Đã tạo chuyến "${trip.name}"`,
        // Backend đã tự gửi link thành tin riêng — model KHÔNG cần nhắc lại,
        // nhắc lại là nhóm nhận hai link giống nhau trong hai tin liền nhau.
        instruction_for_you:
          "Link Mini App đã được gửi tự động thành một tin riêng. Đừng lặp lại link trong câu trả lời của bạn."
      };
    }
  },

  {
    name: "add_member",
    description:
      "Thêm thành viên vào chuyến đi. Cần thiết trước khi chia tiền — thiếu người thì chia sai.\n" +
      "THÊM NHIỀU NGƯỜI THÌ GỌI MỘT LẦN với cả danh sách: names=[\"Hà\",\"Nam\",\"Linh\"]. " +
      "Đừng gọi lặp từng người — mỗi lời gọi là một vòng đi về, sáu người thành sáu vòng.",
    input_schema: schema(
      {
        names: S.arr(
          { type: "string" },
          'Danh sách tên hiển thị, vd ["Hà","Nam","Linh"]. Thêm một người thì vẫn dùng mảng một phần tử.'
        ),
        display_name: S.str("CŨ — chỉ dùng khi thêm đúng một người và không tiện dựng mảng"),
        zalo_user_id: S.str("Zalo user id nếu biết, không thì để trống")
      },
      []
    ),
    handler: async (input, ctx) => {
      const guard = needTrip(ctx);
      if (guard) return guard;

      /**
       * Nhận cả `names` (mảng) lẫn `display_name` (một người).
       *
       * Giữ đường cũ vì đổi schema không đồng nghĩa model đổi thói quen ngay —
       * prompt cache còn giữ mô tả cũ tới khi hết hạn, và bỏ hẳn `display_name`
       * là mọi lời gọi theo kiểu cũ đều lỗi.
       *
       * Đo thật 29/07 17:41 và 17:44: model gọi `add_member` SÁU LẦN liên tiếp
       * cho sáu người — sáu vòng đi về, mỗi vòng gửi lại toàn bộ ngữ cảnh.
       */
      const raw = Array.isArray(input.names) ? input.names : [];
      const names = [...raw, input.display_name]
        .map((n) => String(n ?? "").trim())
        .filter(Boolean);

      if (!names.length) {
        return { ok: false, error: "Thiếu tên", hint: 'Truyền names=["Tên A","Tên B"]' };
      }

      // Một người và biết zalo id thì dùng id thật; nhiều người thì khoá theo tên
      const rows = names.map((name) => ({
        tripId: ctx.tripId!,
        zaloUserId:
          names.length === 1 && input.zalo_user_id?.trim()
            ? input.zalo_user_id.trim()
            : `name:${name}`,
        displayName: name
      }));

      await ctx.db.insert(members).values(rows).onConflictDoNothing();

      const all = await ctx.db.select().from(members).where(eq(members.tripId, ctx.tripId!));
      return {
        ok: true,
        added: names,
        members: all.map((m) => m.displayName),
        member_count: all.length
      };
    }
  },

  {
    name: "add_event",
    description:
      "Thêm một mốc vào lịch trình: chuyến bay, nhận phòng, bữa ăn, hoạt động, di chuyển. " +
      "Dùng cả khi đọc được thông tin từ ảnh vé/booking.",
    input_schema: schema(
      {
        title: S.str("Tên mốc, vd 'Bay VN123 SGN→DAD'"),
        starts_at: S.date("Thời điểm bắt đầu"),
        ends_at: S.date("Thời điểm kết thúc (nếu có)"),
        location: S.str("Địa điểm"),
        kind: S.enum(
          ["flight", "stay", "food", "activity", "transport", "other"],
          "Loại mốc lịch trình"
        ),
        note: S.str("Ghi chú thêm: mã đặt chỗ, số ghế, lưu ý"),
        estimated_cost: S.int("Chi phí ước tính (VND)")
      },
      ["title", "starts_at"]
    ),
    handler: async (input, ctx) => {
      const guard = needTrip(ctx);
      if (guard) return guard;

      const startsAt = new Date(input.starts_at);
      if (Number.isNaN(startsAt.getTime())) return { ok: false, error: "starts_at không hợp lệ" };

      const [ev] = await ctx.db
        .insert(events)
        .values({
          tripId: ctx.tripId!,
          title: input.title,
          startsAt,
          endsAt: input.ends_at ? new Date(input.ends_at) : null,
          location: input.location ?? null,
          kind: input.kind ?? "activity",
          note: input.note ?? null,
          estimatedCost: input.estimated_cost ?? null,
          createdBy: ctx.senderZaloId
        })
        .returning();

      await logActivity(ctx, "plan", `Thêm lịch trình: ${ev.title}`);

      const count = (await ctx.db.select().from(events).where(eq(events.tripId, ctx.tripId!))).length;
      return { ok: true, event_id: ev.id, total_events: count };
    }
  },

  {
    name: "add_note",
    description:
      "Ghi nhật ký hành trình: cảm nhận, tip, điều đáng nhớ. Dùng khi user kể chuyện dọc đường " +
      "hoặc khi bạn muốn lưu lại chi tiết cho trang tổng kết sau này.",
    input_schema: schema(
      {
        content: S.str("Nội dung ghi chú"),
        kind: S.enum(["note", "diary", "tip", "highlight"], "Loại ghi chú")
      },
      ["content"]
    ),
    handler: async (input, ctx) => {
      const guard = needTrip(ctx);
      if (guard) return guard;

      await ctx.db.insert(notes).values({
        tripId: ctx.tripId!,
        authorZaloId: ctx.senderZaloId,
        authorName: ctx.senderName,
        content: input.content,
        kind: input.kind ?? "note"
      });
      return { ok: true, message: "Đã lưu vào nhật ký" };
    }
  },

  {
    name: "add_photo",
    description:
      "Lưu ảnh kỷ niệm vào album chuyến đi. Chỉ gọi khi user vừa gửi ảnh và đó là ảnh kỷ niệm " +
      "(không phải hoá đơn hay vé). URL ảnh được cung cấp trong nội dung tin nhắn.",
    input_schema: schema(
      {
        url: S.str("URL ảnh đã lưu (lấy từ thông tin đính kèm của tin nhắn)"),
        caption: S.str("Chú thích ảnh — viết vui, tự nhiên")
      },
      ["url"]
    ),
    handler: async (input, ctx) => {
      const guard = needTrip(ctx);
      if (guard) return guard;

      await ctx.db.insert(photos).values({
        tripId: ctx.tripId!,
        url: input.url,
        caption: input.caption ?? null,
        uploaderZaloId: ctx.senderZaloId,
        uploaderName: ctx.senderName
      });
      const count = (await ctx.db.select().from(photos).where(eq(photos.tripId, ctx.tripId!))).length;
      return { ok: true, total_photos: count };
    }
  },

  {
    name: "set_reminder",
    description:
      "Đặt nhắc nhở chủ động — Zino sẽ tự nhắn vào nhóm đúng giờ đó, kể cả khi không ai hỏi. " +
      "Dùng để nhắc mốc lịch trình tiếp theo, nhắc check-in, nhắc chuẩn bị đồ.",
    input_schema: schema(
      {
        fire_at: S.date("Thời điểm gửi nhắc nhở"),
        message: S.str("Nội dung sẽ nhắn vào nhóm — viết như Zino đang nói")
      },
      ["fire_at", "message"]
    ),
    handler: async (input, ctx) => {
      const fireAt = new Date(input.fire_at);
      if (Number.isNaN(fireAt.getTime())) return { ok: false, error: "fire_at không hợp lệ" };
      if (fireAt.getTime() < Date.now() - 60_000) {
        return { ok: false, error: "Thời điểm nhắc đã ở quá khứ", hint: "Hỏi lại user muốn nhắc lúc nào" };
      }

      await ctx.db.insert(reminders).values({
        conversationId: ctx.conversationId,
        tripId: ctx.tripId,
        fireAt,
        message: input.message
      });
      await logActivity(ctx, "reminder", `Đặt nhắc: ${input.message.slice(0, 80)}`);

      return {
        ok: true,
        fire_at: fireAt.toISOString(),
        message: "Đã đặt nhắc nhở — mình sẽ tự nhắn vào nhóm đúng giờ"
      };
    }
  },

  {
    name: "update_trip_status",
    description:
      "Đổi trạng thái chuyến đi: planning (đang lên kế hoạch) → confirmed (đã chốt) → " +
      "ongoing (đang đi) → done (đã kết thúc). Chuyển sang done khi user nói chuyến đi đã xong.",
    input_schema: schema(
      { status: S.enum(["planning", "confirmed", "ongoing", "done"], "Trạng thái mới") },
      ["status"]
    ),
    handler: async (input, ctx) => {
      const guard = needTrip(ctx);
      if (guard) return guard;

      await ctx.db.update(trips).set({ status: input.status }).where(eq(trips.id, ctx.tripId!));
      await logActivity(ctx, "plan", `Chuyển trạng thái sang ${input.status}`);
      return { ok: true, status: input.status };
    }
  },

  {
    name: "list_trips",
    description:
      "Liệt kê các chuyến đi trước đây của nhóm. Dùng khi user nhắc tới chuyến cũ hoặc muốn xem lại.",
    input_schema: schema({}, []),
    handler: async (_input, ctx) => {
      const rows = await ctx.db
        .select()
        .from(trips)
        .where(and(eq(trips.conversationId, ctx.conversationId)))
        .orderBy(asc(trips.startDate));
      return {
        ok: true,
        trips: rows.map((t) => ({
          id: t.id,
          name: t.name,
          destination: t.destination,
          startDate: t.startDate.toISOString().slice(0, 10),
          status: t.status,
          recap_url: t.status === "done" ? `${ctx.publicBaseUrl}/trip/${t.id}/` : null
        }))
      };
    }
  }
];

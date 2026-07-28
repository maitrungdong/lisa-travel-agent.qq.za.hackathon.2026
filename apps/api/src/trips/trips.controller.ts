import {
  BadRequestException, Body, Controller, Get, Header, Param, ParseIntPipe, Post, Query, UseGuards
} from "@nestjs/common";
import type { ZodType } from "zod";
import { AgentKeyGuard } from "../common/agent-key.guard";
import {
  createActivitySchema, createEventSchema, createExpenseSchema, createTripSchema
} from "./trips.dto";
import { TripsService } from "./trips.service";

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues);
  return r.data;
}

@Controller("trips")
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get()
  list() {
    return this.trips.listTrips();
  }

  @Get(":id")
  get(@Param("id", ParseIntPipe) id: number) {
    return this.trips.getTrip(id);
  }

  @Post()
  @UseGuards(AgentKeyGuard)
  create(@Body() body: unknown) {
    return this.trips.createTrip(parse(createTripSchema, body));
  }

  @Get(":id/events")
  listEvents(@Param("id", ParseIntPipe) id: number) {
    return this.trips.listEvents(id);
  }

  @Post(":id/events")
  @UseGuards(AgentKeyGuard)
  createEvent(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    return this.trips.createEvent(id, parse(createEventSchema, body));
  }

  @Get(":id/expenses")
  listExpenses(@Param("id", ParseIntPipe) id: number) {
    return this.trips.listExpenses(id);
  }

  @Post(":id/expenses")
  @UseGuards(AgentKeyGuard)
  createExpense(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    return this.trips.createExpense(id, parse(createExpenseSchema, body));
  }

  @Get(":id/activities")
  listActivities(@Param("id", ParseIntPipe) id: number) {
    return this.trips.listActivities(id);
  }

  @Post(":id/activities")
  @UseGuards(AgentKeyGuard)
  createActivity(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    return this.trips.createActivity(id, parse(createActivitySchema, body));
  }

  /* ===================== BFF cho Mini App (chỉ đọc) ===================== */

  /** Gộp mọi thứ của 1 chuyến đi vào 1 request — Mini App chạy trong webview,
   *  mỗi round-trip trên 3G đều thấy rõ. */
  @Get(":id/full")
  full(@Param("id", ParseIntPipe) id: number) {
    return this.trips.fullTrip(id);
  }

  @Get(":id/photos")
  listPhotos(@Param("id", ParseIntPipe) id: number) {
    return this.trips.listPhotos(id);
  }

  @Get(":id/notes")
  listNotes(@Param("id", ParseIntPipe) id: number) {
    return this.trips.listNotes(id);
  }

  @Get(":id/members")
  listMembers(@Param("id", ParseIntPipe) id: number) {
    return this.trips.listMembers(id);
  }

  /** Dùng chung hàm settleExpenses với tool của agent — một nguồn sự thật. */
  @Get(":id/settle")
  settle(@Param("id", ParseIntPipe) id: number) {
    return this.trips.settle(id);
  }

  /** Dữ liệu trang tổng kết: lịch trình gom theo ngày, chi tiêu theo hạng mục, chia tiền. */
  @Get(":id/recap")
  recap(@Param("id", ParseIntPipe) id: number) {
    return this.trips.recap(id);
  }

  /**
   * Trang tổng kết dạng HTML, dựng tại chỗ.
   *
   * nginx trỏ `/trip/:id/` vào file tĩnh worker ghi ra (`/opt/zino/recap`).
   * Route này là đường DỰ PHÒNG: nếu job recap chưa chạy — hoặc chạy hỏng
   * giữa lúc demo — vẫn còn `/api/trips/:id/recap.html` mở ra là có trang.
   */
  @Get(":id/recap.html")
  @Header("Content-Type", "text/html; charset=utf-8")
  @Header("Cache-Control", "no-store")
  recapHtml(@Param("id", ParseIntPipe) id: number) {
    return this.trips.recapHtml(id);
  }
}

/** Danh bạ OA đối tác. Tách controller riêng vì không thuộc về một chuyến đi nào. */
@Controller("partners")
export class PartnersController {
  constructor(private readonly trips: TripsService) {}

  @Get()
  list(
    @Query("city") city?: string,
    @Query("category") category?: string,
    @Query("limit") limit?: string
  ) {
    return this.trips.listPartners({
      city,
      category,
      limit: limit ? Number(limit) : undefined
    });
  }
}

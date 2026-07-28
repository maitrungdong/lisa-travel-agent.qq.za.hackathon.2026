import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards
} from "@nestjs/common";
import { z } from "zod";
import { AgentKeyGuard } from "../common/agent-key.guard";
import { DecisionsService } from "./decisions.service";

const actorSchema = z.object({
  zaloUserId: z.string().min(1),
  displayName: z.string().optional()
});

const voteSchema = actorSchema.extend({ optionId: z.number().int().positive() });

const createSchema = z.object({
  conversationId: z.number().int().optional().nullable(),
  kind: z.enum(["stay", "food", "transport", "activity", "other"]).default("other"),
  title: z.string().min(1),
  recommendedIndex: z.number().int().min(0).optional().nullable(),
  recommendationReason: z.string().optional().nullable(),
  options: z
    .array(
      z.object({
        label: z.string().min(1),
        detail: z.string().optional().nullable(),
        price: z.number().int().nonnegative().optional().nullable(),
        partnerOaId: z.string().optional().nullable()
      })
    )
    .min(2)
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues);
  return r.data;
}

/**
 * Quyết định nhóm — J2.
 *
 * `actor` do client gửi lên. Đăng nhập Zalo đang tắt (Zalo App chưa kích hoạt)
 * nên chưa xác minh được người gửi; server bù lại bằng hai chốt chặn thật:
 * actor phải là THÀNH VIÊN của chuyến, và chốt phải là NGƯỜI TỔ CHỨC. Khi bật
 * lại đăng nhập, chỉ cần đọc actor từ phiên thay vì từ body.
 */
@Controller()
export class DecisionsController {
  constructor(private readonly decisions: DecisionsService) {}

  @Get("trips/:id/decisions")
  list(@Param("id", ParseIntPipe) id: number) {
    return this.decisions.listByTrip(id);
  }

  /** Thẻ cam ở Tổng quan — quyết định đang chờ chốt, nếu có. */
  @Get("trips/:id/decisions/active")
  async active(@Param("id", ParseIntPipe) id: number) {
    return { decision: await this.decisions.activeForTrip(id) };
  }

  /** Zino tạo — cần agent key vì đây là đường ghi dữ liệu của hệ thống. */
  @Post("trips/:id/decisions")
  @UseGuards(AgentKeyGuard)
  create(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const input = parse(createSchema, body);
    return this.decisions.create({ ...input, tripId: id });
  }

  @Post("decisions/:id/vote")
  vote(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const { optionId, ...actor } = parse(voteSchema, body);
    return this.decisions.vote(id, optionId, actor);
  }

  @Post("decisions/:id/decide")
  decide(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const { optionId, ...actor } = parse(voteSchema, body);
    return this.decisions.decide(id, optionId, actor);
  }
}

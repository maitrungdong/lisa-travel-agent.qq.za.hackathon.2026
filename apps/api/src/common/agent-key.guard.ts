import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

/**
 * Guard cho các endpoint ghi dữ liệu: chỉ OpenClaw agent (hoặc ai giữ
 * AGENT_API_KEY) được ghi. Đọc thì mở cho mini app.
 */
@Injectable()
export class AgentKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const expected = process.env.AGENT_API_KEY;
    if (!expected) return true; // chưa cấu hình → không chặn (tiện dev local)
    if (req.header("x-api-key") === expected) return true;
    throw new UnauthorizedException("x-api-key không hợp lệ");
  }
}

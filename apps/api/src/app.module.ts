import { Module } from "@nestjs/common";
import { AgentService } from "./agent/agent.service";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { DatabaseModule } from "./db/database.module";
import { DebugController } from "./debug.controller";
import { HealthController } from "./health.controller";
import { JobsService } from "./jobs/jobs.service";
import { WorkerService } from "./jobs/worker.service";
import { MediaService } from "./media/media.service";
import { MerchantAgentService } from "./oa/merchant-agent.service";
import { OaClient } from "./oa/oa.client";
import { OaController } from "./oa/oa.controller";
import { OaOAuthService } from "./oa/oauth.service";
import { ManagedAgentDriver } from "./pipeline/managed-agent.driver";
import { PipelineService } from "./pipeline/pipeline.service";
import { V7ContextService } from "./pipeline/v7.context";
import { V7Service } from "./pipeline/v7.service";
import { PartnersController, TripsController } from "./trips/trips.controller";
import { TripsService } from "./trips/trips.service";
import { ConversationService } from "./zalo/conversation.service";
import { ZaloClient } from "./zalo/zalo.client";
import { ZaloController } from "./zalo/zalo.controller";

/**
 * Một process chạy cả 3 vai:
 *   • Gateway — nhận webhook Zalo (ZaloController)
 *   • BFF     — phục vụ Mini App (TripsController)
 *   • Worker  — chạy job nền (WorkerService)
 *
 * Đủ cho quy mô hackathon. Muốn tách worker: chạy thêm container, đặt
 * WORKER_ENABLED=0 cho instance web và =1 cho instance worker.
 * Hàng đợi nằm trên Postgres nên nhiều worker chạy song song vẫn an toàn.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [
    HealthController,
    TripsController,
    PartnersController,
    ZaloController,
    OaController,
    // Phiên Mini App + dữ liệu theo người dùng (/auth/*, /me/*)
    AuthController,
    // TẠM — đo namespace id giữa Bot API và Mini App. Xoá sau khi đo xong.
    DebugController
  ],
  providers: [
    TripsService,
    AuthService,
    ZaloClient,
    ConversationService,
    MediaService,
    JobsService,
    AgentService,
    // Partner Network — uỷ quyền OA đối tác + trả lời lead thay merchant
    OaOAuthService,
    OaClient,
    MerchantAgentService,
    // Pipeline 4 agent (A→B→C→D) — chỉ hoạt động khi ZINO_PIPELINE_ENABLED=1
    ManagedAgentDriver,
    PipelineService,
    V7ContextService,
    V7Service,
    WorkerService
  ]
})
export class AppModule {}

import { Module } from "@nestjs/common";
import { AgentService } from "./agent/agent.service";
import { DatabaseModule } from "./db/database.module";
import { HealthController } from "./health.controller";
import { JobsService } from "./jobs/jobs.service";
import { WorkerService } from "./jobs/worker.service";
import { MediaService } from "./media/media.service";
import { MerchantAgentService } from "./oa/merchant-agent.service";
import { OaClient } from "./oa/oa.client";
import { OaController } from "./oa/oa.controller";
import { OaOAuthService } from "./oa/oauth.service";
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
    OaController
  ],
  providers: [
    TripsService,
    ZaloClient,
    ConversationService,
    MediaService,
    JobsService,
    AgentService,
    // Partner Network — uỷ quyền OA đối tác + trả lời lead thay merchant
    OaOAuthService,
    OaClient,
    MerchantAgentService,
    WorkerService
  ]
})
export class AppModule {}

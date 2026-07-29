import { Module } from "@nestjs/common";
import { AgentService } from "./agent/agent.service";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { ChatAgent } from "./chat/chat.agent";
import { ChatController } from "./chat/chat.controller";
import { DatabaseModule } from "./db/database.module";
import { DecisionsController } from "./decisions/decisions.controller";
import { DecisionsService } from "./decisions/decisions.service";
import { HealthController } from "./health.controller";
import { JobsService } from "./jobs/jobs.service";
import { WorkerService } from "./jobs/worker.service";
import { MediaService } from "./media/media.service";
import { ExpensesController } from "./money/expenses.controller";
import { MerchantAgentService } from "./oa/merchant-agent.service";
import { OaClient } from "./oa/oa.client";
import { OaController } from "./oa/oa.controller";
import { OaOAuthService } from "./oa/oauth.service";
import { ManagedAgentDriver } from "./pipeline/managed-agent.driver";
import { OutcomeService } from "./pipeline/outcome.service";
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
    // J2 — quyết định nhóm: bàn ở chat, chốt ở app
    DecisionsController,
    // J4 — người dùng tự thêm/sửa khoản chi, tick đã trả
    ExpensesController,
    // Chat trong app — nơi Zino vừa nói vừa đưa nút bấm (Bot API không có nút)
    ChatController
    /**
     * ĐÃ GỠ `DebugController` (29/07).
     *
     * Nó phơi `/debug/conversations` và `/debug/match` ra public, không guard —
     * id nhóm Zalo và tên thành viên của mọi hội thoại. Chính file đó tự ghi
     * "XOÁ FILE NÀY sau khi đã đo xong"; việc đo namespace id giữa Bot API và
     * Mini App đã xong nên gỡ khỏi đây. File vẫn còn trong repo, chỉ là không
     * được nạp nữa.
     *
     * Cần đo lại thì thêm dòng về, đo, rồi gỡ ngay — đừng để qua đêm.
     */
  ],
  providers: [
    TripsService,
    AuthService,
    DecisionsService,
    ChatAgent,
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
    // Research sâu bằng MỘT agent (Brain chạy nội bộ) — thay ruột job deep_plan
    // khi ZINO_OUTCOME_ENABLED=1. Tắt cờ là rơi về opus-5 + web_search.
    OutcomeService,
    WorkerService
  ]
})
export class AppModule {}

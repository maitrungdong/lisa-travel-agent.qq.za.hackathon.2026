import { Module } from "@nestjs/common";
import { DatabaseModule } from "./db/database.module";
import { HealthController } from "./health.controller";
import { TripsController } from "./trips/trips.controller";
import { TripsService } from "./trips/trips.service";

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController, TripsController],
  providers: [TripsService]
})
export class AppModule {}

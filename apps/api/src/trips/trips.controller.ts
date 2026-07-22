import {
  BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards
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
}

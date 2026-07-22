import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { asc, desc, eq } from "drizzle-orm";
import { DB, type Database } from "../db/database.module";
import { activities, events, expenses, trips } from "../db/schema";
import type { CreateActivity, CreateEvent, CreateExpense, CreateTrip } from "./trips.dto";

@Injectable()
export class TripsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  listTrips() {
    return this.db.select().from(trips).orderBy(desc(trips.createdAt));
  }

  async getTrip(id: number) {
    const [trip] = await this.db.select().from(trips).where(eq(trips.id, id));
    if (!trip) throw new NotFoundException(`Trip ${id} không tồn tại`);
    return trip;
  }

  async createTrip(input: CreateTrip) {
    const [row] = await this.db.insert(trips).values(input).returning();
    return row;
  }

  listEvents(tripId: number) {
    return this.db.select().from(events).where(eq(events.tripId, tripId)).orderBy(asc(events.startsAt));
  }

  async createEvent(tripId: number, input: CreateEvent) {
    await this.getTrip(tripId);
    const [row] = await this.db.insert(events).values({ ...input, tripId }).returning();
    return row;
  }

  listExpenses(tripId: number) {
    return this.db.select().from(expenses).where(eq(expenses.tripId, tripId)).orderBy(desc(expenses.createdAt));
  }

  async createExpense(tripId: number, input: CreateExpense) {
    await this.getTrip(tripId);
    const [row] = await this.db.insert(expenses).values({ ...input, tripId }).returning();
    return row;
  }

  listActivities(tripId: number) {
    return this.db.select().from(activities).where(eq(activities.tripId, tripId)).orderBy(desc(activities.createdAt));
  }

  async createActivity(tripId: number, input: CreateActivity) {
    await this.getTrip(tripId);
    const [row] = await this.db.insert(activities).values({ ...input, tripId }).returning();
    return row;
  }
}

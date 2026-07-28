import { z } from "zod";

export const createTripSchema = z.object({
  zaloGroupId: z.string().max(64).optional(),
  name: z.string().min(1),
  destination: z.string().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  status: z.enum(["planning", "confirmed", "done"]).default("planning")
});

export const createEventSchema = z.object({
  title: z.string().min(1),
  startsAt: z.coerce.date(),
  location: z.string().nullish(),
  createdBy: z.string().max(64).default("zino")
});

export const createExpenseSchema = z.object({
  title: z.string().min(1),
  amount: z.number().int().positive(),
  paidBy: z.string().min(1)
});

export const createActivitySchema = z.object({
  kind: z.enum(["suggestion", "booking", "reminder", "note"]),
  content: z.string().min(1)
});

export type CreateTrip = z.infer<typeof createTripSchema>;
export type CreateEvent = z.infer<typeof createEventSchema>;
export type CreateExpense = z.infer<typeof createExpenseSchema>;
export type CreateActivity = z.infer<typeof createActivitySchema>;

import { describe, expect, it } from "vitest";
import { createExpenseSchema, createTripSchema } from "./trips.dto";

describe("createTripSchema", () => {
  it("chấp nhận payload hợp lệ và coerce ngày", () => {
    const r = createTripSchema.parse({
      name: "Đà Lạt cuối tuần",
      destination: "Đà Lạt",
      startDate: "2026-08-01",
      endDate: "2026-08-03"
    });
    expect(r.status).toBe("planning");
    expect(r.startDate).toBeInstanceOf(Date);
  });
  it("từ chối thiếu destination", () => {
    expect(createTripSchema.safeParse({ name: "x", startDate: "2026-08-01", endDate: "2026-08-02" }).success).toBe(false);
  });
});

describe("createExpenseSchema", () => {
  it("từ chối amount âm", () => {
    expect(createExpenseSchema.safeParse({ title: "vé", amount: -1, paidBy: "Đông" }).success).toBe(false);
  });
});

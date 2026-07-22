import { describe, expect, it } from "vitest";
import { cn, splitEvenly } from "./utils";

describe("splitEvenly", () => {
  it("chia hết", () => {
    expect(splitEvenly(300_000, 3)).toEqual([100_000, 100_000, 100_000]);
  });
  it("dồn phần dư vào người đầu, tổng khớp từng đồng", () => {
    const parts = splitEvenly(100_000, 3);
    expect(parts).toEqual([33_334, 33_333, 33_333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100_000);
  });
  it("từ chối memberCount không hợp lệ", () => {
    expect(() => splitEvenly(1000, 0)).toThrow();
  });
});

describe("cn", () => {
  it("bỏ giá trị falsy", () => {
    expect(cn("a", false, undefined, "b")).toBe("a b");
  });
});

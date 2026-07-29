import { describe, expect, it } from "vitest";
import { pickTripId } from "./trip-select";

/** Thứ tự API trả về: mới nhất trước. 3 là chuyến demo, 1 là chuyến thật. */
const AVAILABLE = [3, 1];

describe("pickTripId", () => {
  it("URL có id hợp lệ thì URL thắng", () => {
    expect(pickTripId("1", null, AVAILABLE)).toBe(1);
  });

  it("không có gì cả thì lấy chuyến mới nhất", () => {
    expect(pickTripId(null, null, AVAILABLE)).toBe(3);
  });

  /**
   * Đây là bug đã lọt ra production: `<NavLink to="/itinerary">` dựng URL mới
   * không mang `?trip=`, nên mỗi lần chuyển tab là rơi về chuyến mới nhất —
   * đúng chuyến demo. Chọn chuyến 1 rồi chuyển tab phải vẫn là chuyến 1.
   */
  it("chuyển tab làm rơi ?trip= thì giữ lựa chọn gần nhất, KHÔNG rơi về chuyến mới nhất", () => {
    expect(pickTripId(null, 1, AVAILABLE)).toBe(1);
  });

  it("URL thắng cả lựa chọn gần nhất — link Zino gửi trong nhóm phải mở đúng chuyến", () => {
    expect(pickTripId("3", 1, AVAILABLE)).toBe(3);
  });

  it("id trên URL trỏ vào chuyến đã xoá thì bỏ qua, rơi về chuyến mới nhất", () => {
    expect(pickTripId("999", null, AVAILABLE)).toBe(3);
  });

  it("lựa chọn cũ trỏ vào chuyến đã xoá thì không kẹt lại", () => {
    expect(pickTripId(null, 999, AVAILABLE)).toBe(3);
  });

  it("URL hỏng thì rơi về lựa chọn gần nhất chứ không văng", () => {
    expect(pickTripId("abc", 1, AVAILABLE)).toBe(1);
    expect(pickTripId("", 1, AVAILABLE)).toBe(1);
  });

  it("chưa có chuyến nào thì trả null", () => {
    expect(pickTripId(null, null, [])).toBe(null);
    expect(pickTripId("1", 1, [])).toBe(null);
  });

  it("id âm hoặc số thập phân không khớp chuyến nào thì bỏ qua", () => {
    expect(pickTripId("-1", null, AVAILABLE)).toBe(3);
    expect(pickTripId("1.5", null, AVAILABLE)).toBe(3);
  });
});

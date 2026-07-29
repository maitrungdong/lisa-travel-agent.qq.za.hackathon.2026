import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { miniAppTripUrl, shareTripUrl } from "./miniapp-link";

const saved = { app: process.env.ZINO_MINIAPP_URL, base: process.env.PUBLIC_BASE_URL };

beforeEach(() => {
  delete process.env.ZINO_MINIAPP_URL;
  process.env.PUBLIC_BASE_URL = "https://zah-35.123c.vn";
});
afterEach(() => {
  process.env.ZINO_MINIAPP_URL = saved.app;
  process.env.PUBLIC_BASE_URL = saved.base;
});

describe("miniAppTripUrl", () => {
  it("luôn kèm ?trip= — thiếu nó là app mở chuyến mới nhất, không phải chuyến đang bàn", () => {
    process.env.ZINO_MINIAPP_URL = "https://zalo.me/s/126962352654603209/";
    expect(miniAppTripUrl(3)).toBe("https://zalo.me/s/126962352654603209/#/?trip=3");
  });

  it("không có dấu / ở cuối vẫn ra link mở được", () => {
    process.env.ZINO_MINIAPP_URL = "https://zalo.me/s/126962352654603209";
    expect(miniAppTripUrl(3)).toBe("https://zalo.me/s/126962352654603209#/?trip=3");
  });

  /**
   * Bản Mini App CHƯA DUYỆT có entry point riêng do Zalo cấp, và nó mang tham
   * số phiên bản ở query. Bản đầu của hàm này nối chuỗi thô nên ra
   * `...?version=5/#/?trip=3` — hash nằm sau query, link chết. Giữ test này
   * để không ai "đơn giản hoá" lại thành nối chuỗi.
   */
  it("GIỮ NGUYÊN query của link bản thử nghiệm, hash đặt sau query", () => {
    process.env.ZINO_MINIAPP_URL = "https://zalo.me/s/126962352654603209/?version=5";
    expect(miniAppTripUrl(3)).toBe("https://zalo.me/s/126962352654603209/?version=5#/?trip=3");

    process.env.ZINO_MINIAPP_URL = "https://zalo.me/s/126962352654603209/?env=TESTING&version=5";
    expect(miniAppTripUrl(3)).toBe(
      "https://zalo.me/s/126962352654603209/?env=TESTING&version=5#/?trip=3"
    );
  });

  it("link có sẵn hash thì hash bị thay, không cộng dồn", () => {
    process.env.ZINO_MINIAPP_URL = "https://zalo.me/s/123/#/gallery";
    expect(miniAppTripUrl(7)).toBe("https://zalo.me/s/123/#/?trip=7");
  });

  it("URL rác thì trả null — thà không có link còn hơn gửi link chết vào nhóm", () => {
    process.env.ZINO_MINIAPP_URL = "zalo.me/s/123";
    expect(miniAppTripUrl(3)).toBe(null);
    process.env.ZINO_MINIAPP_URL = "khong-phai-url";
    expect(miniAppTripUrl(3)).toBe(null);
  });

  /**
   * Đây là lỗi đã sống trên production: biến có trong docker-compose nhưng
   * không có trong .env.example nên nó rỗng, và mọi link đều lặng lẽ rơi về
   * trang tổng kết. Trả `null` để chỗ gọi phải xử lý tường minh.
   */
  it("chưa cấu hình thì trả null, không dựng link rác", () => {
    expect(miniAppTripUrl(3)).toBe(null);
    process.env.ZINO_MINIAPP_URL = "   ";
    expect(miniAppTripUrl(3)).toBe(null);
  });
});

describe("shareTripUrl", () => {
  it("có Mini App thì ưu tiên Mini App", () => {
    process.env.ZINO_MINIAPP_URL = "https://zalo.me/s/123/";
    expect(shareTripUrl(7)).toBe("https://zalo.me/s/123/#/?trip=7");
  });

  it("chưa cấu hình thì rơi về trang tổng kết — VÀ vẫn đúng id chuyến", () => {
    expect(shareTripUrl(7)).toBe("https://zah-35.123c.vn/api/trips/7/recap.html");
  });
});

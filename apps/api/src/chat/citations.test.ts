import { describe, expect, it } from "vitest";
import { collectCitations } from "./citations";

/**
 * Khối trả về của web search có hình dạng do API quyết, không do mình — nên các
 * test ở đây chủ yếu là về việc ĐỌC PHÒNG THỦ. Một khối lạ làm hàm này ném lỗi
 * thì hỏng cả câu trả lời, chỉ vì phần trang trí nguồn.
 */
describe("collectCitations", () => {
  it("gộp cả kết quả tìm lẫn trích dẫn trên khối text, khử trùng theo URL", () => {
    const content = [
      { type: "server_tool_use", name: "web_search", input: { query: "khách sạn nha trang" } },
      {
        type: "web_search_tool_result",
        content: [
          { type: "web_search_result", url: "https://a.vn/1", title: "A" },
          { type: "web_search_result", url: "https://b.vn/2", title: "B" }
        ]
      },
      {
        type: "text",
        text: "...",
        citations: [
          { type: "web_search_result_location", url: "https://a.vn/1", title: "A" },
          { type: "web_search_result_location", url: "https://c.vn/3", title: "C" }
        ]
      }
    ];
    expect(collectCitations(content).map((x) => x.url)).toEqual([
      "https://a.vn/1",
      "https://b.vn/2",
      "https://c.vn/3"
    ]);
  });

  it("khối lỗi và hình dạng lạ thì bỏ qua, KHÔNG được ném", () => {
    expect(
      collectCitations([
        null,
        "rác",
        42,
        {
          type: "web_search_tool_result",
          content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" }
        },
        // Chỉ nhận http(s) — ftp: lọt vào thẻ <a> là chuyện không nên có
        { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "ftp://x/1" }] },
        { type: "text", text: "không có citations" }
      ])
    ).toEqual([]);
  });

  it("thiếu title thì lấy URL làm tên, đừng để dòng nguồn trống trơn", () => {
    const r = collectCitations([
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://a.vn/1" }] }
    ]);
    expect(r[0].title).toBe("https://a.vn/1");
  });

  it("không có khối web nào thì trả mảng rỗng", () => {
    expect(collectCitations([{ type: "text", text: "chào bạn" }])).toEqual([]);
  });
});

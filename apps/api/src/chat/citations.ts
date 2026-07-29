/**
 * Rút nguồn web từ khối trả về của model.
 *
 * Hai chỗ có nguồn, và phải lấy cả hai: `web_search_tool_result` là danh sách
 * kết quả tìm được, còn `citations` gắn trên khối text là những trang model
 * THẬT SỰ trích dẫn. Chỉ lấy loại sau thì bỏ sót trường hợp model đọc xong
 * nhưng viết lại bằng lời mình; chỉ lấy loại đầu thì hiện cả trang nó lướt qua
 * rồi bỏ. Gộp cả hai rồi khử trùng theo URL.
 *
 * Kiểu của SDK cho khối server tool khá lỏng nên ở đây đọc phòng thủ: sai hình
 * dạng thì bỏ qua chứ không được ném lỗi làm hỏng cả câu trả lời.
 */
export function collectCitations(content: unknown[]): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  const push = (url: unknown, title: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    if (out.some((x) => x.url === url)) return;
    out.push({ url, title: typeof title === "string" && title.trim() ? title : url });
  };

  for (const raw of content) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;

    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) {
        if (r && typeof r === "object") {
          const rr = r as Record<string, unknown>;
          if (rr.type === "web_search_result") push(rr.url, rr.title);
        }
      }
    }

    if (b.type === "text" && Array.isArray(b.citations)) {
      for (const c of b.citations) {
        if (c && typeof c === "object") {
          const cc = c as Record<string, unknown>;
          push(cc.url, cc.title);
        }
      }
    }
  }
  return out;
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./app.css";

/**
 * Tìm hoặc TỰ TẠO phần tử gốc.
 *
 * `zmp deploy --existing` phục vụ HTML shell của riêng Zalo, không dùng
 * index.html do Vite sinh ra — nên `<div id="root">` không tồn tại và
 * createRoot(null) ném React error #299 (màn trắng, không có gợi ý gì).
 *
 * Tự tạo thì chạy đúng ở cả hai môi trường: shell của Zalo lẫn `vite dev`
 * ở máy (lúc đó phần tử đã có sẵn nên nhánh tạo mới không chạy).
 */
function getRootElement(): HTMLElement {
  const existing = document.getElementById("root");
  if (existing) return existing;

  const created = document.createElement("div");
  created.id = "root";
  document.body.appendChild(created);
  return created;
}

createRoot(getRootElement()).render(
  <StrictMode>
    <App />
  </StrictMode>
);

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Zalo phục vụ bundle từ CDN dưới sub-path (h5.zdn.vn/zapps/<id>/...)
// nên base phải là tương đối. outDir "www" là thư mục zmp-cli upload.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "www",
    // `zmp deploy --existing` nạp asset theo danh sách khai trong app-config.json
    // (listSyncJS / listCSS) chứ không đọc index.html. Hai hệ quả:
    //
    //  1. Tên file phải CỐ ĐỊNH — hash của Vite đổi mỗi lần build thì
    //     app-config.json lệch ngay, và lỗi chỉ lộ ra lúc deploy.
    //  2. Phải là IIFE một file — zmp chèn bằng thẻ <script> thường, không có
    //     type="module", nên bundle ESM sẽ chết ngay khi nạp.
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/app.js",
        assetFileNames: "assets/app.[ext]"
      }
    }
  }
});

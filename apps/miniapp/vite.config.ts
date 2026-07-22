import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Zalo phục vụ bundle từ CDN dưới sub-path (h5.zdn.vn/zapps/<id>/...)
// nên base phải là tương đối. outDir "www" là thư mục zmp-cli upload.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { outDir: "www" }
});

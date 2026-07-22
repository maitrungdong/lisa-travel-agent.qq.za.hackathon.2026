import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/**/src/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["apps/**/src/**/*.ts"],
      exclude: ["**/*.d.ts", "**/main.ts", "**/*.module.ts"]
    }
  }
});

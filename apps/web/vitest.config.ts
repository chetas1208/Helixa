import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Agent E vitest config. Default environment is `node`; component tests opt into the DOM with
 * `// @vitest-environment jsdom` at the top of the file. Playwright specs live in e2e/ and are excluded.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    testTimeout: 15_000,
    setupFiles: [],
  },
});

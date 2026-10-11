import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Vite config used ONLY by the V12 e2e harness: same app (react plugin + "@" alias), but its own port (E2E_WEB_PORT,
 * default 5303) and the /api proxy aimed at the throwaway e2e backend (E2E_API_PORT, default 8303) so nothing touches
 * the user's servers (:5173 / :8000) or other agents' ports (8301/8302/5301/5302). Mirrors vite.config.ts; keep in sync
 * if that file gains plugins/aliases.
 */
const apiPort = process.env.E2E_API_PORT ?? "8303";
const webPort = Number(process.env.E2E_WEB_PORT ?? 5303);
/**
 * The API only accepts non-GET requests whose Origin is http://127.0.0.1:5173 (services/api/app/main.py). The e2e/demo
 * servers run on other ports, so the proxy presents the allowed Origin. This is a harness-only workaround: the browser
 * still talks same-origin to the proxy, and the backend policy itself is untouched.
 */
const proxy: Record<string, ProxyOptions> = {
  "/api": {
    target: `http://127.0.0.1:${apiPort}`,
    changeOrigin: true,
    configure: (p) =>
      p.on("proxyReq", (proxyReq) => {
        if (proxyReq.getHeader("origin")) proxyReq.setHeader("origin", "http://127.0.0.1:5173");
      }),
  },
};

export default defineConfig({
  root: path.resolve(__dirname, ".."),
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "../src") } },
  build: { outDir: process.env.E2E_DIST ?? "/tmp/v12_e_dist", emptyOutDir: true },
  preview: { host: "127.0.0.1", port: webPort, strictPort: true, proxy },
  server: { host: "127.0.0.1", port: webPort, strictPort: true, proxy },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        // The backend only accepts state-changing requests from the canonical dev origin.
        // Dev servers on other ports present that origin; the browser still talks same-origin to Vite.
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            if (proxyReq.getHeader("origin")) proxyReq.setHeader("origin", "http://127.0.0.1:5173");
          });
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "node",
  },
});

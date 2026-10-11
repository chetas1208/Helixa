import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * V12 Playwright config (Agent E).
 *
 * Hardware reality: this machine has no GPU. Chromium runs the cached headless_shell build with SwiftShader
 * (software WebGL). Every FPS / frame-time number produced here is SOFTWARE RENDERED and says nothing about
 * a real GPU. Override the browser with E2E_CHROMIUM / E2E_LD_LIBRARY_PATH on other machines.
 *
 * Projects:
 *  - mocked : route-intercepted contract tests (no backend involved). Reported as MOCKED.
 *  - real   : integrated tests against the live FastAPI backend (throwaway state). Reported as REAL.
 *  - visual : viewport matrix + axe + perf + privacy (real backend). Reported as REAL.
 */
const REPO = path.resolve(__dirname, "../..");

// Serve the PRODUCTION build (not the dev server) so concurrent source edits cannot hot-reload the page mid-test and
// measurements reflect the shipped bundle. Built once per run (workers inherit E2E_BUILT). E2E_DEV=1 uses the dev server;
// E2E_SKIP_BUILD=1 reuses /tmp/v12_e_dist as is.
if (!process.env.E2E_DEV && !process.env.E2E_SKIP_BUILD && !process.env.E2E_BUILT) {
  const t0 = Date.now();
  execFileSync("npx", ["vite", "build", "--config", "e2e/vite.e2e.config.ts", "--logLevel", "error"], { cwd: __dirname, stdio: "inherit" });
  process.env.E2E_BUILT = "1";
  console.log(`[e2e] production build refreshed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
// Agent E's own ports. Never 5173/8000 (the user's live servers on the REAL store) nor 8301/8302/5301/5302 (agents C, D).
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5303);
const API_PORT = Number(process.env.E2E_API_PORT ?? 8303);
if ([8000, 5173].includes(API_PORT) || [8000, 5173].includes(WEB_PORT)) throw new Error("e2e must not use the user's live ports 8000/5173");

export const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
export const API_URL = `http://127.0.0.1:${API_PORT}`;

const chromium =
  process.env.E2E_CHROMIUM ??
  "/home/923873155/.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell";
const libs =
  process.env.E2E_LD_LIBRARY_PATH ??
  "/tmp/claude-1989081997/libs/x/usr/lib/x86_64-linux-gnu:/home/923873155/.local/beatit-libs/root/usr/lib/x86_64-linux-gnu";

export default defineConfig({
  testDir: "./e2e",
  outputDir: path.join(REPO, "artifacts/frontend/v12/playwright-output"),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: false,
  reporter: [
    ["list"],
    ["json", { outputFile: process.env.PW_JSON_OUT ?? path.join(REPO, "artifacts/frontend/v12/playwright-results.json") }],
  ],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    trace: "off",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    launchOptions: {
      executablePath: chromium,
      env: { ...process.env, LD_LIBRARY_PATH: libs } as Record<string, string>,
      args: [
        "--use-gl=swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader",
        "--no-sandbox",
      ],
    },
  },
  projects: [
    { name: "mocked", testDir: "./e2e/mocked" },
    { name: "real", testDir: "./e2e/real" },
    { name: "visual", testDir: "./e2e/visual", timeout: 240_000 },
  ],
  webServer: [
    {
      // Throwaway backend: never points at artifacts/v10/state.json.
      command: `${REPO}/.venv/bin/uvicorn services.api.app.main:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: REPO,
      url: `${API_URL}/api/health`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        ...(process.env as Record<string, string>),
        MONGODB_DATABASE: "diamond_v12_e",
        V10_STATE_PATH: process.env.E2E_STATE_PATH ?? "/tmp/v12_e_state.json",
      },
    },
    {
      // Default: serve the PRODUCTION build (rebuilt by e2e/global-setup.ts) so concurrent source edits cannot hot-reload
      // the page mid-test and so measurements reflect the shipped bundle. E2E_DEV=1 serves the dev server instead.
      command: process.env.E2E_DEV ? `npx vite --config e2e/vite.e2e.config.ts` : `npx vite preview --config e2e/vite.e2e.config.ts`,
      cwd: __dirname,
      url: BASE_URL,
      reuseExistingServer: true,
      timeout: 90_000,
      env: { ...(process.env as Record<string, string>), E2E_API_PORT: String(API_PORT), E2E_WEB_PORT: String(WEB_PORT) },
    },
  ],
});

import { defineConfig } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(__dirname, "../..");
const REPO = path.resolve(WEB, "../..");

const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5145);
const API_PORT = Number(process.env.E2E_API_PORT ?? 8145);
if ([8000, 5173].includes(API_PORT) || [8000, 5173].includes(WEB_PORT)) {
  throw new Error("V14 e2e must not use the user's live ports 8000/5173");
}

if (!process.env.E2E_DEV && !process.env.E2E_SKIP_BUILD && !process.env.E2E_BUILT) {
  execFileSync("npx", ["vite", "build", "--config", "e2e/vite.e2e.config.ts", "--logLevel", "error"], {
    cwd: WEB,
    stdio: "inherit",
    env: { ...process.env, E2E_DIST: process.env.E2E_DIST ?? "/tmp/v14_e2e_dist" },
  });
  process.env.E2E_BUILT = "1";
}

export const BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
export const API_URL = `http://127.0.0.1:${API_PORT}`;

const chromium =
  process.env.E2E_CHROMIUM ??
  "/home/923873155/.cache/ms-playwright/chromium_headless_shell-1161/chrome-linux/headless_shell";
const libs =
  process.env.E2E_LD_LIBRARY_PATH ??
  "/tmp/claude-1989081997/libs/x/usr/lib/x86_64-linux-gnu:/home/923873155/.local/beatit-libs/root/usr/lib/x86_64-linux-gnu";

export default defineConfig({
  testDir: ".",
  outputDir: path.join(REPO, "artifacts/milestones/v14/playwright-output"),
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: process.env.PW_JSON_OUT ?? path.join(REPO, "artifacts/milestones/v14/playwright.json") }],
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
  projects: [{ name: "v14" }],
  webServer: [
    {
      command: `${REPO}/.venv/bin/uvicorn services.api.app.main:app --host 127.0.0.1 --port ${API_PORT}`,
      cwd: REPO,
      url: `${API_URL}/api/health`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: {
        ...(process.env as Record<string, string>),
        MONGODB_DATABASE: "diamond_v14_e2e",
        V10_STATE_PATH: process.env.V10_STATE_PATH ?? process.env.E2E_STATE_PATH ?? "/tmp/v14_e2e/state.json",
      },
    },
    {
      command: process.env.E2E_DEV
        ? `npx vite --config e2e/vite.e2e.config.ts`
        : `npx vite preview --config e2e/vite.e2e.config.ts`,
      cwd: WEB,
      url: BASE_URL,
      reuseExistingServer: true,
      timeout: 90_000,
      env: {
        ...(process.env as Record<string, string>),
        E2E_API_PORT: String(API_PORT),
        E2E_WEB_PORT: String(WEB_PORT),
        E2E_DIST: process.env.E2E_DIST ?? "/tmp/v14_e2e_dist",
      },
    },
  ],
});

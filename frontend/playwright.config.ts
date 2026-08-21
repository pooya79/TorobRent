import { defineConfig } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;
const baseURL = externalBaseUrl ?? "http://127.0.0.1:5173";
const backendPort = process.env.E2E_BACKEND_PORT ?? "8010";
const backendUrl = `http://127.0.0.1:${backendPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  grepInvert: process.env.CAPTURE_DESIGN ? undefined : /@visual/,
  use: {
    baseURL,
    trace: "on-first-retry",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: externalBaseUrl
    ? undefined
    : [
        {
          command: `cd ../backend && DJANGO_SETTINGS_MODULE=config.settings.test uv run uvicorn config.asgi:application --host 127.0.0.1 --port ${backendPort}`,
          url: `${backendUrl}/api/v1/system/ready/`,
          reuseExistingServer: !process.env.CI,
        },
        {
          command: `VITE_PROXY_TARGET=${backendUrl} pnpm dev`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
        },
      ],
});

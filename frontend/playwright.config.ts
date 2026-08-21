import { defineConfig } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;
const baseURL = externalBaseUrl ?? "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./tests/e2e",
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
          command:
            "cd ../backend && DJANGO_SETTINGS_MODULE=config.settings.test uv run uvicorn config.asgi:application --host 127.0.0.1 --port 8000",
          url: "http://127.0.0.1:8000/api/v1/system/ready/",
          reuseExistingServer: !process.env.CI,
        },
        {
          command: "pnpm dev",
          url: baseURL,
          reuseExistingServer: !process.env.CI,
        },
      ],
});

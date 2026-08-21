import { defineConfig } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;
const frontendPort = process.env.E2E_FRONTEND_PORT ?? "5173";
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${frontendPort}`;
const backendPort = process.env.E2E_BACKEND_PORT ?? "8010";
const backendUrl = `http://127.0.0.1:${backendPort}`;
const isolatedDatabaseUrl = `sqlite:////tmp/torobrent-playwright-${backendPort}-${process.pid}.sqlite3`;

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
          command: `cd ../backend && DJANGO_SETTINGS_MODULE=config.settings.test TEST_DATABASE_URL=${isolatedDatabaseUrl} CSRF_TRUSTED_ORIGINS=${baseURL} DJANGO_SUPERUSER_EMAIL=operator@example.com DJANGO_SUPERUSER_PASSWORD=operator-password sh -c "uv run python manage.py migrate --noinput && uv run python manage.py loaddata catalog_seed && uv run python manage.py createsuperuser --noinput && exec uv run uvicorn config.asgi:application --host 127.0.0.1 --port ${backendPort}"`,
          url: `${backendUrl}/api/v1/system/ready/`,
          reuseExistingServer: !process.env.CI,
        },
        {
          command: `VITE_PROXY_TARGET=${backendUrl} pnpm dev --port ${frontendPort}`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
        },
      ],
});

import { defineConfig } from "@playwright/test";

const externalBaseUrl = process.env.E2E_BASE_URL;
const frontendPort = process.env.E2E_FRONTEND_PORT ?? "5173";
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${frontendPort}`;
const backendPort = process.env.E2E_BACKEND_PORT ?? "8010";
const backendUrl = `http://127.0.0.1:${backendPort}`;
const isolatedDatabaseUrl = `sqlite:////tmp/torobrent-playwright-${backendPort}-${process.pid}.sqlite3`;
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const seedCommand =
  process.env.CAPTURE_DESIGN || process.env.E2E_SEED_DEMO
    ? "seed_demo"
    : "loaddata catalog_seed";

export default defineConfig({
  testDir: "./tests/e2e",
  grepInvert: process.env.CAPTURE_DESIGN ? undefined : /@visual/,
  workers: externalBaseUrl ? undefined : 1,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: { executablePath: chromiumExecutable },
      },
    },
    {
      name: "firefox",
      grep: /@cross-browser/,
      use: { browserName: "firefox" },
    },
    {
      name: "webkit",
      grep: /@cross-browser/,
      use: { browserName: "webkit" },
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : [
        {
          command: `cd ../backend && export DJANGO_SETTINGS_MODULE=config.settings.test TEST_DATABASE_URL=${isolatedDatabaseUrl} CSRF_TRUSTED_ORIGINS=${baseURL} DJANGO_SUPERUSER_EMAIL=operator@example.com DJANGO_SUPERUSER_PASSWORD=operator-password && uv run python manage.py migrate --noinput && uv run python manage.py ${seedCommand} && uv run python manage.py createsuperuser --noinput && uv run python manage.py shell -c 'from django.utils import timezone; from apps.accounts.models import User; User.objects.filter(email="operator@example.com").update(email_verified_at=timezone.now())' && exec uv run uvicorn config.asgi:application --host 127.0.0.1 --port ${backendPort}`,
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

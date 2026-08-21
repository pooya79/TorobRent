import { expect, test } from "@playwright/test";

test("loads the application shell", async ({ page }) => {
  await page.route("**/api/v1/auth/session/", async (route) => {
    await route.fulfill({ json: { authenticated: false, csrf_token: "test" } });
  });
  await page.route("**/api/v1/system/ready/", async (route) => {
    await route.fulfill({ json: { status: "ok" } });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /TorobRent/i })).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
});

import { expect, test } from "@playwright/test";

test("serves a meaningful Persian document before hydration", async ({
  request,
}) => {
  const response = await request.get("/");
  const html = await response.text();

  expect(response.ok()).toBe(true);
  expect(html).toContain('<html lang="fa" dir="rtl"');
  expect(html).toContain("خانه‌ای برای اجاره پیدا کنید");
  expect(html).toContain("شهر یا محله");
});

test("hydrates the application shell and reports API health", async ({
  page,
}) => {
  let readinessAttempts = 0;
  await page.route("**/api/v1/system/ready/", async (route) => {
    readinessAttempts += 1;
    if (readinessAttempts <= 2) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ status: "unavailable" }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "خانه‌ای برای اجاره پیدا کنید" }),
  ).toBeVisible();
  await expect(page.getByText("سامانه در دسترس است")).toBeVisible({
    timeout: 10_000,
  });
  expect(readinessAttempts).toBe(3);

  const navigation = page.getByRole("navigation", { name: "راهبری اصلی" });
  for (const name of ["خانه", "راهنما", "تماس", "ورود", "ثبت آگهی"]) {
    await expect(navigation.getByRole("link", { name })).toBeVisible();
  }
});

test("keeps navigation usable on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "راهبری اصلی" });
  for (const name of ["خانه", "راهنما", "تماس", "ورود", "ثبت آگهی"]) {
    await expect(navigation.getByRole("link", { name })).toBeVisible();
  }

  const documentWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(documentWidth).toBeLessThanOrEqual(390);
  await page.getByRole("searchbox", { name: "شهر یا محله" }).focus();
  await expect(
    page.getByRole("searchbox", { name: "شهر یا محله" }),
  ).toBeFocused();

  await navigation.getByRole("link", { name: "راهنما" }).click();
  await expect(page.getByRole("main")).toBeFocused();
  await expect(
    page.getByRole("navigation", { name: "راهبری اصلی" }),
  ).toBeVisible();
});

test("routes the versioned Django health API through the same origin", async ({
  request,
}) => {
  const response = await request.get("/api/v1/system/ready/");

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});

test("renders a Persian failure boundary", async ({ request }) => {
  const response = await request.get("/missing-page");
  const html = await response.text();

  expect(response.status()).toBe(404);
  expect(html).toContain("این صفحه پیدا نشد");
  expect(html).toContain("بازگشت به خانه");
  expect(html).toContain("<title>صفحه پیدا نشد | ترب‌رنت</title>");
  expect(html).toContain('name="description"');
});

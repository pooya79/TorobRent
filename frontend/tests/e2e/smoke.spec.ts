import { expect, test } from "@playwright/test";

test("@milestone @cross-browser serves a meaningful Persian document before hydration", async ({
  request,
}) => {
  const response = await request.get("/");
  const html = await response.text();

  expect(response.ok()).toBe(true);
  expect(html).toContain('<html lang="fa" dir="rtl"');
  expect(html).toContain("اجارهٔ ملک مسکونی و تجاری در تهران");
  expect(html).toContain("شهر");
});

test("@milestone @cross-browser hydrates the application shell and reports API health", async ({
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
    page.getByRole("heading", {
      name: "اجارهٔ ملک مسکونی و تجاری در تهران",
    }),
  ).toBeVisible();
  await expect(page.getByText("سامانه در دسترس است")).toBeVisible({
    timeout: 10_000,
  });
  expect(readinessAttempts).toBe(3);

  const navigation = page.getByRole("navigation", { name: "راهبری اصلی" });
  for (const name of [
    "خانه",
    "راهنما",
    "تماس",
    "ورود",
    "ثبت‌نام",
    "می‌خواهم آگهی ثبت کنم",
  ]) {
    await expect(navigation.getByRole("link", { name })).toBeVisible();
  }
  await expect(
    page.getByRole("banner", { name: "راهبری عمومی" }),
  ).toBeVisible();
});

test("@milestone @cross-browser keeps navigation usable on a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("سامانه در دسترس است")).toBeVisible({
    timeout: 10_000,
  });

  const documentWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(documentWidth).toBeLessThanOrEqual(390);
  const city = page.getByRole("combobox", { name: "شهر" });
  await city.focus();
  await expect(page.getByRole("option", { name: "تهران" })).toBeVisible();
  await city.press("ArrowDown");
  await city.press("Enter");
  await expect(city).toHaveValue("تهران");

  const menuTrigger = page.getByRole("button", {
    name: "باز کردن فهرست راهبری",
  });
  await menuTrigger.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "راهبری ترب‌رنت" }),
  ).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "راهبری اصلی" });
  for (const name of [
    "خانه",
    "راهنما",
    "تماس",
    "ورود",
    "ثبت‌نام",
    "می‌خواهم آگهی ثبت کنم",
  ]) {
    await expect(navigation.getByRole("link", { name })).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(menuTrigger).toBeFocused();
  await menuTrigger.click();

  await navigation.getByRole("link", { name: "راهنما" }).click();
  await expect(page.getByRole("main")).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "راهنمای ترب‌رنت" }),
  ).toBeVisible();
});

test("@milestone @cross-browser exposes the public fixture-backed prototype routes", async ({
  page,
}) => {
  const routes = [
    ["/", "اجارهٔ ملک مسکونی و تجاری در تهران"],
    ["/search", "ملک‌های اجاره‌ای در تهران"],
    ["/advertise", "ثبت آگهی در ترب‌رنت"],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: heading, level: 1 }),
    ).toBeVisible();
  }
});

test("@milestone @cross-browser redirects anonymous Operator access to login", async ({
  page,
}) => {
  await page.goto("/operator/submissions");

  await expect(page).toHaveURL(/\/login\?returnTo=%2Foperator%2Fsubmissions$/);
  await expect(
    page.getByRole("heading", { name: "ورود به ترب‌رنت" }),
  ).toBeVisible();
});

test("@milestone @cross-browser preserves protected Submitter navigation across login", async ({
  page,
}) => {
  await page.goto("/add-submission?step=3");

  await expect(page).toHaveURL(
    /\/login\?returnTo=%2Fadd-submission%3Fstep%3D3$/,
  );
  await expect(
    page.getByRole("heading", { name: "ورود به ترب‌رنت" }),
  ).toBeVisible();
});

test("@milestone @cross-browser keeps focus inside the mobile filter Sheet and restores it on close", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/search");
  await expect(page.getByText("سامانه در دسترس است")).toBeVisible({
    timeout: 10_000,
  });

  const trigger = page.getByRole("button", { name: "فیلترهای پیشرفته" });
  const restingIndicator = await trigger.evaluate((element) => {
    const style = getComputedStyle(element);
    return `${style.outlineStyle}|${style.outlineWidth}|${style.boxShadow}`;
  });
  await trigger.click();
  await expect(
    page.getByRole("dialog", { name: "فیلترهای پیشرفته" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  const focusedIndicator = await trigger.evaluate((element) => {
    const style = getComputedStyle(element);
    return `${style.outlineStyle}|${style.outlineWidth}|${style.boxShadow}`;
  });
  expect(focusedIndicator).not.toBe(restingIndicator);
});

test("@milestone @cross-browser routes the versioned Django health API through the same origin", async ({
  request,
}) => {
  const response = await request.get("/api/v1/system/ready/");

  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({ status: "ok" });
});

test("@milestone @cross-browser renders a Persian failure boundary", async ({
  request,
}) => {
  const response = await request.get("/missing-page");
  const html = await response.text();

  expect(response.status()).toBe(404);
  expect(html).toContain("این صفحه پیدا نشد");
  expect(html).toContain("بازگشت به خانه");
  expect(html).toContain("<title>صفحه پیدا نشد | ترب‌رنت</title>");
  expect(html).toContain('name="description"');
});

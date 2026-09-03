import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

import { initializeTheme } from "./helpers/theme";

const publicRoutes = [
  "/",
  "/search",
  "/about",
  "/guide",
  "/contact",
  "/privacy",
  "/terms",
  "/advertise",
] as const;

async function chooseTheme(
  page: Page,
  currentLabel: string,
  nextLabel: string,
) {
  await page
    .getByRole("combobox", { name: `پوسته نمایش: ${currentLabel}` })
    .click();
  await page.getByRole("option", { name: nextLabel }).click();
}

test("serves Persian SSR and failure documents before hydration", async ({
  request,
}) => {
  const home = await request.get("/");
  const homeHtml = await home.text();

  expect(home.ok()).toBe(true);
  expect(homeHtml).toContain('<html lang="fa" dir="rtl"');
  expect(homeHtml).toContain("اجاره ملک مسکونی و تجاری در تهران");

  const missing = await request.get("/missing-page");
  const missingHtml = await missing.text();

  expect(missing.status()).toBe(404);
  expect(missingHtml).toContain("این صفحه پیدا نشد");
  expect(missingHtml).toContain("<title>صفحه پیدا نشد | ترب‌رنت</title>");
});

test("hydrates the shell and reaches Django through the same origin", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "اجاره ملک مسکونی و تجاری در تهران",
    }),
  ).toBeVisible();
  await expect(page.getByText("سامانه در دسترس است")).toBeVisible({
    timeout: 10_000,
  });

  const readiness = await request.get("/api/v1/system/ready/");
  expect(readiness.ok()).toBe(true);
  await expect(readiness.json()).resolves.toEqual({ status: "ok" });
});

test("restores protected Operator navigation after login", async ({ page }) => {
  await page.goto("/operator/submissions");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Foperator%2Fsubmissions$/);

  await page.getByLabel("ایمیل یا شماره تلفن").fill("operator@example.com");
  await page.getByLabel("گذرواژه").fill("operator-password");
  await page.getByRole("button", { name: "ورود" }).click();

  await expect(page).toHaveURL(/\/operator\/submissions$/);
  await expect(
    page.getByRole("heading", { name: "بررسی آگهی‌ها" }),
  ).toBeVisible();
});

test("restores protected Contact Support composition after login", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/contact");
  await page.getByRole("link", { name: "ایجاد درخواست پشتیبانی" }).click();
  await expect(page).toHaveURL(
    /\/login\?returnTo=%2Fmessages%2Fnew%2Fsupport$/,
  );

  await page.getByLabel("ایمیل یا شماره تلفن").fill("operator@example.com");
  await page.getByLabel("گذرواژه").fill("operator-password");
  await page.getByRole("button", { name: "ورود" }).click();

  await expect(page).toHaveURL(/\/messages\/new\/support$/);
  await expect(
    page.getByRole("heading", { name: "درخواست پشتیبانی جدید" }),
  ).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("dir", "rtl");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("keeps the mobile layout contained and restores visible focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/search");
  await expect(
    page.getByRole("heading", { name: "ملک‌های اجاره‌ای در تهران" }),
  ).toBeVisible({ timeout: 10_000 });

  const documentWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(documentWidth).toBeLessThanOrEqual(390);

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

test("applies an explicit theme before hydration", async ({ page }) => {
  await initializeTheme(page, "dark");
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") {
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    )
    .toBe("rgb(18, 18, 20)");
});

test("persists an explicit theme across reloads and tabs", async ({
  context,
  page,
}) => {
  await page.goto("/");
  await chooseTheme(page, "سیستم", "تیره");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const secondPage = await context.newPage();
  await secondPage.goto("/");
  await expect(secondPage.locator("html")).toHaveAttribute(
    "data-theme",
    "dark",
  );

  await chooseTheme(page, "تیره", "روشن");
  await expect(secondPage.locator("html")).toHaveAttribute(
    "data-theme",
    "light",
  );
  await secondPage.close();
});

test("keeps public routes accessible with reduced motion", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const route of publicRoutes) {
    await page.goto(route);
    await expect(page.locator("#main-content")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("main h1")).toHaveCount(1);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations, route).toEqual([]);
  }

  const motion = await page.evaluate(() => {
    const htmlStyle = getComputedStyle(document.documentElement);
    const buttonStyle = getComputedStyle(document.querySelector("button")!);
    return {
      scrollBehavior: htmlStyle.scrollBehavior,
      transitionDuration: buttonStyle.transitionDuration,
    };
  });
  expect(motion.scrollBehavior).toBe("auto");
  expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(
    0.001,
  );
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false, colorScheme: "dark" });

  test("falls back to the operating-system theme", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      )
      .toBe("rgb(18, 18, 20)");
  });
});

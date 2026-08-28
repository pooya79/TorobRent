import { expect, type Page, test } from "@playwright/test";

import {
  initializeTheme,
  themeStorageKey,
  type ExplicitTheme,
} from "./helpers/theme";

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

test("@milestone restores explicit dark styling before hydration", async ({
  page,
}) => {
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
  await expect(
    page.getByRole("heading", {
      name: "اجاره ملک مسکونی و تجاری در تهران",
    }),
  ).toBeVisible();
});

test("@milestone explicit preference survives a real page reload", async ({
  page,
}) => {
  await page.goto("/");
  await chooseTheme(page, "سیستم", "تیره");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("combobox", { name: "پوسته نمایش: تیره" }),
  ).toBeVisible();
});

test("@milestone explicit preference synchronizes across real tabs", async ({
  context,
  page,
}) => {
  const secondPage = await context.newPage();
  await page.goto("/");
  await secondPage.goto("/");

  await chooseTheme(page, "سیستم", "تیره");

  await expect(secondPage.locator("html")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await expect(
    secondPage.getByRole("combobox", { name: "پوسته نمایش: تیره" }),
  ).toBeVisible();
  await secondPage.close();
});

test("@milestone System theme follows operating-system changes", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    )
    .toBe("rgb(255, 255, 255)");

  await page.emulateMedia({ colorScheme: "dark" });

  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    )
    .toBe("rgb(18, 18, 20)");
  await expect(
    page.locator('meta[name="theme-color"]').first(),
  ).toHaveAttribute("content", "#121214");
});

for (const theme of [
  "light",
  "dark",
] as const satisfies readonly ExplicitTheme[]) {
  test(`fixed ${theme} preference ignores operating-system changes`, async ({
    page,
  }) => {
    const oppositeSystemTheme = theme === "light" ? "dark" : "light";
    await initializeTheme(page, theme);
    await page.emulateMedia({ colorScheme: oppositeSystemTheme });
    await page.goto("/");

    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  });
}

test("invalid stored preference falls back to System", async ({ page }) => {
  await page.addInitScript(
    ({ key }) => window.localStorage.setItem(key, "invalid"),
    { key: themeStorageKey },
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await expect(
    page.getByRole("combobox", { name: "پوسته نمایش: سیستم" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    )
    .toBe("rgb(18, 18, 20)");
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

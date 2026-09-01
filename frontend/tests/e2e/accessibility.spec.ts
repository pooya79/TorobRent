import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator } from "@playwright/test";

import {
  canonicalSurfaces,
  initializeTheme,
  loginDemoOperator,
} from "./helpers/theme";

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
const demoSeedAvailable = Boolean(process.env.E2E_SEED_DEMO);

async function expectVisibleKeyboardFocus(locator: Locator) {
  await expect(locator).toBeFocused();
  const hasVisibleIndicator = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return (
      (style.outlineStyle !== "none" &&
        Number.parseFloat(style.outlineWidth) > 0) ||
      style.boxShadow !== "none"
    );
  });
  expect(hasVisibleIndicator).toBe(true);
}

test("@a11y public home interactions are keyboard operable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("سامانه در دسترس است")).toBeVisible();

  const navigationTrigger = page.getByRole("button", {
    name: "باز کردن فهرست راهبری",
  });
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "رفتن به محتوای اصلی" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "ترب‌رنت، خانه" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("combobox", { name: /پوسته نمایش/ }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(navigationTrigger);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(navigationTrigger).toBeFocused();

  const cityInput = page.getByRole("combobox", { name: "شهر" });
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(cityInput);
  await expect(page.getByRole("option", { name: "تهران" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(cityInput).toHaveValue("تهران");

  const propertyTypeTrigger = page.getByRole("button", { name: "همه ملک‌ها" });
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(propertyTypeTrigger);
  await page.keyboard.press("Enter");
  const apartment = page.getByRole("checkbox", { name: "آپارتمان" });
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("checkbox", { name: "همه ملک‌ها" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("checkbox", { name: "مسکونی" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expectVisibleKeyboardFocus(apartment);
  await page.keyboard.press("Space");
  await expect(apartment).toBeChecked();

  const tehranLink = page.getByRole("link", {
    name: "مشاهده ملک‌های تهران",
  });
  await tehranLink.focus();
  await expectVisibleKeyboardFocus(tehranLink);
  await expect(
    page.getByRole("region", { name: "آمار زنده کاتالوگ" }),
  ).toBeVisible();

  const firstQuestion = page.getByRole("button", {
    name: "چطور ملک جست‌وجو کنم؟",
  });
  await firstQuestion.focus();
  await expectVisibleKeyboardFocus(firstQuestion);
  await page.keyboard.press("Enter");
  await expect(firstQuestion).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#faq-answer-0")).toBeVisible();

  await expect(
    page.getByRole("status", { name: "وضعیت آمادگی سامانه" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "شبکه‌های اجتماعی" }),
  ).toBeVisible();
  const instagram = page.getByRole("button", {
    name: "Instagram",
  });
  const currentUrl = page.url();
  await instagram.focus();
  await expectVisibleKeyboardFocus(instagram);
  await page.keyboard.press("Enter");
  await expect(instagram).toBeFocused();
  await expect(page).toHaveURL(currentUrl);
  await expect(instagram).toHaveAttribute("aria-disabled", "true");
});

test("@a11y authenticated account placeholders remain keyboard discoverable", async ({
  page,
}) => {
  test.skip(!demoSeedAvailable, "account menu requires the demo catalog");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginDemoOperator(page);
  await page.goto("/");

  const accountTrigger = page.getByRole("button", { name: "حساب کاربری" });
  await accountTrigger.focus();
  await page.keyboard.press("Enter");
  const profile = page.getByRole("menuitem", { name: "نمایه — به‌زودی" });
  await expect(profile).toBeFocused();
  await expect(profile).toHaveAttribute("aria-disabled", "true");
  const currentUrl = page.url();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(currentUrl);
  await page.keyboard.press("Escape");
  await expect(accountTrigger).toBeFocused();
});

for (const viewport of [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 1000 },
] as const) {
  test(`@milestone @cross-browser @a11y public pages pass WCAG 2.2 AA checks on ${viewport.name}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);

    for (const route of publicRoutes) {
      await page.goto(route);
      await expect(page.locator("#main-content")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("main h1")).toHaveCount(1);
      if (route === "/search") {
        await expect(page.locator("footer")).toHaveCount(0);
      } else {
        const landmarkOrder = await page.evaluate(() => {
          const main = document.querySelector("main")!;
          const footer = document.querySelector("footer")!;
          return Boolean(
            main.compareDocumentPosition(footer) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          );
        });
        expect(landmarkOrder, `${route} exposes main before footer`).toBe(true);
      }
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();

      expect(results.violations, `${route} on ${viewport.name}`).toEqual([]);
    }
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "desktop", width: 1440, height: 1000 },
  ] as const) {
    test(`@a11y advertise acquisition works in ${theme} mode on ${viewport.name}`, async ({
      page,
    }) => {
      await initializeTheme(page, theme);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize(viewport);
      await page.goto("/advertise");

      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        page.getByRole("heading", { name: "ثبت آگهی در ترب‌رنت", level: 1 }),
      ).toBeVisible();
      const callsToAction = page.getByRole("link", {
        name: "شروع ثبت رایگان",
      });
      await expect(callsToAction).toHaveCount(2);
      await callsToAction.first().focus();
      await expectVisibleKeyboardFocus(callsToAction.first());

      const layoutFitsViewport = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      );
      expect(layoutFitsViewport).toBe(true);
      const heroAnimation = await page
        .getByRole("heading", { name: "ثبت آگهی در ترب‌رنت", level: 1 })
        .evaluate(
          (heading) => getComputedStyle(heading.parentElement!).animationName,
        );
      expect(heroAnimation).toBe("none");

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations).toEqual([]);

      await callsToAction.first().click();
      await expect(page).toHaveURL(
        /(?:\/submitter\/get-started|\/login\?returnTo=%2Fsubmitter%2Fget-started)$/,
      );
    });
  }
}

for (const theme of ["light", "dark"] as const) {
  for (const viewport of [
    { name: "mobile", width: 390, height: 844 },
    { name: "desktop", width: 1440, height: 1000 },
  ] as const) {
    test(`@a11y canonical surfaces pass WCAG 2.2 AA checks in ${theme} mode on ${viewport.name}`, async ({
      page,
    }) => {
      test.skip(
        !demoSeedAvailable,
        "canonical theme matrix requires the demo catalog",
      );
      test.setTimeout(90_000);
      await page.setViewportSize(viewport);
      await initializeTheme(page, theme);
      await loginDemoOperator(page);

      for (const surface of canonicalSurfaces) {
        await page.goto(surface.path);
        await expect(page.locator("#main-content")).toBeVisible();
        await expect(page.locator("main h1")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();

        expect(
          results.violations,
          `${surface.path} in ${theme} mode on ${viewport.name}`,
        ).toEqual([]);
      }
    });
  }
}

test("@milestone @cross-browser @a11y reduced-motion users do not receive smooth scrolling or long transitions", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

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

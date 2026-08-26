import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  canonicalSurfaces,
  initializeTheme,
  loginDemoOperator,
} from "./helpers/theme";

const publicRoutes = ["/", "/search", "/guide", "/contact"] as const;
const demoSeedAvailable = Boolean(process.env.E2E_SEED_DEMO);

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
      const landmarkOrder = await page.evaluate(() => {
        const main = document.querySelector("main")!;
        const footer = document.querySelector("footer")!;
        return Boolean(
          main.compareDocumentPosition(footer) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        );
      });
      expect(landmarkOrder, `${route} exposes main before footer`).toBe(true);
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

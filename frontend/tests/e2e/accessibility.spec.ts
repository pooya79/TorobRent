import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const publicRoutes = ["/", "/search", "/guide", "/contact"] as const;

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
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();

      expect(results.violations, `${route} on ${viewport.name}`).toEqual([]);
    }
  });
}

test("@milestone @cross-browser @a11y reduced-motion users do not receive smooth scrolling or long transitions", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const motion = await page.evaluate(() => {
    const htmlStyle = getComputedStyle(document.documentElement);
    const linkStyle = getComputedStyle(document.querySelector("a")!);
    return {
      scrollBehavior: htmlStyle.scrollBehavior,
      transitionDuration: linkStyle.transitionDuration,
    };
  });

  expect(motion.scrollBehavior).toBe("auto");
  expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(
    0.001,
  );
});

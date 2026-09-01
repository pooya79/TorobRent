import { expect, test } from "@playwright/test";

import {
  canonicalSurfaces,
  initializeTheme,
  loginDevelopmentOperator,
} from "./helpers/theme";

for (const theme of ["light", "dark"] as const) {
  test(`@visual captures all canonical surfaces in ${theme} mode`, async ({
    page,
  }) => {
    await initializeTheme(page, theme);
    await loginDevelopmentOperator(page);

    for (const { name, path } of canonicalSurfaces) {
      for (const viewport of [
        { label: "mobile", width: 390, height: 844 },
        { label: "desktop", width: 1440, height: 1000 },
      ] as const) {
        await page.setViewportSize(viewport);
        await page.goto(path);
        await expect(page.locator("#main-content")).toBeVisible();
        await expect(page.locator("main h1")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (name !== "operator-review") {
          await expect(page.getByText("سامانه در دسترس است")).toBeVisible();
        }
        await page.screenshot({
          path: `../docs/design/screenshots/${name}-${theme}-${viewport.label}.png`,
          fullPage: true,
        });
      }
    }
  });
}

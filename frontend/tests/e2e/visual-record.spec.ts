import { expect, test } from "@playwright/test";

const routes = [
  ["home", "/"],
  ["results", "/search?location=تهران&property_type=apartment"],
  ["property-detail", "/properties/saadat-abad-101"],
  ["add-listing", "/add-submission"],
  ["submitter-dashboard", "/dashboard"],
  ["operator-review", "/operator/review"],
] as const;

for (const [name, path] of routes) {
  test(`@visual captures ${name} on mobile and desktop`, async ({ page }) => {
    for (const viewport of [
      { label: "mobile", width: 390, height: 844 },
      { label: "desktop", width: 1440, height: 1000 },
    ] as const) {
      await page.setViewportSize(viewport);
      await page.goto(path);
      await expect(page.locator("#main-content")).toBeVisible();
      await expect(page.getByText("سامانه در دسترس است")).toBeVisible();
      await page.screenshot({
        path: `../docs/design/screenshots/${name}-${viewport.label}.png`,
        fullPage: true,
      });
    }
  });
}

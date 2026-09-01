import { expect, type Page } from "@playwright/test";

export type ExplicitTheme = "light" | "dark";

export const themeStorageKey = "torobrent-theme";
const operatorEmail = process.env.E2E_OPERATOR_EMAIL ?? "operator@example.com";
const operatorPassword =
  process.env.E2E_OPERATOR_PASSWORD ?? "operator-password";

export const canonicalSurfaces = [
  { name: "home", path: "/" },
  {
    name: "results",
    path: "/search?location=تهران&property_type=apartment",
  },
  {
    name: "property-detail",
    path: "/properties/8d2866e4-4a78-5337-baa3-36311d1540b0/آپارتمان-در-اراج",
  },
  { name: "add-listing", path: "/add-submission" },
  { name: "submitter-dashboard", path: "/dashboard" },
  { name: "operator-review", path: "/operator/submissions" },
] as const;

export async function initializeTheme(page: Page, theme: ExplicitTheme) {
  await page.addInitScript(
    ({ key, selectedTheme }) => {
      window.localStorage.setItem(key, selectedTheme);
    },
    { key: themeStorageKey, selectedTheme: theme },
  );
}

export async function loginDemoOperator(page: Page) {
  await page.goto("/login");
  await page.getByLabel("ایمیل").fill(operatorEmail);
  await page.getByLabel("گذرواژه").fill(operatorPassword);
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

/// <reference types="node" />

import { expect, test, type Page } from "@playwright/test";

import {
  endSession,
  loginSubmitter,
  mailpitAvailable,
  registerVerifiedSubmitter,
} from "./helpers/accounts";

const externalEnvironment = Boolean(process.env.E2E_BASE_URL);
const operatorEmail = process.env.E2E_OPERATOR_EMAIL ?? "operator@example.com";
const operatorPassword =
  process.env.E2E_OPERATOR_PASSWORD ?? "operator-password";

async function loginOperator(page: Page) {
  await page.goto("/admin/login/");
  await page.getByLabel(/email/i).fill(operatorEmail);
  await page.getByLabel(/password/i).fill(operatorPassword);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/admin\/$/);
}

test("@milestone Source Representative completes the Operator review loop", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  test.skip(
    !mailpitAvailable && !process.env.E2E_REQUIRE_MAILPIT,
    "The complete role handoff requires Mailpit",
  );
  test.skip(
    externalEnvironment && !process.env.E2E_OPERATOR_EMAIL,
    "External stacks must provide a verified E2E Operator",
  );

  const submitter = await registerVerifiedSubmitter(page, request);
  const session = await page.context().request.get("/api/v1/auth/session/");
  const csrfToken = ((await session.json()) as { csrf_token: string })
    .csrf_token;
  const headers = { "X-CSRFToken": csrfToken };
  const created = await page
    .context()
    .request.post("/api/v1/source-proposals/", {
      headers,
      data: {},
    });
  expect(created.ok()).toBe(true);
  const proposal = (await created.json()) as { id: string };
  const detail = `/api/v1/source-proposals/${proposal.id}/`;
  expect(
    (
      await page.context().request.patch(detail, {
        headers,
        data: {
          website_name: "خانه‌یاب مرورگر",
          website_url: `https://browser-${Date.now()}.example/rentals`,
          relationship: "website_manager",
          inventory_range: "51_200",
          sitemap_url: "",
          operator_note: "دسته اجاره از فروش جداست.",
          authority_declared: true,
        },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await page.context().request.post(`${detail}preview/`, { headers })).ok(),
  ).toBe(true);
  expect(
    (
      await page.context().request.post(`${detail}submit/`, {
        headers,
        data: { preview_confirmed: true },
      })
    ).ok(),
  ).toBe(true);

  await endSession(page);
  await loginOperator(page);
  await page.goto("/operator/source-proposals");
  await expect(page.getByText("خانه‌یاب مرورگر")).toBeVisible();
  const beforeSourceApproval = (await (
    await page.context().request.get("/api/v1/catalog/properties/")
  ).json()) as { count: number };
  await page.getByRole("button", { name: "شروع بررسی" }).click();
  await page.getByLabel("دلیل تصمیم").fill("مدرک اختیار را تکمیل کنید.");
  await page.getByRole("button", { name: "درخواست اصلاح" }).click();
  await expect(page.getByText("تصمیم ثبت شد.")).toBeVisible();

  await endSession(page);
  await loginSubmitter(page, submitter);
  await page.goto("/dashboard");
  await expect(page.getByText("نیازمند اصلاح")).toBeVisible();
  await expect(page.getByText("مدرک اختیار را تکمیل کنید.")).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "اصلاح Source Proposal خانه‌یاب مرورگر",
    }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "اصلاح Source Proposal خانه‌یاب مرورگر" })
    .click();
  await page
    .getByLabel("یادداشت برای اپراتور (اختیاری)")
    .fill("مدرک اختیار طبق قرارداد نمایندگی پیوست پرونده است.");
  await page.getByLabel("یادداشت برای اپراتور (اختیاری)").press("Tab");
  await expect(page.getByText("پیش‌نویس ذخیره شد.")).toBeVisible();
  await page.getByRole("button", { name: "ذخیره و مشاهده پیش‌نمایش" }).click();
  await page
    .getByLabel(
      "این پیش‌نمایش شبیه‌سازی‌شده را بررسی کردم و می‌خواهم پیشنهاد را ارسال کنم.",
    )
    .check();
  await page.getByRole("button", { name: "ارسال برای بررسی" }).click();
  await expect(
    page.getByRole("heading", { name: "در انتظار بررسی اپراتور" }),
  ).toBeVisible();

  await endSession(page);
  await loginOperator(page);
  await page.goto("/operator/source-proposals");
  await expect(page.getByText("خانه‌یاب مرورگر")).toBeVisible();
  await page.getByRole("button", { name: "شروع بررسی" }).click();
  await page.getByLabel(/این تصمیم فقط Source را اعتبارسنجی می‌کند/).check();
  await page.getByRole("button", { name: "تأیید Source" }).click();
  await expect(page.getByText("تصمیم ثبت شد.")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "آپارتمان شبیه‌سازی‌شده برای بررسی",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "دفتر شبیه‌سازی‌شده برای بررسی" }),
  ).toBeVisible();
  const afterSourceApproval = (await (
    await page.context().request.get("/api/v1/catalog/properties/")
  ).json()) as { count: number };
  expect(afterSourceApproval.count).toBe(beforeSourceApproval.count);

  await page
    .getByRole("button", {
      name: "شروع بررسی آپارتمان شبیه‌سازی‌شده برای بررسی",
    })
    .click();
  await page
    .getByLabel("تأیید انتشار آپارتمان شبیه‌سازی‌شده برای بررسی")
    .check();
  await page
    .getByRole("button", {
      name: "تأیید و انتشار آپارتمان شبیه‌سازی‌شده برای بررسی",
    })
    .click();
  await expect(page.getByText("تصمیم Listing ثبت شد.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "دفتر شبیه‌سازی‌شده برای بررسی" }),
  ).toBeVisible();
  const afterListingApproval = (await (
    await page.context().request.get("/api/v1/catalog/properties/")
  ).json()) as { count: number };
  expect(afterListingApproval.count).toBe(beforeSourceApproval.count + 1);

  await endSession(page);
  await loginSubmitter(page, submitter);
  await page.goto("/dashboard");
  await expect(page.getByText("تأییدشده")).toBeVisible();
  await expect(
    page.getByText("Source اعتبارسنجی شد؛ هیچ Listingی خودکار منتشر نشده است."),
  ).toBeVisible();
});

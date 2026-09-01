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
  await page.goto("/submitter/get-started");
  await expect(page.getByRole("button", { name: /ثبت یک ملک/ })).toBeVisible();
  await page.getByRole("button", { name: /معرفی وب‌سایت اجاره/ }).click();
  await expect(page).toHaveURL(/\/source-proposal$/);

  await page.getByLabel("نام وب‌سایت").fill("خانه‌یاب مرورگر");
  await page
    .getByLabel("نشانی صفحه اصلی یا کاتالوگ")
    .fill(`https://browser-${Date.now()}.example/rentals`);
  await page.getByLabel("رابطه شما با وب‌سایت").selectOption("website_manager");
  await page.getByLabel("تعداد تقریبی ملک‌ها").selectOption("51_200");
  await page
    .getByLabel("یادداشت برای اپراتور (اختیاری)")
    .fill("دسته اجاره از فروش جداست.");
  await page.getByLabel(/اختیار معرفی این وب‌سایت/).check();
  await page.getByLabel(/اختیار معرفی این وب‌سایت/).press("Tab");
  await expect(page.getByText("پیش‌نویس ذخیره شد.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("نام وب‌سایت")).toHaveValue("خانه‌یاب مرورگر");
  await expect(page.getByLabel("رابطه شما با وب‌سایت")).toHaveValue(
    "website_manager",
  );
  await page.getByRole("button", { name: "ذخیره و مشاهده پیش‌نمایش" }).click();
  await expect(
    page.getByRole("heading", { name: "پیش‌نمایش شبیه‌سازی‌شده" }),
  ).toBeVisible();
  await expect(page.getByText(/هیچ درخواست زنده‌ای/)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "پیش‌نمایش شبیه‌سازی‌شده" }),
  ).toBeVisible();
  await page.getByLabel(/این پیش‌نمایش شبیه‌سازی‌شده را بررسی کردم/).check();
  await page.getByRole("button", { name: "ارسال برای بررسی" }).click();
  await expect(
    page.getByRole("heading", { name: "در انتظار بررسی اپراتور" }),
  ).toBeVisible();

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
  await expect(page.getByText("نیازمند اصلاح", { exact: true })).toBeVisible();
  await expect(page.getByText("نیازمند اصلاح — نسخه ۱")).toBeVisible();
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
  await page
    .getByRole("button", {
      name: "شروع بررسی دفتر شبیه‌سازی‌شده برای بررسی",
    })
    .click();
  await page
    .getByLabel("دلیل تصمیم دفتر شبیه‌سازی‌شده برای بررسی")
    .fill("این Candidate با معیارهای انتشار مستقل سازگار نیست.");
  await page
    .getByRole("button", {
      name: "رد دفتر شبیه‌سازی‌شده برای بررسی",
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "دفتر شبیه‌سازی‌شده برای بررسی" }),
  ).not.toBeVisible();
  const afterListingApproval = (await (
    await page.context().request.get("/api/v1/catalog/properties/")
  ).json()) as { count: number };
  expect(afterListingApproval.count).toBe(beforeSourceApproval.count + 1);

  await endSession(page);
  await loginSubmitter(page, submitter);
  await page.goto("/dashboard");
  await expect(page.getByText("تأییدشده", { exact: true })).toBeVisible();
  await expect(page.getByText("تأییدشده — نسخه ۲")).toBeVisible();
  await expect(
    page.getByText("Source اعتبارسنجی شد؛ هیچ Listingی خودکار منتشر نشده است."),
  ).toBeVisible();
});

/// <reference types="node" />

import { expect, test } from "@playwright/test";
import path from "node:path";

const externalEnvironment = Boolean(process.env.E2E_BASE_URL);
const operatorEmail = process.env.E2E_OPERATOR_EMAIL ?? "operator@example.com";
const operatorPassword =
  process.env.E2E_OPERATOR_PASSWORD ?? "operator-password";

test("Submitter completes the media step and sees processed images in final review", async ({
  page,
}) => {
  test.skip(
    externalEnvironment && !process.env.E2E_OPERATOR_EMAIL,
    "External stacks must provide a verified E2E Submitter",
  );

  await page.goto("/admin/login/");
  await page.getByLabel(/email/i).fill(operatorEmail);
  await page.getByLabel(/password/i).fill(operatorPassword);
  await page.getByRole("button", { name: /log in/i }).click();
  await expect(page).toHaveURL(/\/admin\/$/);

  await page.goto("/add-submission");
  await page.getByRole("button", { name: "ساخت یا ادامه Submission" }).click();
  await expect(page).toHaveURL(/submission=/);
  const submissionId = new URL(page.url()).searchParams.get("submission");
  expect(submissionId).toBeTruthy();
  await page.goto(`/add-submission?submission=${submissionId}&step=images`);

  await page
    .getByLabel("افزودن تصاویر")
    .setInputFiles(
      path.resolve("../docs/design/screenshots/add-listing-light-mobile.png"),
    );
  await expect(
    page.getByRole("img", { name: "پیش‌نمایش تصویر" }),
  ).toBeVisible();
  await expect(page.getByText("آماده", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "انتخاب به‌عنوان تصویر اصلی" }),
  ).toBeChecked();
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await expect(
    page.getByRole("heading", { name: "اطلاعات تماس" }),
  ).toBeVisible();

  await page.goto(`/add-submission?submission=${submissionId}&step=review`);
  await expect(
    page.getByRole("img", { name: "تصویر Submission در بازبینی" }),
  ).toBeVisible();
  await expect(page.getByText(/تصاویر آماده‌اند/)).toBeVisible();
  await page
    .getByLabel("اطلاعات واردشده را بازبینی کردم و درستی آن را تأیید می‌کنم.")
    .check();
  await page.getByRole("button", { name: "ارسال برای بررسی" }).click();
  await expect(
    page.getByLabel(
      "اطلاعات واردشده را بازبینی کردم و درستی آن را تأیید می‌کنم.",
    ),
  ).toBeChecked();
});

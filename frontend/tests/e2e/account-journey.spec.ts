/// <reference types="node" />

import { expect, test } from "@playwright/test";
import path from "node:path";

import {
  mailpitAvailable,
  registerVerifiedSubmitter,
} from "./helpers/accounts";

test("@milestone registers, verifies through Mailpit, logs in, and enters protected navigation", async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  test.skip(!mailpitAvailable, "The complete email journey requires Mailpit");

  const { email, password } = await registerVerifiedSubmitter(page, request);

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "پیشنهادهای من" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/submitter/get-started");
  const phone = `09${String(Date.now()).slice(-9)}`;
  await page.getByLabel("شماره تلفن").fill(phone);
  await page.getByRole("button", { name: "ارسال کد تأیید" }).click();
  const demoOtp = await page.getByText(/کد نمایشی:/).textContent();
  await page.getByLabel("کد تأیید").fill(demoOtp?.match(/\d{6}/)?.[0] ?? "");
  await page.getByRole("button", { name: "تأیید و ادامه" }).click();
  await page.getByRole("button", { name: /ثبت یک ملک/ }).click();
  await expect(page).toHaveURL(/\/add-submission$/);
  await page.getByRole("button", { name: "ساخت یا ادامه Submission" }).click();
  await expect(page.getByText(/مرحله ۱ از ۷/)).toBeVisible();
  await page.getByLabel("محله").fill("سعادت");
  await page.getByRole("option").click();
  await page.getByLabel("نشانی دقیق").fill("بلوار دریا، کوچه سرو");
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await page.getByLabel("متراژ").fill("۱۱۰");
  await page.getByLabel("تعداد اتاق خواب").fill("۲");
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await expect(
    page.getByRole("heading", { name: "شرایط اجاره" }),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "شرایط اجاره" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "باز کردن فهرست راهبری" }).click();
  await page.getByRole("button", { name: "خروج" }).click();
  await expect(page).toHaveURL(/\/login\?returnTo=/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("ایمیل").fill(email);
  await page.getByLabel("گذرواژه").fill(password);
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(
    page.getByRole("heading", { name: "شرایط اجاره" }),
  ).toBeVisible();

  await page.getByLabel("ودیعه، تومان").fill("۱٬۰۰۰٬۰۰۰٬۰۰۰");
  await page.getByLabel("اجاره ماهانه، تومان").fill("۲۵٬۰۰۰٬۰۰۰");
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  for (const feature of ["پارکینگ", "آسانسور", "انباری", "بالکن", "مبله"]) {
    await page
      .getByRole("group", { name: `وضعیت ${feature}` })
      .getByRole("radio", { name: "نمی‌دانم" })
      .check();
  }
  await page.getByLabel("توضیحات").fill("نورگیر و آرام");
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await expect(page.getByRole("heading", { name: "تصاویر" })).toBeVisible();
  await page
    .getByLabel("افزودن تصاویر")
    .setInputFiles(
      path.resolve("../docs/design/screenshots/add-listing-light-mobile.png"),
    );
  await expect(
    page.getByRole("img", { name: "پیش‌نمایش تصویر" }),
  ).toBeVisible();
  await expect(page.getByText("آماده", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await page.getByLabel("نام تماس").fill("سارا احمدی");
  await expect(page.getByLabel("شماره عمومی تماس")).not.toHaveValue("");
  await page.getByRole("checkbox", { name: /اختیار ثبت و انتشار/ }).check();
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await expect(
    page.getByText("نمایش عمومی شماره تماس را تأیید کنید."),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /نمایش عمومی این شماره/ }).check();
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await page
    .getByLabel("اطلاعات واردشده را بازبینی کردم و درستی آن را تأیید می‌کنم.")
    .check();
  await expect(
    page.getByRole("img", { name: "تصویر Submission در بازبینی" }),
  ).toBeVisible();
  await expect(page.getByText(/تصاویر آماده‌اند/)).toBeVisible();
  await page.getByRole("button", { name: "ارسال برای بررسی" }).click();
  await expect(
    page.getByRole("heading", { name: "در انتظار بررسی اپراتور" }),
  ).toBeVisible();
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "پیشنهادهای من" }),
  ).toBeVisible();
});

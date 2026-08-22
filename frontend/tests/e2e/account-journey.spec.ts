/// <reference types="node" />

import { expect, test } from "@playwright/test";

const mailpitAvailable = Boolean(process.env.E2E_MAILPIT_URL);
const mailpitUrl = process.env.E2E_MAILPIT_URL ?? "http://localhost:8025";

test("registers, verifies through Mailpit, logs in, and enters protected navigation", async ({
  page,
  request,
}) => {
  test.skip(!mailpitAvailable, "The complete email journey requires Mailpit");

  const email = `submitter-${Date.now()}@example.com`;
  const password = "correct-horse-battery";
  await page.goto("/register");
  await page.getByLabel("ایمیل").fill(email);
  await page.getByLabel("گذرواژه").fill(password);
  const register = page.getByRole("button", { name: "ساخت حساب" });
  await expect(register).toBeEnabled();
  await register.click();
  await expect(page.getByText(/حساب ساخته شد/)).toBeVisible();

  let messageId = "";
  await expect
    .poll(async () => {
      const response = await request.get(
        `${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
      );
      if (!response.ok()) return false;
      const body = (await response.json()) as { messages?: { ID: string }[] };
      messageId = body.messages?.[0]?.ID ?? "";
      return Boolean(messageId);
    })
    .toBe(true);

  const messageResponse = await request.get(
    `${mailpitUrl}/api/v1/message/${messageId}`,
  );
  const message = (await messageResponse.json()) as { Text: string };
  const verificationUrl = message.Text.match(
    /http:\/\/(?:localhost|127\.0\.0\.1):5173\/verify-email\?token=\S+/,
  )?.[0];
  expect(verificationUrl).toBeTruthy();

  await page.goto(verificationUrl!);
  await expect(page.getByText(/ایمیل شما تأیید شد/)).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "ورود" }).click();
  await page.getByLabel("ایمیل").fill(email);
  await page.getByLabel("گذرواژه").fill(password);
  await page.getByRole("button", { name: "ورود" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("heading", { name: "آگهی‌های من" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: "ثبت آگهی تازه" }).click();
  await page.getByRole("button", { name: "ساخت پیش‌نویس و ادامه" }).click();
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
  await page.getByRole("button", { name: "ادامه به اطلاعات تماس" }).click();
  await page.getByLabel("نام تماس").fill("سارا احمدی");
  await page.getByLabel("شماره تماس").fill("۰۹۱۲۱۲۳۴۵۶۷");
  await page.getByLabel("اختیار ثبت اطلاعات این ملک را دارم.").check();
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await page
    .getByLabel("اطلاعات واردشده را بازبینی کردم و درستی آن را تأیید می‌کنم.")
    .check();
  await page.getByRole("button", { name: "ذخیره بازبینی" }).click();
  await expect(
    page.getByText(/بدون تصاویر وارد صف بررسی اپراتور نمی‌شود|تا تکمیل تصاویر/),
  ).toBeVisible();
});

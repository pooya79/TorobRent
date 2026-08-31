import { expect, test } from "@playwright/test";

test("registers and logs in with a verified Iranian mobile number", async ({
  page,
}) => {
  const phone = `09${String(Date.now()).slice(-9)}`;
  const password = "123";

  await page.goto("/register");
  await page.getByLabel("ایمیل یا شماره تلفن").fill(phone);
  await page.getByLabel("گذرواژه").fill(password);
  await page.getByRole("button", { name: "ساخت حساب" }).click();

  const demoOtp = await page.getByText(/کد نمایشی:/).textContent();
  const otp = demoOtp?.match(/\d{6}/)?.[0];
  expect(otp).toBeTruthy();
  await page.getByLabel("کد تأیید").fill(otp ?? "");
  await page.getByRole("button", { name: "تأیید شماره" }).click();
  await expect(
    page.getByText("شماره تلفن تأیید شد. اکنون می‌توانید وارد شوید."),
  ).toBeVisible();

  await page.goto("/login?returnTo=%2F");
  await page.getByLabel("ایمیل یا شماره تلفن").fill(phone);
  await page.getByLabel("گذرواژه").fill(password);
  await page.getByRole("button", { name: "ورود" }).click();

  await expect(page).toHaveURL(/\/$/);
});

test("preserves Submitter onboarding through access and restores either selected path", async ({
  page,
}) => {
  const phone = `09${String(Date.now()).slice(-9)}`;
  const password = "123";

  await page.goto("/submitter/get-started");
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fsubmitter%2Fget-started$/);
  await page.getByRole("link", { name: "ساخت حساب" }).click();
  await expect(page).toHaveURL(
    /\/register\?returnTo=%2Fsubmitter%2Fget-started$/,
  );
  await page.getByLabel("ایمیل یا شماره تلفن").fill(phone);
  await page.getByLabel("گذرواژه").fill(password);
  await page.getByRole("button", { name: "ساخت حساب" }).click();

  const otpText = await page.getByText(/کد نمایشی:/).textContent();
  await page.getByLabel("کد تأیید").fill(otpText?.match(/\d{6}/)?.[0] ?? "");
  await page.getByRole("button", { name: "تأیید شماره" }).click();
  await page.getByLabel("ایمیل یا شماره تلفن").fill(phone);
  await page.getByLabel("گذرواژه").fill(password);
  await page.getByRole("button", { name: "ورود" }).click();

  const property = page.getByRole("button", {
    name: /ثبت یک ملک/,
  });
  const website = page.getByRole("button", { name: /معرفی وب‌سایت اجاره/ });
  await expect(property).toBeVisible();
  await expect(website).toBeVisible();
  await website.click();
  await expect(page).toHaveURL(/\/source-proposal$/);
  await expect(
    page.getByRole("heading", { name: "Source Proposal وب‌سایت اجاره" }),
  ).toBeVisible();

  await page.getByLabel("نام وب‌سایت").fill("خانه‌یاب آزمایشی");
  await page.getByLabel("نشانی صفحه اصلی یا کاتالوگ").focus();
  await expect(page.getByText("پیش‌نویس ذخیره شد.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("نام وب‌سایت")).toHaveValue("خانه‌یاب آزمایشی");
  await page
    .getByLabel("نشانی صفحه اصلی یا کاتالوگ")
    .fill("https://source-proposal.example/rentals");
  await page.getByLabel("رابطه شما با وب‌سایت").selectOption("website_manager");
  await page.getByLabel("تعداد تقریبی ملک‌ها").selectOption("unknown");
  await page.getByLabel(/اختیار معرفی این وب‌سایت/).check();
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
  await expect(page.getByText("در انتظار بررسی اپراتور")).toBeVisible();
  await page.reload();
  await expect(page.getByText("در انتظار بررسی اپراتور")).toBeVisible();

  await page.getByRole("link", { name: "مشاهده وضعیت در داشبورد" }).click();
  await expect(
    page.getByRole("heading", { name: "پیشنهادهای منبع" }),
  ).toBeVisible();
  await expect(page.getByText("خانه‌یاب آزمایشی")).toBeVisible();
});

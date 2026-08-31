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
  await expect(website).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(website).toHaveAttribute("aria-pressed", "true");
  await property.click();
  await expect(page).toHaveURL(/\/add-submission$/);
  await expect(
    page.getByRole("heading", { name: "نقش شما در این ثبت چیست؟" }),
  ).toBeVisible();
});

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

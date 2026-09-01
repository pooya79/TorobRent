import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const mailpitAvailable = Boolean(process.env.E2E_MAILPIT_URL);

const mailpitUrl = process.env.E2E_MAILPIT_URL ?? "http://localhost:8025";

export async function registerVerifiedSubmitter(
  page: Page,
  request: APIRequestContext,
  options: {
    registrationReady?: boolean;
    finishAtDashboard?: boolean;
  } = {},
) {
  const email = `submitter-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = "correct-horse-battery";

  if (!options.registrationReady) await page.goto("/register");
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
    /http:\/\/(?:localhost|127\.0\.0\.1):\d+\/verify-email\?token=\S+/,
  )?.[0];
  expect(verificationUrl).toBeTruthy();

  await page.goto(verificationUrl!);
  await expect(page.getByText(/ایمیل شما تأیید شد/)).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "ورود" }).click();
  await page.getByLabel("ایمیل").fill(email);
  await page.getByLabel("گذرواژه").fill(password);
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/submitter\/get-started(?:\?|$)/);

  const phone = `09${String(Date.now()).slice(-9)}`;
  await page.getByLabel("شماره تلفن").fill(phone);
  await page.getByRole("button", { name: "ارسال کد تأیید" }).click();
  const demoOtp = await page.getByText(/کد نمایشی:/).textContent();
  await page.getByLabel("کد تأیید").fill(demoOtp?.match(/\d{6}/)?.[0] ?? "");
  await page.getByRole("button", { name: "تأیید و ادامه" }).click();

  if (options.finishAtDashboard !== false) {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);
  }

  return { email, password, phone };
}

export async function endSession(page: Page) {
  const session = await page.context().request.get("/api/v1/auth/session/");
  const csrfToken = ((await session.json()) as { csrf_token: string })
    .csrf_token;
  const response = await page.context().request.post("/api/v1/auth/logout/", {
    headers: { "X-CSRFToken": csrfToken },
  });
  expect(response.ok()).toBe(true);
}

export async function loginSubmitter(
  page: Page,
  credentials: { email: string; password: string },
) {
  await page.goto("/login");
  await page.getByLabel("ایمیل").fill(credentials.email);
  await page.getByLabel("گذرواژه").fill(credentials.password);
  await page.getByRole("button", { name: "ورود" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

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
});

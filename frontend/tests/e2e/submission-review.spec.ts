/// <reference types="node" />

import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

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

async function seedCompleteDraft(
  page: Page,
  csrfToken: string,
  suffix: string,
) {
  const api = page.context().request;
  const headers = { "X-CSRFToken": csrfToken };
  const created = await api.post("/api/v1/submissions/", {
    headers,
    data: { role: "owner" },
  });
  expect(created.ok()).toBe(true);
  const submission = (await created.json()) as {
    id: string;
    contact: { phone: string };
  };
  const detail = `/api/v1/submissions/${submission.id}/`;
  const steps = [
    {
      completed_step: "location",
      location: {
        neighborhood_id: "30000000-0000-4000-8000-000000000043",
        address: `بلوار دریا، پلاک ${suffix}`,
      },
    },
    {
      completed_step: "property_facts",
      property_facts: {
        property_type: "apartment",
        area_sqm: 110,
        room_count: 2,
        construction_year: 1400,
        floor: 3,
        total_floors: 6,
        units_per_floor: 2,
      },
    },
    {
      completed_step: "rental_terms",
      rental_terms: {
        deposit_toman: 1_000_000_000,
        monthly_rent_toman: 25_000_000,
        is_negotiable: false,
        is_convertible: false,
      },
    },
    {
      completed_step: "features_description",
      features: {
        parking: "present",
        elevator: "present",
        storage: "unknown",
        balcony: "unknown",
        furnished: "unknown",
      },
      description: `آپارتمان روشن و آرام ${suffix}`,
    },
  ];
  for (const data of steps) {
    const response = await api.patch(detail, { headers, data });
    expect(response.ok()).toBe(true);
  }
  const uploaded = await api.post(`${detail}images/`, {
    headers,
    multipart: {
      file: {
        name: "home.png",
        mimeType: "image/png",
        buffer: await readFile(
          path.resolve(
            "../docs/design/screenshots/add-listing-light-mobile.png",
          ),
        ),
      },
    },
  });
  expect(uploaded.ok()).toBe(true);
  await expect
    .poll(
      async () =>
        (
          await api.patch(detail, {
            headers,
            data: { completed_step: "images" },
          })
        ).ok(),
      {
        message: "wait for the uploaded image to finish background processing",
        timeout: 15_000,
      },
    )
    .toBe(true);
  expect(
    (
      await api.patch(detail, {
        headers,
        data: {
          completed_step: "contact",
          contact: {
            name: "سارا احمدی",
            phone: submission.contact.phone,
            authorization_declared: true,
            phone_publication_consent: true,
          },
        },
      })
    ).ok(),
  ).toBe(true);
  return submission.id;
}

async function submitFromReview(page: Page, submissionId: string) {
  await page.goto(`/add-submission?submission=${submissionId}&step=review`);
  await page
    .getByLabel("اطلاعات واردشده را بازبینی کردم و درستی آن را تأیید می‌کنم.")
    .check();
  await page.getByRole("button", { name: "ارسال برای بررسی" }).click();
  await expect(
    page.getByRole("heading", { name: "در انتظار بررسی اپراتور" }),
  ).toBeVisible();
}

async function claimSelectedSubmission(page: Page, submissionId: string) {
  const queueResponse = await page
    .context()
    .request.get(
      "/api/v1/operator/submissions/?state=pending&ordering=oldest&page_size=100",
    );
  expect(queueResponse.ok()).toBe(true);
  const queue = (await queueResponse.json()) as {
    results: { id: string }[];
  };
  const queueIndex = queue.results.findIndex(({ id }) => id === submissionId);
  expect(queueIndex).toBeGreaterThanOrEqual(0);
  await page
    .getByRole("region", { name: "صف ارسال‌ها" })
    .getByRole("button")
    .nth(queueIndex)
    .click();
  await expect(
    page.getByRole("button", { name: "پذیرفتن مسئولیت بررسی" }),
  ).toBeVisible();

  const claim = page.waitForResponse(
    (response) =>
      response.url().includes(`/operator/submissions/${submissionId}/claim/`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "پذیرفتن مسئولیت بررسی" }).click();
  expect((await claim).ok()).toBe(true);
  await expect(
    page.getByRole("button", { name: "آزاد کردن بررسی" }),
  ).toBeVisible();
}

test("@milestone browser covers changes, resubmit, reject, group, publish, and public visibility", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  test.skip(
    !mailpitAvailable && !process.env.E2E_REQUIRE_MAILPIT,
    "The complete role handoff requires Mailpit",
  );
  test.skip(
    externalEnvironment && !process.env.E2E_OPERATOR_EMAIL,
    "External stacks must provide a verified E2E Operator and catalog fixture",
  );

  const submitter = await registerVerifiedSubmitter(page, request);
  const session = await page.context().request.get("/api/v1/auth/session/");
  const csrfToken = ((await session.json()) as { csrf_token: string })
    .csrf_token;

  const revisedId = await seedCompleteDraft(page, csrfToken, "۱");
  const groupedId = await seedCompleteDraft(page, csrfToken, "۲");
  const rejectedId = await seedCompleteDraft(page, csrfToken, "۳");
  await submitFromReview(page, revisedId);

  await endSession(page);
  await loginOperator(page);
  await page.goto("/operator/submissions");
  await claimSelectedSubmission(page, revisedId);
  await page.getByRole("button", { name: "درخواست اصلاح" }).click();
  await page.getByLabel("دلیل درخواست اصلاح").fill("شماره تماس را اصلاح کنید.");
  await page.getByRole("button", { name: "ارسال درخواست اصلاح" }).click();

  await endSession(page);
  await loginSubmitter(page, submitter);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("alert").getByText("شماره تماس را اصلاح کنید."),
  ).toBeVisible();
  await page.goto(`/add-submission?submission=${revisedId}&step=contact`);
  await expect(page.getByLabel("شماره عمومی تماس")).not.toHaveValue("");
  await page.getByRole("button", { name: "ذخیره و ادامه" }).click();
  await expect(page.getByRole("heading", { name: "بازبینی" })).toBeVisible();
  await page
    .getByLabel("اطلاعات واردشده را بازبینی کردم و درستی آن را تأیید می‌کنم.")
    .check();
  await page.getByRole("button", { name: "ارسال برای بررسی" }).click();
  await expect(
    page.getByRole("heading", { name: "در انتظار بررسی اپراتور" }),
  ).toBeVisible();
  await submitFromReview(page, groupedId);
  await submitFromReview(page, rejectedId);

  await endSession(page);
  await loginOperator(page);
  await page.goto("/operator/submissions");
  await claimSelectedSubmission(page, revisedId);
  await page.getByRole("button", { name: "تأیید و انتشار" }).click();
  const firstApproval = page.waitForResponse(
    (response) =>
      response.url().includes(`/operator/submissions/${revisedId}/approve/`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "تأیید نهایی و انتشار" }).click();
  const firstApprovalBody = (await (await firstApproval).json()) as {
    property_id: string;
    listing_id: string;
  };
  expect(firstApprovalBody.property_id).toBeTruthy();
  expect(firstApprovalBody.listing_id).toBeTruthy();

  await page.goto("/operator/submissions");
  await claimSelectedSubmission(page, groupedId);
  await page.getByRole("button", { name: "تأیید و انتشار" }).click();
  await page
    .getByLabel("شناسه Property موجود (اختیاری)")
    .fill(firstApprovalBody.property_id);
  const groupedApproval = page.waitForResponse(
    (response) =>
      response.url().includes(`/operator/submissions/${groupedId}/approve/`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "تأیید نهایی و انتشار" }).click();
  expect((await groupedApproval).ok()).toBe(true);

  await page.goto("/operator/submissions");
  await claimSelectedSubmission(page, rejectedId);
  await page.getByRole("button", { name: "رد نهایی" }).click();
  await page.getByLabel("دلیل رد").fill("محتوای نامعتبر");
  const rejection = page.waitForResponse(
    (response) =>
      response.url().includes(`/operator/submissions/${rejectedId}/reject/`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "رد Submission" }).click();
  expect((await rejection).ok()).toBe(true);
  await endSession(page);
  await loginSubmitter(page, submitter);
  await expect(
    page.getByRole("heading", { name: "پیشنهادهای من", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").getByText("محتوای نامعتبر"),
  ).toBeVisible();

  await page.goto(`/properties/${firstApprovalBody.property_id}`);
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByText("آپارتمان روشن و آرام ۱")).toBeVisible();
  const publicDocument = await page.context().request.get(page.url());
  const publicHtml = await publicDocument.text();
  expect(publicHtml).not.toContain(submitter.phone);

  await page.setViewportSize({ width: 390, height: 844 });
  const revisedListing = page.getByRole("article").filter({
    hasText: "آپارتمان روشن و آرام ۱",
  });
  await revisedListing
    .getByRole("button", { name: "نمایش شماره تماس" })
    .click();
  await expect(
    revisedListing.getByRole("link", {
      name: `تماس با ${submitter.phone}`,
    }),
  ).toHaveAttribute("href", `tel:${submitter.phone}`);

  await endSession(page);
  await loginOperator(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(
    `/admin/catalog/productevent/?event_type__exact=property_view&property__id__exact=${firstApprovalBody.property_id}&period=7d`,
  );
  await expect(
    page.getByRole("heading", { name: "آمار تجمیعی رویدادها" }),
  ).toBeVisible();
  await expect(
    page.getByText("مجموع در بازه و فیلترهای انتخاب‌شده: 1"),
  ).toBeVisible();
  await page.goto(
    `/admin/catalog/productevent/?event_type__exact=phone_reveal&property__id__exact=${firstApprovalBody.property_id}&period=7d`,
  );
  await expect(
    page.getByText("مجموع در بازه و فیلترهای انتخاب‌شده: 1"),
  ).toBeVisible();

  await page.goto(
    `/admin/catalog/listing/${firstApprovalBody.listing_id}/change/`,
  );
  await page.getByLabel("State:").selectOption("expired");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.goto(`/properties/${firstApprovalBody.property_id}`);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText("آپارتمان روشن و آرام ۱")).not.toBeVisible();

  await endSession(page);
  await loginSubmitter(page, submitter);
  const revisedSubmission = page
    .locator("section[aria-label='ارسال‌های شما'] > div")
    .filter({ has: page.locator(`a[href*="${revisedId}"]`) });
  await revisedSubmission.getByRole("button", { name: "تأیید موجودی" }).click();
  await expect(
    page.getByText("موجودی آگهی برای ۳۰ روز دیگر تأیید شد."),
  ).toBeVisible();

  await page.goto(`/properties/${firstApprovalBody.property_id}`);
  await expect(page.getByRole("article")).toHaveCount(2);

  await page.goto("/dashboard");
  await revisedSubmission.getByRole("button", { name: "بایگانی" }).click();

  await page.goto(`/properties/${firstApprovalBody.property_id}`);
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("@milestone browser covers capability-aware Support privacy routing and finalization", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  test.skip(
    !mailpitAvailable && !process.env.E2E_REQUIRE_MAILPIT,
    "Creating a verified capability-limited Operator requires Mailpit",
  );
  test.skip(
    externalEnvironment && !process.env.E2E_OPERATOR_EMAIL,
    "External stacks must provide a privileged E2E Operator",
  );

  const generalOperator = await registerVerifiedSubmitter(page, request);
  const currentAccount = await page.context().request.get("/api/v1/users/me/");
  const generalOperatorId = ((await currentAccount.json()) as { id: string })
    .id;
  await endSession(page);

  await loginOperator(page);
  await page.goto(`/admin/accounts/user/${generalOperatorId}/change/`);
  await page.locator("#id_groups").selectOption({ label: "Support Operator" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/accounts\/user\/$/);
  await endSession(page);

  const requesterEmail = `privacy-routing-${Date.now()}@example.com`;
  await page.goto("/contact");
  await page
    .getByLabel("نام و نام خانوادگی")
    .fill("درخواست‌کننده مسیر حریم خصوصی");
  await page.getByLabel("ایمیل").fill(requesterEmail);
  await page.getByLabel("موضوع پیام").selectOption("general");
  await page
    .getByLabel("متن پیام")
    .fill("این درخواست عمومی پس از بررسی باید به مسیر حریم خصوصی منتقل شود.");
  await page.getByRole("button", { name: "ارسال پیام" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "پیام شما ثبت شد" }),
  ).toBeVisible();

  await loginSubmitter(page, generalOperator);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operator");
  await expect(page.getByRole("link", { name: "پشتیبانی" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "بررسی Submissionها" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  const menu = page.getByRole("button", { name: "باز کردن راهبری اپراتور" });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("navigation", { name: "راهبری فضای اپراتور" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/operator/support");
  await page.getByLabel("جست‌وجو").fill(requesterEmail);
  await expect(
    page.getByText("درخواست‌کننده مسیر حریم خصوصی").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "پذیرفتن درخواست" }).click();
  await expect(
    page.getByRole("button", { name: "آزاد کردن درخواست" }),
  ).toBeVisible();

  await page.getByLabel("دسته‌بندی عملیاتی").selectOption("privacy");
  await page.getByLabel("مسیر‌دهی تخصصی").selectOption("escalated");
  await page
    .getByLabel("قابلیت مورد نیاز")
    .selectOption("handle_privacy_requests");
  await page.getByLabel("مقصد ارجاع").fill("صف حریم خصوصی");
  await page
    .getByLabel("دلیل تریاژ")
    .fill("محتوا پس از بررسی به رسیدگی تخصصی حریم خصوصی نیاز دارد.");
  await page.getByRole("button", { name: "ثبت تریاژ" }).click();
  await expect(page.getByText("موردی در صف نیست.")).toBeVisible();
  await expect(page.getByText("نتیجه نهایی")).toHaveCount(0);

  await endSession(page);
  await loginOperator(page);
  await page.goto("/operator/support");
  await page.getByLabel("جست‌وجو").fill(requesterEmail);
  await expect(
    page.getByText("درخواست‌کننده مسیر حریم خصوصی").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "پذیرفتن درخواست" }).click();
  await page.getByLabel("نتیجه نهایی").selectOption("no_action_required");
  await page
    .getByLabel("خلاصه داخلی نتیجه")
    .fill("درخواست پس از بررسی تخصصی بدون اقدام بیشتری بسته شد.");
  const resolution = page.waitForResponse(
    (response) =>
      response.url().includes("/operator/support-requests/") &&
      response.url().endsWith("/resolve/") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "ثبت نتیجه و بستن" }).click();
  const resolutionResponse = await resolution;
  expect(resolutionResponse.status(), await resolutionResponse.text()).toBe(
    200,
  );
  await expect(page.getByText("نتیجه ثبت‌شده")).toBeVisible();

  await page.goto("/operator/review");
  await expect(page).toHaveURL(/\/operator\/submissions$/);
});

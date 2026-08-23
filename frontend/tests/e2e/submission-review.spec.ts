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
  const submission = (await created.json()) as { id: string };
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
          path.resolve("../docs/design/screenshots/add-listing-mobile.png"),
        ),
      },
    },
  });
  expect(uploaded.ok()).toBe(true);
  expect(
    (
      await api.patch(detail, {
        headers,
        data: { completed_step: "images" },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await api.patch(detail, {
        headers,
        data: {
          completed_step: "contact",
          contact: {
            name: "سارا احمدی",
            phone: "۰۹۱۲۱۲۳۴۵۶۷",
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
  await page.goto("/operator/review");
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
  await page.getByRole("textbox", { name: "شماره تماس" }).fill("۰۹۱۲۰۰۰۰۰۰۰");
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
  await page.goto("/operator/review");
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

  await page.goto("/operator/review");
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

  await page.goto("/operator/review");
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
    page.getByRole("heading", { name: "آگهی‌های من" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").getByText("محتوای نامعتبر"),
  ).toBeVisible();

  await page.goto(`/properties/${firstApprovalBody.property_id}`);
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByText("آپارتمان روشن و آرام ۱")).toBeVisible();
  const publicDocument = await page.context().request.get(page.url());
  const publicHtml = await publicDocument.text();
  expect(publicHtml).not.toContain("۰۹۱۲۰۰۰۰۰۰۰");
  expect(publicHtml).not.toContain("۰۹۱۲۱۲۳۴۵۶۷");

  await page.setViewportSize({ width: 390, height: 844 });
  const revisedListing = page.getByRole("article").filter({
    hasText: "آپارتمان روشن و آرام ۱",
  });
  await revisedListing
    .getByRole("button", { name: "نمایش شماره تماس" })
    .click();
  await expect(
    revisedListing.getByRole("link", { name: "تماس با ۰۹۱۲۰۰۰۰۰۰۰" }),
  ).toHaveAttribute("href", "tel:۰۹۱۲۰۰۰۰۰۰۰");

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

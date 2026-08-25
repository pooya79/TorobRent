import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { OperatorReviewPage } from "@/pages/OperatorReviewPage";
import { server } from "./server";

const pendingSubmission = {
  id: "10000000-0000-4000-8000-000000000012",
  role: "owner",
  state: "pending",
  revision: 1,
  pending_since: "2026-08-22T08:00:00Z",
  claim_status: "unclaimed",
  claim: null,
  source_id: "10000000-0000-4000-8000-000000000001",
  listing_id: null,
  current_step: "review",
  media_complete: true,
  images: [],
  location: {
    city_id: "11111111-1111-4111-8111-111111111111",
    city: "تهران",
    district_id: "20000000-0000-4000-8000-000000000002",
    district: "منطقه ۲",
    neighborhood_id: "30000000-0000-4000-8000-000000000003",
    neighborhood: "سعادت‌آباد",
    address: "بلوار دریا",
  },
  property_facts: {
    property_type: "apartment",
    area_sqm: 110,
    room_count: 2,
    construction_year: 1400,
    floor: 3,
    total_floors: 6,
    units_per_floor: 2,
  },
  rental_terms: {
    deposit_rial: 10_000_000_000,
    monthly_rent_rial: 250_000_000,
    currency: "IRR",
    deposit_toman: 1_000_000_000,
    monthly_rent_toman: 25_000_000,
    is_negotiable: false,
    is_convertible: false,
  },
  features: {
    parking: "present",
    elevator: "present",
    storage: "unknown",
    balcony: "unknown",
    furnished: "unknown",
  },
  description: "نورگیر و آرام",
  contact: {
    name: "سارا احمدی",
    phone: "۰۹۱۲۱۲۳۴۵۶۷",
    authorization_declared: true,
    phone_publication_consent: true,
  },
  review: { accuracy_confirmed: true },
  history: [
    {
      id: "40000000-0000-4000-8000-000000000004",
      actor_reference: "50000000-0000-4000-8000-000000000005",
      actor_label: "owner@example.com",
      actor_email: "owner@example.com",
      revision: 1,
      prior_state: "draft",
      new_state: "pending",
      reason: "",
      created_at: "2026-08-22T08:00:00Z",
    },
  ],
  available_actions: [],
  created_at: "2026-08-22T07:00:00Z",
  updated_at: "2026-08-22T08:00:00Z",
};

const claimedSubmission = {
  ...pendingSubmission,
  claim_status: "claimed_by_me",
  claim: {
    id: "70000000-0000-4000-8000-000000000007",
    operator_id: "80000000-0000-4000-8000-000000000008",
    operator_email: "reviewer@example.com",
    revision: 1,
    renewed_at: "2026-08-22T08:00:00Z",
    expires_at: "2026-08-22T08:15:00Z",
  },
};

function serveSubmission(
  submission: Record<string, unknown> = pendingSubmission,
) {
  server.use(
    http.get("*/api/v1/operator/submissions/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [submission],
      }),
    ),
    http.get("*/api/v1/operator/submissions/:id/", () =>
      HttpResponse.json(submission),
    ),
  );
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OperatorReviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("loads the real Operator queue and requires a reason for changes", async () => {
  const user = userEvent.setup();
  let reason = "";
  serveSubmission(claimedSubmission);
  server.use(
    http.post(
      "*/api/v1/operator/submissions/:id/request-changes/",
      async ({ request }) => {
        reason = ((await request.json()) as { reason: string }).reason;
        return HttpResponse.json({
          ...claimedSubmission,
          state: "changes_requested",
        });
      },
    ),
  );
  renderPage();

  expect(
    await screen.findByRole("heading", { name: "صف بررسی آگهی‌ها" }),
  ).toBeVisible();
  expect(screen.getAllByText("سعادت‌آباد")[0]).toBeVisible();
  await user.click(
    await screen.findByRole("button", { name: "درخواست اصلاح" }),
  );
  expect(
    screen.getByRole("button", { name: "ارسال درخواست اصلاح" }),
  ).toBeDisabled();
  await user.type(
    screen.getByLabelText("دلیل درخواست اصلاح"),
    "شماره تماس را اصلاح کنید.",
  );
  await user.click(screen.getByRole("button", { name: "ارسال درخواست اصلاح" }));

  await waitFor(() => expect(reason).toBe("شماره تماس را اصلاح کنید."));
});

test("shows the permission state when the review API denies access", async () => {
  server.use(
    http.get("*/api/v1/operator/submissions/", () =>
      HttpResponse.json({ detail: "مجوز بررسی لازم است." }, { status: 403 }),
    ),
  );
  renderPage();

  expect(
    await screen.findByRole("heading", { name: "دسترسی اپراتور لازم است" }),
  ).toBeVisible();
  expect(screen.queryByText("سعادت‌آباد")).not.toBeInTheDocument();
});

test("approves and groups a Submission with an existing Property", async () => {
  const user = userEvent.setup();
  let propertyId: string | undefined;
  serveSubmission(claimedSubmission);
  server.use(
    http.post(
      "*/api/v1/operator/submissions/:id/approve/",
      async ({ request }) => {
        propertyId = ((await request.json()) as { property_id?: string })
          .property_id;
        return HttpResponse.json({
          ...claimedSubmission,
          state: "published",
          listing_id: "50000000-0000-4000-8000-000000000005",
        });
      },
    ),
  );
  renderPage();

  await user.click(
    await screen.findByRole("button", { name: "تأیید و انتشار" }),
  );
  expect(screen.getByLabelText("شناسه شهر نرمال‌شده")).toBeVisible();
  expect(screen.getByLabelText("تعداد اتاق نرمال‌شده")).toBeVisible();
  expect(screen.getByLabelText("پارکینگ")).toBeVisible();
  expect(screen.getByLabelText("ادعاهای Source (JSON)")).toBeVisible();
  await user.type(
    screen.getByLabelText("شناسه Property موجود (اختیاری)"),
    "60000000-0000-4000-8000-000000000006",
  );
  await user.click(
    screen.getByRole("button", { name: "تأیید نهایی و انتشار" }),
  );

  await waitFor(() =>
    expect(propertyId).toBe("60000000-0000-4000-8000-000000000006"),
  );
});

test("shows historical queue entries without decision controls", async () => {
  serveSubmission({ ...pendingSubmission, state: "published" });
  renderPage();

  expect((await screen.findAllByText("منتشرشده"))[1]).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "تأیید و انتشار" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("option", { name: "ردشده" })).toBeInTheDocument();
  expect(screen.getByLabelText("شناسه شهر")).toBeInTheDocument();
  expect(screen.getByLabelText("شناسه منطقه")).toBeInTheDocument();
  expect(screen.getByLabelText("ورود به صف پیش از")).toBeInTheDocument();
});

test("retries a failed decision notification without repeating the decision", async () => {
  const user = userEvent.setup();
  let retryCount = 0;
  const notification = {
    id: "60000000-0000-4000-8000-000000000016",
    status: "failed",
    attempt_count: 4,
    failure_reason: "سرویس ایمیل پیام را نپذیرفت.",
    delivered_at: null,
    updated_at: "2026-08-22T09:05:00Z",
  };
  const failedSubmission = {
    ...pendingSubmission,
    state: "published",
    notification,
    history: pendingSubmission.history.map((event) => ({
      ...event,
      notification,
    })),
  };
  serveSubmission(failedSubmission);
  server.use(
    http.post(
      "*/api/v1/operator/submissions/:id/notifications/:notificationId/retry/",
      ({ params }) => {
        retryCount += 1;
        expect(params.notificationId).toBe(notification.id);
        return HttpResponse.json({
          ...failedSubmission,
          notification: { ...notification, status: "pending" },
          history: failedSubmission.history.map((event) => ({
            ...event,
            notification: { ...notification, status: "pending" },
          })),
        });
      },
    ),
  );
  renderPage();

  expect(await screen.findAllByText("ارسال ایمیل ناموفق بود.")).toHaveLength(2);
  await user.click(
    screen.getByRole("button", { name: "تلاش دوباره برای ارسال ایمیل" }),
  );

  await waitFor(() => expect(retryCount).toBe(1));
  expect(await screen.findAllByText("ایمیل در صف ارسال است.")).toHaveLength(2);
  expect(
    screen.queryByRole("button", { name: "تأیید و انتشار" }),
  ).not.toBeInTheDocument();
});

test("opening is read-only until the reviewer explicitly claims the Submission", async () => {
  const user = userEvent.setup();
  let claimed = false;
  serveSubmission(pendingSubmission);
  server.use(
    http.post("*/api/v1/operator/submissions/:id/claim/", () => {
      claimed = true;
      return HttpResponse.json(claimedSubmission, { status: 201 });
    }),
  );
  renderPage();

  expect(
    await screen.findByRole("button", { name: "پذیرفتن مسئولیت بررسی" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "تأیید و انتشار" }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "پذیرفتن مسئولیت بررسی" }),
  );

  await waitFor(() => expect(claimed).toBe(true));
});

test("preserves decision drafts and requires refresh and reclaim after a stale conflict", async () => {
  const user = userEvent.setup();
  let currentSubmission: Record<string, unknown> = claimedSubmission;
  const nextSubmission = {
    ...pendingSubmission,
    id: "90000000-0000-4000-8000-000000000009",
    location: {
      ...pendingSubmission.location,
      neighborhood: "اکباتان",
      address: "فاز دو",
    },
  };
  let queueResults: Record<string, unknown>[] = [currentSubmission];
  let approvalAttempts = 0;
  serveSubmission(currentSubmission);
  server.use(
    http.get("*/api/v1/operator/submissions/", () =>
      HttpResponse.json({
        count: queueResults.length,
        next: null,
        previous: null,
        results: queueResults,
      }),
    ),
    http.get("*/api/v1/operator/submissions/:id/", ({ params }) =>
      HttpResponse.json(
        params.id === pendingSubmission.id ? currentSubmission : nextSubmission,
      ),
    ),
    http.post(
      "*/api/v1/operator/submissions/:id/approve/",
      async ({ request }) => {
        approvalAttempts += 1;
        const body = (await request.json()) as { reviewed_revision?: number };
        expect(body.reviewed_revision).toBe(1);
        currentSubmission = {
          ...claimedSubmission,
          revision: 2,
          claim_status: "unclaimed",
          claim: null,
        };
        queueResults = [nextSubmission];
        return HttpResponse.json(
          {
            type: "https://example.com/problems/review_revision_conflict",
            title: "Request failed",
            status: 409,
            detail: "translated server wording must not control this branch",
            code: "review_revision_conflict",
          },
          { status: 409 },
        );
      },
    ),
    http.post("*/api/v1/operator/submissions/:id/claim/", ({ params }) => {
      expect(params.id).toBe(pendingSubmission.id);
      currentSubmission = {
        ...currentSubmission,
        claim_status: "claimed_by_me",
        claim: { ...claimedSubmission.claim, revision: 2 },
      };
      return HttpResponse.json(currentSubmission, { status: 201 });
    }),
  );
  renderPage();

  await user.click(
    await screen.findByRole("button", { name: "تأیید و انتشار" }),
  );
  await user.type(screen.getByLabelText("متراژ نرمال‌شده"), "112");
  await user.type(
    screen.getByLabelText("یادداشت داخلی (اختیاری)"),
    "مدارک بررسی شد.",
  );
  await user.click(
    screen.getByRole("button", { name: "تأیید نهایی و انتشار" }),
  );

  expect(
    await screen.findByText(
      "نسخه Submission از زمان بررسی شما تغییر کرده است.",
    ),
  ).toBeVisible();
  expect(approvalAttempts).toBe(1);
  await user.click(
    screen.getByRole("button", { name: "به‌روزرسانی Submission" }),
  );
  expect(await screen.findAllByText("اکباتان")).toHaveLength(1);
  expect(await screen.findByText("بلوار دریا")).toBeVisible();
  await user.click(
    await screen.findByRole("button", { name: "پذیرفتن مسئولیت بررسی" }),
  );
  await user.click(
    await screen.findByRole("button", { name: "تأیید و انتشار" }),
  );

  expect(screen.getByLabelText("متراژ نرمال‌شده")).toHaveValue("112");
  expect(screen.getByLabelText("یادداشت داخلی (اختیاری)")).toHaveValue(
    "مدارک بررسی شد.",
  );
  expect(approvalAttempts).toBe(1);
});

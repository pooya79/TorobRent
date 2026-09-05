import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { SubmitterDashboardPage } from "@/pages/SubmitterDashboardPage";
import { server } from "./server";

test("shows Source Proposals separately with status and next action", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/submissions/", () => HttpResponse.json([])),
    http.get("*/api/v1/source-proposals/", () =>
      HttpResponse.json([
        {
          id: "10000000-0000-4000-8000-000000000087",
          state: "draft",
          current_step: "preview",
          website_name: "خانه‌یاب",
          website_url: "https://khaneh.example/rentals",
          relationship: "website_manager",
          inventory_range: "51_200",
          sitemap_url: "",
          operator_note: "",
          authority_declared: true,
          preview: { title: "بازبینی اطلاعات وب‌سایت" },
          preview_confirmed: false,
          pending_since: null,
          available_actions: ["edit", "delete"],
          created_at: "2026-08-31T08:00:00Z",
          updated_at: "2026-08-31T09:00:00Z",
        },
      ]),
    ),
    http.delete(
      "*/api/v1/source-proposals/:proposalId/",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SubmitterDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("heading", { name: "پیشنهادهای منبع" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "پیشنهاد تازه" })).toHaveAttribute(
    "href",
    "/submitter/get-started",
  );
  expect(screen.queryByRole("link", { name: "معرفی وب‌سایت" })).toBeNull();
  expect(await screen.findByText("خانه‌یاب")).toBeVisible();
  expect(screen.getAllByText("پیش‌نویس")[0]).toBeVisible();
  expect(
    screen.getByRole("link", { name: "ادامه پیشنهاد وب‌سایت خانه‌یاب" }),
  ).toHaveAttribute(
    "href",
    "/source-proposal?proposal=10000000-0000-4000-8000-000000000087",
  );

  await user.click(
    screen.getByRole("button", { name: "حذف پیش‌نویس خانه‌یاب" }),
  );
  await user.click(screen.getByRole("button", { name: "حذف پیش‌نویس" }));

  expect(
    await screen.findByText("هنوز وب‌سایتی معرفی نکرده‌اید."),
  ).toBeVisible();
});

test("shows a Source Proposal review outcome, reason, revision, and next action", async () => {
  server.use(
    http.get("*/api/v1/submissions/", () => HttpResponse.json([])),
    http.get("*/api/v1/source-proposals/", () =>
      HttpResponse.json([
        {
          id: "10000000-0000-4000-8000-000000000088",
          state: "changes_requested",
          revision: 1,
          current_step: "preview",
          website_name: "خانه‌یاب",
          website_url: "https://khaneh.example/rentals",
          relationship: "website_manager",
          inventory_range: "51_200",
          sitemap_url: "",
          operator_note: "",
          authority_declared: true,
          preview: { title: "بازبینی اطلاعات وب‌سایت" },
          preview_confirmed: true,
          pending_since: null,
          available_actions: ["edit"],
          history: [
            {
              id: "20000000-0000-4000-8000-000000000087",
              actor_label: "representative@example.com",
              revision: 1,
              prior_state: "draft",
              new_state: "pending",
              reason: "",
              created_at: "2026-09-01T07:30:00Z",
            },
            {
              id: "20000000-0000-4000-8000-000000000088",
              actor_label: "operator@example.com",
              revision: 1,
              prior_state: "pending",
              new_state: "changes_requested",
              reason: "مدرک اختیار را تکمیل کنید.",
              created_at: "2026-09-01T08:00:00Z",
            },
          ],
          created_at: "2026-09-01T07:00:00Z",
          updated_at: "2026-09-01T08:00:00Z",
        },
      ]),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SubmitterDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect((await screen.findAllByText("نیازمند اصلاح")).length).toBeGreaterThan(
    0,
  );
  expect(await screen.findByText("نسخه ۱")).toBeVisible();
  expect(await screen.findByText("مدرک اختیار را تکمیل کنید.")).toBeVisible();
  const history = screen.getByRole("region", {
    name: "تاریخچه پیشنهاد وب‌سایت خانه‌یاب",
  });
  expect(history).toHaveTextContent("در انتظار بررسی — نسخه ۱");
  expect(history).toHaveTextContent("نیازمند اصلاح — نسخه ۱");
  expect(
    screen.getByRole("link", { name: "اصلاح پیشنهاد وب‌سایت خانه‌یاب" }),
  ).toHaveAttribute(
    "href",
    "/source-proposal?proposal=10000000-0000-4000-8000-000000000088",
  );
});

test("lists the Submitter's draft state and server-backed resume action", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/submissions/", () =>
      HttpResponse.json([
        {
          id: "10000000-0000-4000-8000-000000000010",
          role: "agent",
          state: "draft",
          current_step: "rental_terms",
          media_complete: false,
          location: {
            neighborhood: "سعادت‌آباد",
            neighborhood_id: "30000000-0000-4000-8000-000000000043",
          },
          property_facts: null,
          rental_terms: null,
          features: {},
          description: "",
          contact: null,
          review: {},
          available_actions: ["edit", "submit", "delete"],
          created_at: "2026-08-22T08:00:00Z",
          updated_at: "2026-08-22T09:00:00Z",
        },
      ]),
    ),
    http.delete(
      "*/api/v1/submissions/:submissionId/",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SubmitterDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByText("ملک در سعادت‌آباد")).toBeVisible();
  expect(screen.getAllByText("پیش‌نویس")[0]).toBeVisible();
  expect(screen.getByText("مرحله کنونی: شرایط اجاره")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "ادامه ملک در سعادت‌آباد" }),
  ).toHaveAttribute(
    "href",
    "/add-submission?submission=10000000-0000-4000-8000-000000000010&step=rental_terms",
  );
  expect(
    screen.getByRole("link", { name: "ارسال برای بررسی ملک در سعادت‌آباد" }),
  ).toHaveAttribute(
    "href",
    "/add-submission?submission=10000000-0000-4000-8000-000000000010&step=review",
  );

  await user.click(
    screen.getByRole("button", {
      name: "حذف پیش‌نویس ملک در سعادت‌آباد",
    }),
  );
  await user.click(screen.getByRole("button", { name: "حذف پیش‌نویس" }));

  expect(
    await screen.findByText(
      "هنوز آگهی ثبت‌شده‌ای ندارید. با ثبت مشخصات ملک شروع کنید.",
    ),
  ).toBeVisible();
});

test("shows current review state, reason, history, and the available edit action", async () => {
  server.use(
    http.get("*/api/v1/submissions/", () =>
      HttpResponse.json([
        {
          id: "10000000-0000-4000-8000-000000000012",
          role: "owner",
          state: "changes_requested",
          revision: 1,
          current_step: "review",
          media_complete: true,
          images: [],
          location: { neighborhood: "سعادت‌آباد" },
          property_facts: null,
          rental_terms: null,
          features: {},
          description: "",
          contact: null,
          review: {},
          history: [
            {
              id: "40000000-0000-4000-8000-000000000004",
              actor_reference: "50000000-0000-4000-8000-000000000005",
              actor_label: "operator@example.com",
              actor_email: "operator@example.com",
              revision: 1,
              prior_state: "pending",
              new_state: "changes_requested",
              reason: "شماره تماس را اصلاح کنید.",
              created_at: "2026-08-22T09:00:00Z",
            },
          ],
          available_actions: ["edit"],
          created_at: "2026-08-22T08:00:00Z",
          updated_at: "2026-08-22T09:00:00Z",
        },
      ]),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SubmitterDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect((await screen.findAllByText("نیازمند اصلاح")).length).toBeGreaterThan(
    0,
  );
  expect(await screen.findAllByText("شماره تماس را اصلاح کنید.")).toHaveLength(
    2,
  );
  expect(await screen.findByText("نسخه ۱")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "اصلاح ملک در سعادت‌آباد" }),
  ).toHaveAttribute(
    "href",
    "/add-submission?submission=10000000-0000-4000-8000-000000000012&step=review",
  );
});

test("shows decision email delivery state without hiding the durable decision", async () => {
  server.use(
    http.get("*/api/v1/submissions/", () =>
      HttpResponse.json([
        {
          id: "10000000-0000-4000-8000-000000000014",
          role: "owner",
          state: "rejected",
          revision: 1,
          current_step: "review",
          media_complete: true,
          images: [],
          location: { neighborhood: "سعادت‌آباد" },
          property_facts: null,
          rental_terms: null,
          features: {},
          description: "",
          contact: null,
          review: {},
          history: [
            {
              id: "40000000-0000-4000-8000-000000000014",
              actor_reference: "50000000-0000-4000-8000-000000000005",
              actor_label: "operator@example.com",
              actor_email: "operator@example.com",
              revision: 1,
              prior_state: "pending",
              new_state: "rejected",
              reason: "شرایط انتشار را ندارد.",
              created_at: "2026-08-22T09:00:00Z",
            },
          ],
          notification: {
            status: "failed",
            attempt_count: 4,
            delivered_at: null,
            updated_at: "2026-08-22T09:05:00Z",
          },
          available_actions: [],
          created_at: "2026-08-22T08:00:00Z",
          updated_at: "2026-08-22T09:00:00Z",
        },
      ]),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SubmitterDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByText("ردشده")).toBeVisible();
  expect(await screen.findAllByText("شرایط انتشار را ندارد.")).toHaveLength(2);
  expect(screen.getByText(/ارسال ایمیل ناموفق بود/)).toBeVisible();
});

test("warns about final-week expiry and confirms unchanged availability in one action", async () => {
  const user = userEvent.setup();
  let confirmationCount = 0;
  const submission = {
    id: "10000000-0000-4000-8000-000000000013",
    role: "owner",
    state: "published",
    current_step: "review",
    media_complete: true,
    images: [],
    location: { neighborhood: "سعادت‌آباد" },
    property_facts: null,
    rental_terms: null,
    features: {},
    description: "",
    contact: null,
    review: {},
    history: [],
    available_actions: [
      "edit",
      "confirm_availability",
      "mark_unavailable",
      "archive",
    ],
    availability: {
      state: "published",
      confirmed_at: "2026-08-01T10:00:00Z",
      available_until: "2026-08-29T10:00:00Z",
      expiring_soon: true,
    },
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-22T09:00:00Z",
  };
  server.use(
    http.get("*/api/v1/submissions/", () => HttpResponse.json([submission])),
    http.post(
      "*/api/v1/submissions/:submissionId/confirm-availability/",
      () => {
        confirmationCount += 1;
        return HttpResponse.json({
          ...submission,
          availability: {
            ...submission.availability,
            confirmed_at: "2026-08-23T10:00:00Z",
            available_until: "2026-09-22T10:00:00Z",
            expiring_soon: false,
          },
        });
      },
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SubmitterDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByText(/در هفت روز آینده منقضی می‌شود/),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "تأیید موجودی" }));

  expect(confirmationCount).toBe(1);
  expect(
    await screen.findByText("موجودی آگهی برای ۳۰ روز دیگر تأیید شد."),
  ).toBeVisible();
  expect(screen.queryByText(/در هفت روز آینده منقضی می‌شود/)).toBeNull();
});

test.each([
  ["approval_required", "نتایج هر بار استخراج نیازمند تأیید اپراتور است."],
  ["automatic", "نتایج معتبر هر بار استخراج می‌تواند خودکار منتشر شود."],
])(
  "shows the approved Source Assignment and %s review mode",
  async (mode, explanation) => {
    server.use(
      http.get("*/api/v1/submissions/", () => HttpResponse.json([])),
      http.get("*/api/v1/source-proposals/", () =>
        HttpResponse.json([
          {
            id: "assigned-proposal",
            state: "approved",
            discovery_stage: "complete",
            website_name: "پیشنهاد وب‌سایت",
            website_url: "https://www.khaneh.example/rentals",
            revision: 1,
            available_actions: [],
            history: [
              {
                id: "approval",
                new_state: "approved",
                revision: 1,
                reason: "پروفایل منبع تأیید شد.",
                created_at: "2026-09-05T08:00:00Z",
              },
            ],
            assignment: {
              id: 12,
              state: "active",
              source: {
                id: "source",
                display_name: "خانه‌یاب",
                domain: "www.khaneh.example",
              },
              active_profile_version: { id: "version", number: 3 },
              review_mode: mode,
              created_at: "2026-09-05T08:00:00Z",
              revoked_at: null,
            },
          },
        ]),
      ),
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter>
          <SubmitterDashboardPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("تخصیص منبع فعال است")).toBeVisible();
    expect(screen.getByText("خانه‌یاب")).toBeVisible();
    expect(screen.getByText("www.khaneh.example")).toBeVisible();
    expect(screen.getByText("نسخه فعال پروفایل: ۳")).toBeVisible();
    expect(screen.getByText(explanation)).toBeVisible();
    expect(screen.getByText("پروفایل منبع تأیید شد.")).toBeVisible();
    expect(
      screen.queryByText("کشف پایان یافت؛ در انتظار بررسی پروفایل"),
    ).toBeNull();
    expect(
      screen.queryByText(
        "Source اعتبارسنجی شد؛ هیچ Listingی خودکار منتشر نشده است.",
      ),
    ).toBeNull();
  },
);

test("submits an assigned URL and displays run counters and transient errors", async () => {
  const user = userEvent.setup();
  let submitted = false;
  const runRequest = {
    id: "a0000000-0000-4000-8000-000000000001",
    submitted_url: "https://khaneh.example/rentals",
    canonical_url: "https://khaneh.example/rentals",
    state: "failed",
    created_at: "2026-09-05T08:00:00Z",
    run: {
      state: "failed",
      attempts: 1,
      discovered: 10,
      extracted: 8,
      published: 0,
      needs_attention: 2,
      rejected: 1,
      failed: 1,
      errors: [
        { code: "timeout", detail: "دریافت صفحه ناموفق بود.", transient: true },
      ],
    },
  };
  server.use(
    http.get("*/api/v1/submissions/", () => HttpResponse.json([])),
    http.get("*/api/v1/source-proposals/", () =>
      HttpResponse.json([
        {
          id: "10000000-0000-4000-8000-000000000087",
          state: "approved",
          website_name: "خانه‌یاب",
          available_actions: [],
          history: [],
          assignment: {
            id: 7,
            state: "active",
            source: { domain: "khaneh.example", display_name: "خانه‌یاب" },
            active_profile_version: { id: "version", number: 1 },
            review_mode: "approval_required",
            recent_requests: submitted ? [runRequest] : [],
          },
        },
      ]),
    ),
    http.post(
      "*/api/v1/source-proposals/:id/extraction-requests/",
      async ({ request }) => {
        expect(await request.json()).toEqual({
          assignment: 7,
          url: "https://khaneh.example/rentals",
        });
        submitted = true;
        return HttpResponse.json(runRequest, { status: 201 });
      },
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <SubmitterDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.type(
    await screen.findByLabelText("نشانی برای استخراج"),
    "https://khaneh.example/rentals",
  );
  await user.click(screen.getByRole("button", { name: "درخواست استخراج" }));
  expect(await screen.findByText("خطای موقت")).toBeVisible();
  for (const label of [
    "کشف‌شده",
    "استخراج‌شده",
    "منتشرشده",
    "نیازمند توجه",
    "ردشده",
    "ناموفق",
  ]) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  }
});

test("combines neighborhood search with status and clears empty filters", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/submissions/", () =>
      HttpResponse.json([
        {
          id: "draft-one",
          state: "draft",
          role: "owner",
          images: [],
          location: { neighborhood: "سعادت‌آباد" },
          updated_at: "2026-09-05T10:00:00Z",
          available_actions: ["edit"],
        },
        {
          id: "pending-two",
          state: "pending",
          role: "owner",
          images: [],
          location: { neighborhood: "پونک" },
          updated_at: "2026-09-05T10:00:00Z",
          available_actions: [],
        },
      ]),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SubmitterDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    await screen.findByRole("heading", { name: "ملک در پونک" }),
  ).toBeVisible();
  await user.type(screen.getByLabelText("جست‌وجوی آگهی‌ها"), "پونک");
  expect(
    screen.queryByRole("heading", { name: "ملک در سعادت‌آباد" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "پیش‌نویس" }));
  expect(
    screen.getByText("آگهی‌ای با این جست‌وجو و وضعیت پیدا نشد."),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "نمایش همه آگهی‌ها" }));
  expect(
    screen.getByRole("heading", { name: "ملک در سعادت‌آباد" }),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: "ملک در پونک" })).toBeVisible();
});

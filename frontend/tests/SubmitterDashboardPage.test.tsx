import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { SubmitterDashboardPage } from "@/pages/SubmitterDashboardPage";
import { server } from "./server";

test("shows Source Proposals separately with status and next action", async () => {
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
          preview: { simulated: true },
          preview_confirmed: false,
          pending_since: null,
          available_actions: ["edit"],
          created_at: "2026-08-31T08:00:00Z",
          updated_at: "2026-08-31T09:00:00Z",
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

  expect(
    await screen.findByRole("heading", { name: "پیشنهادهای منبع" }),
  ).toBeVisible();
  expect(await screen.findByText("خانه‌یاب")).toBeVisible();
  expect(screen.getByText("پیش‌نویس")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "ادامه Source Proposal خانه‌یاب" }),
  ).toHaveAttribute("href", "/source-proposal");
});

test("lists the Submitter's draft state and server-backed resume action", async () => {
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
          available_actions: ["edit", "submit"],
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

  expect(await screen.findByText("ملک در سعادت‌آباد")).toBeVisible();
  expect(screen.getByText("پیش‌نویس")).toBeVisible();
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

  expect(await screen.findByText("نیازمند اصلاح")).toBeVisible();
  expect(screen.getAllByText("شماره تماس را اصلاح کنید.")).toHaveLength(2);
  expect(screen.getByText("نسخه ۱")).toBeVisible();
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
  expect(screen.getAllByText("شرایط انتشار را ندارد.")).toHaveLength(2);
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

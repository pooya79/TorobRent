import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation } from "react-router";
import { expect, test } from "vitest";

import { SourceProposalPage } from "@/pages/SourceProposalPage";
import { server } from "./server";

const proposalId = "10000000-0000-4000-8000-000000000087";

function LocationSearch() {
  return <output data-testid="location-search">{useLocation().search}</output>;
}

test("saves website details, labels the deterministic preview as simulated, and confirms it", async () => {
  const user = userEvent.setup();
  let savedBody: unknown;
  let submittedBody: unknown;
  const base = {
    id: proposalId,
    state: "draft" as const,
    current_step: "details" as const,
    website_name: "",
    website_url: "",
    relationship: "",
    inventory_range: "",
    sitemap_url: "",
    operator_note: "",
    authority_declared: false,
    preview: {},
    preview_confirmed: false,
    pending_since: null,
    available_actions: ["edit"],
    created_at: "2026-08-31T08:00:00Z",
    updated_at: "2026-08-31T08:00:00Z",
  };
  server.use(
    http.post("*/api/v1/source-proposals/", () =>
      HttpResponse.json(base, { status: 201 }),
    ),
    http.patch("*/api/v1/source-proposals/:proposalId/draft/", () =>
      HttpResponse.json(base),
    ),
    http.patch(
      "*/api/v1/source-proposals/:proposalId/",
      async ({ request }) => {
        savedBody = await request.json();
        return HttpResponse.json({ ...base, current_step: "preview" });
      },
    ),
    http.post("*/api/v1/source-proposals/:proposalId/preview/", () =>
      HttpResponse.json({
        ...base,
        current_step: "preview",
        preview: {
          simulated: true,
          title: "پیش‌نمایش شبیه‌سازی‌شده",
          disclaimer:
            "این نمونه فقط برای نمایش روند آینده ساخته شده و هیچ درخواست زنده‌ای به وب‌سایت شما ارسال نشده است.",
          estimated_count: null,
          examples: [
            { title: "نمونه ملک مسکونی", status: "نیازمند بررسی اپراتور" },
          ],
        },
      }),
    ),
    http.post(
      "*/api/v1/source-proposals/:proposalId/submit/",
      async ({ request }) => {
        submittedBody = await request.json();
        return HttpResponse.json({
          ...base,
          state: "pending",
          current_step: "preview",
          preview_confirmed: true,
          pending_since: "2026-08-31T09:00:00Z",
          available_actions: [],
        });
      },
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.type(await screen.findByLabelText("نام وب‌سایت"), "خانه‌یاب");
  await user.type(
    screen.getByLabelText("نشانی صفحه اصلی یا کاتالوگ"),
    "https://khaneh.example/rentals",
  );
  await user.selectOptions(
    screen.getByLabelText("رابطه شما با وب‌سایت"),
    "website_manager",
  );
  await user.selectOptions(
    screen.getByLabelText("تعداد تقریبی ملک‌ها"),
    "51_200",
  );
  await user.click(screen.getByLabelText(/اختیار معرفی این وب‌سایت/));
  await user.click(
    screen.getByRole("button", { name: "ذخیره و مشاهده پیش‌نمایش" }),
  );

  expect(await screen.findByText("پیش‌نمایش شبیه‌سازی‌شده")).toBeVisible();
  expect(screen.getByText(/هیچ درخواست زنده‌ای/)).toBeVisible();
  expect(screen.getByText(/تعداد قطعی یا تضمین‌شده‌ای/)).toBeVisible();
  expect(savedBody).toMatchObject({
    website_name: "خانه‌یاب",
    website_url: "https://khaneh.example/rentals",
    relationship: "website_manager",
    inventory_range: "51_200",
    authority_declared: true,
  });

  await user.click(
    screen.getByLabelText(/این پیش‌نمایش شبیه‌سازی‌شده را بررسی کردم/),
  );
  await user.click(screen.getByRole("button", { name: "ارسال برای بررسی" }));

  expect(await screen.findByText("در انتظار بررسی اپراتور")).toBeVisible();
  expect(submittedBody).toEqual({ preview_confirmed: true });
});

test("restores a pending Source Proposal after reload", async () => {
  server.use(
    http.post("*/api/v1/source-proposals/", () =>
      HttpResponse.json({
        id: proposalId,
        state: "pending",
        current_step: "preview",
        website_name: "خانه‌یاب",
        website_url: "https://khaneh.example/rentals",
        relationship: "website_owner",
        inventory_range: "unknown",
        sitemap_url: "",
        operator_note: "",
        authority_declared: true,
        preview: { simulated: true },
        preview_confirmed: true,
        pending_since: "2026-08-31T09:00:00Z",
        available_actions: [],
        created_at: "2026-08-31T08:00:00Z",
        updated_at: "2026-08-31T09:00:00Z",
      }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByText("در انتظار بررسی اپراتور")).toBeVisible();
  expect(screen.getByText(/خانه‌یاب ثبت شده است/)).toBeVisible();
});

test("resumes the Source Proposal selected from the dashboard", async () => {
  let createCalled = false;
  server.use(
    http.post("*/api/v1/source-proposals/", () => {
      createCalled = true;
      return HttpResponse.json({}, { status: 500 });
    }),
    http.get("*/api/v1/source-proposals/:proposalId/", ({ params }) =>
      HttpResponse.json({
        id: params.proposalId,
        state: "changes_requested",
        revision: 2,
        current_step: "preview",
        website_name: "منبع انتخاب‌شده",
        website_url: "https://selected.example/rentals",
        relationship: "website_manager",
        inventory_range: "51_200",
        sitemap_url: "",
        operator_note: "همین پیشنهاد باید باز شود.",
        authority_declared: true,
        preview: null,
        preview_confirmed: false,
        pending_since: null,
        available_actions: ["edit"],
        history: [],
        created_at: "2026-08-31T08:00:00Z",
        updated_at: "2026-08-31T09:00:00Z",
      }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[`/source-proposal?proposal=${proposalId}`]}
      >
        <SourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByLabelText("نام وب‌سایت")).toHaveValue(
    "منبع انتخاب‌شده",
  );
  expect(screen.getByLabelText("یادداشت برای اپراتور (اختیاری)")).toHaveValue(
    "همین پیشنهاد باید باز شود.",
  );
  expect(createCalled).toBe(false);
});

test("clears the one-shot new flag after starting from the dashboard", async () => {
  let createBody: unknown;
  server.use(
    http.post("*/api/v1/source-proposals/", async ({ request }) => {
      createBody = await request.json();
      return HttpResponse.json({
        id: proposalId,
        state: "draft",
        current_step: "details",
        website_name: "",
        website_url: "",
        relationship: "",
        inventory_range: "",
        sitemap_url: "",
        operator_note: "",
        authority_declared: false,
        preview: null,
        preview_confirmed: false,
        pending_since: null,
        available_actions: ["edit"],
        created_at: "2026-08-31T08:00:00Z",
        updated_at: "2026-08-31T08:00:00Z",
      });
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/source-proposal?new=1"]}>
        <SourceProposalPage />
        <LocationSearch />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("heading", {
      name: "Source Proposal وب‌سایت اجاره",
    }),
  ).toBeVisible();
  expect(createBody).toEqual({ start_new: true });
  await waitFor(() =>
    expect(screen.getByTestId("location-search")).toHaveTextContent(/^$/),
  );
});

test("keeps entered details available when URL validation fails", async () => {
  const user = userEvent.setup();
  server.use(
    http.post("*/api/v1/source-proposals/", () =>
      HttpResponse.json({
        id: proposalId,
        state: "draft",
        current_step: "details",
        website_name: "",
        website_url: "",
        relationship: "",
        inventory_range: "",
        sitemap_url: "",
        operator_note: "",
        authority_declared: false,
        preview: {},
        preview_confirmed: false,
        pending_since: null,
        available_actions: ["edit"],
        created_at: "2026-08-31T08:00:00Z",
        updated_at: "2026-08-31T08:00:00Z",
      }),
    ),
    http.patch("*/api/v1/source-proposals/:proposalId/", () =>
      HttpResponse.json({ detail: "نشانی عمومی معتبر نیست." }, { status: 400 }),
    ),
    http.patch("*/api/v1/source-proposals/:proposalId/draft/", () =>
      HttpResponse.json({
        id: proposalId,
        state: "draft",
        current_step: "details",
        website_name: "خانه‌یاب",
        website_url: "https://unsafe.example/catalog",
        relationship: "website_owner",
        inventory_range: "unknown",
        sitemap_url: "",
        operator_note: "",
        authority_declared: true,
        preview: null,
        preview_confirmed: false,
        pending_since: null,
        available_actions: ["edit"],
        created_at: "2026-08-31T08:00:00Z",
        updated_at: "2026-08-31T08:00:00Z",
      }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  const name = await screen.findByLabelText("نام وب‌سایت");
  const url = screen.getByLabelText("نشانی صفحه اصلی یا کاتالوگ");
  await user.type(name, "خانه‌یاب");
  await user.type(url, "https://unsafe.example/catalog");
  await user.click(screen.getByLabelText(/اختیار معرفی این وب‌سایت/));
  await user.click(
    screen.getByRole("button", { name: "ذخیره و مشاهده پیش‌نمایش" }),
  );

  expect(await screen.findByText(/نشانی عمومی معتبر نیست/)).toBeVisible();
  expect(name).toHaveValue("خانه‌یاب");
  expect(url).toHaveValue("https://unsafe.example/catalog");
});

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

test("does not create a Source Proposal draft merely by opening the empty form", async () => {
  let createCount = 0;
  server.use(
    http.get("*/api/v1/source-proposals/", () => HttpResponse.json([])),
    http.post("*/api/v1/source-proposals/", () => {
      createCount += 1;
      return HttpResponse.json(
        {
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
          available_actions: ["edit", "delete"],
        },
        { status: 201 },
      );
    }),
  );

  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/source-proposal?new=1"]}>
        <SourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("heading", { name: "معرفی وب‌سایت اجاره" }),
  ).toBeVisible();
  expect(createCount).toBe(0);
});

test("cleans up a new empty draft when the first details save is rejected", async () => {
  const user = userEvent.setup();
  let removed = false;
  server.use(
    http.get("*/api/v1/source-proposals/", () => HttpResponse.json([])),
    http.post("*/api/v1/source-proposals/", () =>
      HttpResponse.json(
        {
          id: proposalId,
          state: "draft",
          current_step: "details",
          website_name: "",
          website_url: "",
          available_actions: ["edit", "delete"],
        },
        { status: 201 },
      ),
    ),
    http.patch("*/api/v1/source-proposals/:proposalId/", () =>
      HttpResponse.json({ detail: "نشانی عمومی معتبر نیست." }, { status: 400 }),
    ),
    http.delete("*/api/v1/source-proposals/:proposalId/", () => {
      removed = true;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <MemoryRouter initialEntries={["/source-proposal?new=1"]}>
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

  expect(await screen.findByText("نشانی عمومی معتبر نیست.")).toBeVisible();
  await waitFor(() => expect(removed).toBe(true));
  expect(name).toHaveValue("خانه‌یاب");
  expect(url).toHaveValue("https://unsafe.example/catalog");
});

test("saves website details and confirms the no-fetch summary", async () => {
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
    http.get("*/api/v1/source-proposals/", () => HttpResponse.json([])),
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
          title: "بازبینی اطلاعات وب‌سایت",
          disclaimer:
            "تا پیش از تأیید نشانی توسط اپراتور هیچ درخواستی به وب‌سایت ارسال نمی‌شود.",
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

  expect(await screen.findByText("بازبینی اطلاعات وب‌سایت")).toBeVisible();
  expect(screen.getByText(/هیچ درخواستی به وب‌سایت/)).toBeVisible();
  expect(screen.getByText(/تعداد قطعی یا تضمین‌شده‌ای/)).toBeVisible();
  expect(savedBody).toMatchObject({
    website_name: "خانه‌یاب",
    website_url: "https://khaneh.example/rentals",
    relationship: "website_manager",
    inventory_range: "51_200",
    authority_declared: true,
  });

  await user.click(screen.getByLabelText(/این اطلاعات را بررسی کردم/));
  await user.click(screen.getByRole("button", { name: "ارسال برای بررسی" }));

  expect(await screen.findByText("در انتظار بررسی اپراتور")).toBeVisible();
  expect(submittedBody).toEqual({ preview_confirmed: true });
});

test("restores a pending Source Proposal with actionable discovery feedback", async () => {
  server.use(
    http.get("*/api/v1/source-proposals/", () =>
      HttpResponse.json([
        {
          id: proposalId,
          state: "pending",
          is_current: true,
          discovery_message:
            "صفحه آگهی قابل استفاده‌ای یافت نشد؛ نشانی نمونه دیگری به تیم بررسی بدهید یا ساختار وب‌سایت را اصلاح کنید.",
          current_step: "preview",
          website_name: "خانه‌یاب",
          website_url: "https://khaneh.example/rentals",
          relationship: "website_owner",
          inventory_range: "unknown",
          sitemap_url: "",
          operator_note: "",
          authority_declared: true,
          preview: { title: "بازبینی اطلاعات وب‌سایت" },
          preview_confirmed: true,
          pending_since: "2026-08-31T09:00:00Z",
          available_actions: [],
          created_at: "2026-08-31T08:00:00Z",
          updated_at: "2026-08-31T09:00:00Z",
        },
      ]),
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
  expect(
    screen.getByText(/نشانی نمونه دیگری به تیم بررسی بدهید/),
  ).toBeVisible();
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

test("creates a draft from valid details and replaces the one-shot new flag", async () => {
  const user = userEvent.setup();
  let createBody: unknown;
  const created = {
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
    preview: null,
    preview_confirmed: false,
    pending_since: null,
    available_actions: ["edit"],
    created_at: "2026-08-31T08:00:00Z",
    updated_at: "2026-08-31T08:00:00Z",
  };
  server.use(
    http.get("*/api/v1/source-proposals/", () => HttpResponse.json([])),
    http.post("*/api/v1/source-proposals/", async ({ request }) => {
      createBody = await request.json();
      return HttpResponse.json(created, { status: 201 });
    }),
    http.patch("*/api/v1/source-proposals/:proposalId/", () =>
      HttpResponse.json({
        ...created,
        website_name: "خانه‌یاب",
        website_url: "https://khaneh.example/",
        authority_declared: true,
      }),
    ),
    http.post("*/api/v1/source-proposals/:proposalId/preview/", () =>
      HttpResponse.json({
        ...created,
        preview: {
          title: "بازبینی اطلاعات وب‌سایت",
          disclaimer: "هیچ درخواستی به وب‌سایت ارسال نمی‌شود.",
        },
      }),
    ),
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
      name: "معرفی وب‌سایت اجاره",
    }),
  ).toBeVisible();
  expect(createBody).toBeUndefined();
  await user.type(screen.getByLabelText("نام وب‌سایت"), "خانه‌یاب");
  await user.type(
    screen.getByLabelText("نشانی صفحه اصلی یا کاتالوگ"),
    "https://khaneh.example/",
  );
  await user.click(screen.getByLabelText(/اختیار معرفی این وب‌سایت/));
  await user.click(
    screen.getByRole("button", { name: "ذخیره و مشاهده پیش‌نمایش" }),
  );
  expect(createBody).toEqual({ start_new: true });
  await waitFor(() =>
    expect(screen.getByTestId("location-search")).toHaveTextContent(
      `?proposal=${proposalId}`,
    ),
  );
});

test("keeps entered details available when URL validation fails", async () => {
  const user = userEvent.setup();
  const existing = {
    id: proposalId,
    state: "draft",
    is_current: true,
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
  };
  server.use(
    http.get("*/api/v1/source-proposals/", () => HttpResponse.json([existing])),
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

test("shows one actionable error without autosaving the URL when submit receives focus", async () => {
  const user = userEvent.setup();
  const existing = {
    id: proposalId,
    state: "draft",
    is_current: true,
    current_step: "details",
    website_name: "خانه روشن",
    website_url: "https://old.example/",
    relationship: "website_owner",
    inventory_range: "more_than_200",
    sitemap_url: "",
    operator_note: "",
    authority_declared: true,
    preview: {},
    preview_confirmed: false,
    pending_since: null,
    available_actions: ["edit"],
    created_at: "2026-08-31T08:00:00Z",
    updated_at: "2026-08-31T08:00:00Z",
  };
  const autosavedBodies: unknown[] = [];
  const problem = {
    type: "https://example.com/problems/validation_error",
    title: "Bad request",
    status: 400,
    detail:
      "این نشانی فقط برای پیش‌نمایش مرورگر است. برای ثبت منبع از http://jsonld.demo.example.com/rentals/ استفاده کنید.",
    code: "validation_error",
  };
  server.use(
    http.get("*/api/v1/source-proposals/", () => HttpResponse.json([existing])),
    http.patch(
      "*/api/v1/source-proposals/:proposalId/draft/",
      async ({ request }) => {
        autosavedBodies.push(await request.json());
        return HttpResponse.json(problem, { status: 400 });
      },
    ),
    http.patch("*/api/v1/source-proposals/:proposalId/", () =>
      HttpResponse.json(problem, { status: 400 }),
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <MemoryRouter>
        <SourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  const url = await screen.findByLabelText("نشانی صفحه اصلی یا کاتالوگ");
  await user.clear(url);
  await user.type(url, "http://jsonld.localhost:8088/rentals/");
  await user.click(
    screen.getByRole("button", { name: "ذخیره و مشاهده پیش‌نمایش" }),
  );

  expect(await screen.findByText(/فقط برای پیش‌نمایش مرورگر/)).toBeVisible();
  expect(screen.getAllByText(/فقط برای پیش‌نمایش مرورگر/)).toHaveLength(1);
  expect(autosavedBodies).not.toContainEqual({
    website_url: "http://jsonld.localhost:8088/rentals/",
  });
});

test("clears an old autosave error after a successful explicit save", async () => {
  const user = userEvent.setup();
  const existing = {
    id: proposalId,
    state: "draft",
    is_current: true,
    current_step: "details",
    website_name: "خانه روشن",
    website_url: "https://old.example/",
    relationship: "website_owner",
    inventory_range: "more_than_200",
    sitemap_url: "",
    operator_note: "",
    authority_declared: true,
    preview: {},
    preview_confirmed: false,
    available_actions: ["edit"],
  };
  server.use(
    http.get("*/api/v1/source-proposals/", () => HttpResponse.json([existing])),
    http.patch("*/api/v1/source-proposals/:proposalId/draft/", () =>
      HttpResponse.json({ detail: "خطای ذخیره خودکار" }, { status: 400 }),
    ),
    http.patch("*/api/v1/source-proposals/:proposalId/", () =>
      HttpResponse.json({ ...existing, current_step: "preview" }),
    ),
    http.post("*/api/v1/source-proposals/:proposalId/preview/", () =>
      HttpResponse.json({
        ...existing,
        current_step: "preview",
        preview: {
          title: "بازبینی اطلاعات وب‌سایت",
          disclaimer: "هیچ درخواستی به وب‌سایت ارسال نمی‌شود.",
        },
      }),
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <MemoryRouter>
        <SourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  const url = await screen.findByLabelText("نشانی صفحه اصلی یا کاتالوگ");
  await user.clear(url);
  await user.type(url, "https://valid.example/");
  await user.tab();
  expect(await screen.findByText("خطای ذخیره خودکار")).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "ذخیره و مشاهده پیش‌نمایش" }),
  );

  expect(await screen.findByText("بازبینی اطلاعات وب‌سایت")).toBeVisible();
  expect(screen.queryByText("خطای ذخیره خودکار")).not.toBeInTheDocument();
});

test.each([
  ["automatic", "نتایج معتبر درخواست‌های تازه خودکار منتشر می‌شود."],
  ["approval_required", "نتایج هر بار استخراج نیازمند تأیید اپراتور است."],
])(
  "resumes an active website showing %s publication mode without operator controls",
  async (mode, label) => {
    server.use(
      http.get("*/api/v1/source-proposals/", () =>
        HttpResponse.json([
          {
            id: proposalId,
            state: "approved",
            is_current: true,
            current_website_conflict: false,
            website_name: "خانه‌یاب",
            website_url: "https://khaneh.example/",
            available_actions: [],
            assignment: {
              id: 12,
              state: "active",
              source: { display_name: "خانه‌یاب", domain: "khaneh.example" },
              active_profile_version: { id: "version", number: 1 },
              review_mode: mode,
              mode_revision: 1,
              recent_requests: [],
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
        <MemoryRouter initialEntries={["/source-proposal?new=1"]}>
          <SourceProposalPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("وب‌سایت جاری شما")).toBeInTheDocument();
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ثبت روش انتشار" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/برای جایگزینی وب‌سایت، ابتدا/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("نام وب‌سایت")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "هماهنگی با اپراتور در مرکز پیام‌ها" }),
    ).toHaveAttribute("href", "/messages");
  },
);

test("keeps Contact review team available while correcting a requested revision", async () => {
  server.use(
    http.get("*/api/v1/source-proposals/:proposalId/", () =>
      HttpResponse.json({
        id: proposalId,
        state: "draft",
        revision: 2,
        current_step: "details",
        website_name: "خانه‌یاب",
        website_url: "https://khaneh.example/rentals",
        relationship: "website_manager",
        inventory_range: "51_200",
        sitemap_url: "",
        operator_note: "",
        authority_declared: true,
        preview: {},
        history: [],
      }),
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter
        initialEntries={[`/source-proposal?proposal=${proposalId}`]}
      >
        <SourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    await screen.findByRole("button", { name: "تماس با تیم بررسی" }),
  ).toBeEnabled();
});

test.each(["approved", "pending"])(
  "representative sees a paused Source during %s without extraction or resume controls",
  async (state) => {
    server.use(
      http.get("*/api/v1/source-proposals/", () =>
        HttpResponse.json([
          {
            id: proposalId,
            state,
            is_current: true,
            current_website_conflict: false,
            website_name: "خانه‌یاب",
            website_url: "https://khaneh.example/",
            available_actions: [],
            assignment: {
              id: 12,
              state: "active",
              source: {
                display_name: "خانه‌یاب",
                domain: "khaneh.example",
                processing_paused: true,
                processing_revision: 1,
              },
              active_profile_version: { id: "version", number: 1 },
              review_mode: "automatic",
              mode_revision: 0,
              recent_requests: [],
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
        <MemoryRouter initialEntries={["/source-proposal?new=1"]}>
          <SourceProposalPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("پردازش منبع متوقف است.")).toBeVisible();
    expect(screen.getByText("تخصیص منبع فعال است")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "ازسرگیری با استخراج تازه" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "درخواست استخراج" }),
    ).not.toBeInTheDocument();
  },
);

test("refreshes active Source status while the representative keeps the screen open", async () => {
  let paused = false;
  const current = () => ({
    id: proposalId,
    state: "approved",
    is_current: true,
    current_website_conflict: false,
    website_name: "خانه‌یاب",
    website_url: "https://khaneh.example/",
    available_actions: [],
    assignment: {
      id: 12,
      state: "active",
      source: {
        display_name: "خانه‌یاب",
        domain: "khaneh.example",
        processing_paused: paused,
        processing_revision: paused ? 1 : 0,
      },
      active_profile_version: { id: "version", number: 1 },
      review_mode: "automatic",
      mode_revision: 0,
      recent_requests: [],
    },
  });
  server.use(
    http.get("*/api/v1/source-proposals/", () =>
      HttpResponse.json([current()]),
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/source-proposal?new=1"]}>
        <SourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("پردازش منبع فعال است.")).toBeVisible();
  paused = true;
  expect(
    await screen.findByText("پردازش منبع متوقف است.", {}, { timeout: 6500 }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "درخواست استخراج" }),
  ).not.toBeInTheDocument();
}, 10000);

test("resolves the current website again when returning with an old revoked case cached", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["source-proposal-resume", null, true], {
    id: "old-proposal",
    state: "revoked",
    available_actions: [],
    website_url: "https://old.example/",
  });
  let listed = false;
  server.use(
    http.get("*/api/v1/source-proposals/", () => {
      listed = true;
      return HttpResponse.json([]);
    }),
  );
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/source-proposal?new=1"]}>
        <SourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(listed).toBe(true));
  expect(await screen.findByLabelText("نام وب‌سایت")).toBeVisible();
});

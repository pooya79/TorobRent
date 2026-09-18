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

function renderForm(path = "/dashboard/website?new=1") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <SourceProposalPage />
        <LocationSearch />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

const details = {
  website_name: "خانه‌یاب",
  website_url: "https://khaneh.example/rentals",
  relationship: "website_owner",
  inventory_range: "unknown",
  sitemap_url: "",
  operator_note: "",
  authority_declared: true,
};

test("opening, typing and blurring do not persist a website draft", async () => {
  const user = userEvent.setup();
  const mutations: string[] = [];
  server.use(
    http.get("*/api/v1/source-proposals/", () => HttpResponse.json([])),
    http.post("*/api/v1/source-proposals/", () => {
      mutations.push("create");
      return HttpResponse.json({});
    }),
    http.patch("*/api/v1/source-proposals/:id/draft/", () => {
      mutations.push("autosave");
      return HttpResponse.json({});
    }),
  );
  renderForm();
  await user.type(
    await screen.findByLabelText("نام وب‌سایت"),
    details.website_name,
  );
  await user.type(
    screen.getByLabelText("نشانی صفحه اصلی یا کاتالوگ"),
    details.website_url,
  );
  await user.tab();
  expect(mutations).toEqual([]);
  expect(
    screen.queryByRole("button", { name: /ذخیره|پیش‌نمایش/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "ارسال برای بررسی" }),
  ).toBeDisabled();
});

test("submits all details once and opens the pending review status", async () => {
  const user = userEvent.setup();
  const requests: unknown[] = [];
  server.use(
    http.get("*/api/v1/source-proposals/", () => HttpResponse.json([])),
    http.post("*/api/v1/source-proposals/", async ({ request }) => {
      requests.push(await request.json());
      return HttpResponse.json(
        {
          id: proposalId,
          ...details,
          state: "pending",
          is_current: true,
          available_actions: [],
        },
        { status: 201 },
      );
    }),
  );
  renderForm();
  await user.type(
    await screen.findByLabelText("نام وب‌سایت"),
    details.website_name,
  );
  await user.type(
    screen.getByLabelText("نشانی صفحه اصلی یا کاتالوگ"),
    details.website_url,
  );
  await user.click(screen.getByLabelText(/اختیار معرفی این وب‌سایت/));
  await user.click(screen.getByRole("button", { name: "ارسال برای بررسی" }));
  expect(await screen.findByText("در انتظار بررسی اپراتور")).toBeVisible();
  expect(requests).toEqual([details]);
  expect(screen.getByTestId("location-search")).toHaveTextContent(
    `?proposal=${proposalId}`,
  );
  expect(screen.queryByLabelText("نام وب‌سایت")).not.toBeInTheDocument();
});

test("failed submission retains entered details and can be retried", async () => {
  const user = userEvent.setup();
  let attempts = 0;
  server.use(
    http.get("*/api/v1/source-proposals/", () => HttpResponse.json([])),
    http.post("*/api/v1/source-proposals/", () => {
      attempts++;
      return attempts === 1
        ? HttpResponse.json(
            { detail: "نشانی عمومی معتبر نیست." },
            { status: 400 },
          )
        : HttpResponse.json(
            {
              id: proposalId,
              ...details,
              state: "pending",
              is_current: true,
              available_actions: [],
            },
            { status: 201 },
          );
    }),
  );
  renderForm();
  const name = await screen.findByLabelText("نام وب‌سایت");
  await user.type(name, details.website_name);
  await user.type(
    screen.getByLabelText("نشانی صفحه اصلی یا کاتالوگ"),
    details.website_url,
  );
  await user.click(screen.getByLabelText(/اختیار معرفی این وب‌سایت/));
  await user.click(screen.getByRole("button", { name: "ارسال برای بررسی" }));
  expect(await screen.findByText("نشانی عمومی معتبر نیست.")).toBeVisible();
  expect(name).toHaveValue(details.website_name);
  expect(screen.getByLabelText("نشانی صفحه اصلی یا کاتالوگ")).toHaveValue(
    details.website_url,
  );
  await user.click(screen.getByRole("button", { name: "ارسال برای بررسی" }));
  expect(await screen.findByText("در انتظار بررسی اپراتور")).toBeVisible();
  expect(attempts).toBe(2);
});

test.each(["changes_requested", "draft"])(
  "submits an existing %s case without autosaving edits",
  async (state) => {
    const user = userEvent.setup();
    let submitted: unknown;
    let saves = 0;
    const existing = {
      id: proposalId,
      ...details,
      state,
      is_current: true,
      available_actions: ["edit"],
    };
    server.use(
      http.get("*/api/v1/source-proposals/:id/", () =>
        HttpResponse.json(existing),
      ),
      http.patch("*/api/v1/source-proposals/:id/draft/", () => {
        saves++;
        return HttpResponse.json(existing);
      }),
      http.post(
        "*/api/v1/source-proposals/:id/submit/",
        async ({ request }) => {
          submitted = await request.json();
          return HttpResponse.json({ ...existing, state: "pending" });
        },
      ),
    );
    renderForm(`/dashboard/website?proposal=${proposalId}`);
    const note = await screen.findByLabelText("یادداشت برای اپراتور (اختیاری)");
    await user.type(note, "اصلاح شد");
    await user.tab();
    expect(saves).toBe(0);
    await user.click(
      screen.getByRole("button", { name: "ارسال مجدد برای بررسی" }),
    );
    expect(await screen.findByText("در انتظار بررسی اپراتور")).toBeVisible();
    expect(submitted).toEqual({ ...details, operator_note: "اصلاح شد" });
  },
);

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
        initialEntries={[`/dashboard/website?proposal=${proposalId}`]}
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
        <MemoryRouter initialEntries={["/dashboard/website?new=1"]}>
          <SourceProposalPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("وب‌سایت جاری شما")).toBeInTheDocument();
    expect(screen.queryByText(label)).not.toBeInTheDocument();
    expect(screen.getByText("وب‌سایت تأیید شده است")).toBeVisible();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "ثبت روش انتشار" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/برای جایگزینی وب‌سایت، ابتدا/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("نام وب‌سایت")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByText("می‌خواهید وب‌سایت دیگری معرفی کنید؟"),
    );
    expect(
      screen.getByRole("link", { name: "هماهنگی با اپراتور در مرکز پیام‌ها" }),
    ).toHaveAttribute("href", "/dashboard/messages");
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
        initialEntries={[`/dashboard/website?proposal=${proposalId}`]}
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
        <MemoryRouter initialEntries={["/dashboard/website?new=1"]}>
          <SourceProposalPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText("بررسی آگهی‌های تازه موقتاً متوقف است."),
    ).toBeVisible();
    expect(screen.getByText("وب‌سایت تأیید شده است")).toBeVisible();
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
      <MemoryRouter initialEntries={["/dashboard/website?new=1"]}>
        <SourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText(
      "نتیجه درخواست‌های شما در همین صفحه نمایش داده می‌شود.",
    ),
  ).toBeVisible();
  paused = true;
  expect(
    await screen.findByText(
      "بررسی آگهی‌های تازه موقتاً متوقف است.",
      {},
      { timeout: 6500 },
    ),
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
      <MemoryRouter initialEntries={["/dashboard/website?new=1"]}>
        <SourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(listed).toBe(true));
  expect(await screen.findByLabelText("نام وب‌سایت")).toBeVisible();
});

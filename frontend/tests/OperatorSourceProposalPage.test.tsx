import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, test } from "vitest";

import { OperatorSourceProposalPage } from "@/pages/OperatorSourceProposalPage";
import { server } from "./server";

beforeEach(() => {
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
  );
});

const proposal = {
  id: "10000000-0000-4000-8000-000000000088",
  state: "pending",
  discovery_stage: "awaiting_url",
  revision: 1,
  current_step: "preview",
  website_name: "خانه‌یاب",
  website_url: "https://khaneh.example/rentals",
  relationship: "website_manager",
  inventory_range: "51_200",
  sitemap_url: "https://khaneh.example/sitemap.xml",
  operator_note: "دسته اجاره از فروش جداست.",
  authority_declared: true,
  preview: {
    simulated: true,
    title: "پیش‌نمایش شبیه‌سازی‌شده",
    disclaimer: "هیچ درخواست زنده‌ای ارسال نشده است.",
    estimated_count: null,
    inventory_range: "51_200",
    examples: [{ title: "نمونه ملک مسکونی", status: "نیازمند بررسی اپراتور" }],
  },
  preview_confirmed: true,
  needs_reconciliation: true,
  pending_since: "2026-09-01T08:00:00Z",
  available_actions: [],
  history: [],
  created_at: "2026-09-01T07:00:00Z",
  updated_at: "2026-09-01T08:00:00Z",
};

test("inspects, claims, and requests changes to a Source Proposal", async () => {
  const user = userEvent.setup();
  let claimed = false;
  let requestedReason = "";
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([proposal]),
    ),
    http.post("*/api/v1/operator/source-proposals/:proposalId/claim/", () => {
      claimed = true;
      return HttpResponse.json(
        {
          id: "20000000-0000-4000-8000-000000000088",
          operator_label: "operator@example.com",
          revision: 1,
          expires_at: "2026-09-01T08:15:00Z",
          created_at: "2026-09-01T08:00:00Z",
        },
        { status: 201 },
      );
    }),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/request-changes/",
      async ({ request }) => {
        const body = (await request.json()) as { reason: string };
        requestedReason = body.reason;
        return HttpResponse.json({
          ...proposal,
          state: "changes_requested",
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
        <OperatorSourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("heading", { name: "خانه‌یاب" }),
  ).toBeVisible();
  expect(screen.getByText("مدیر وب‌سایت")).toBeVisible();
  expect(screen.getAllByText("۵۱ تا ۲۰۰")).toHaveLength(1);
  expect(screen.getByText("دسته اجاره از فروش جداست.")).toBeVisible();
  expect(screen.getByText(/دامنه تکراری/)).toBeVisible();
  expect(screen.getByText("در انتظار تأیید نشانی")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "شروع بررسی" }));
  expect(claimed).toBe(true);
  await user.type(
    screen.getByLabelText("دلیل تصمیم"),
    "مدرک اختیار را تکمیل کنید.",
  );
  await user.click(screen.getByRole("button", { name: "درخواست اصلاح" }));

  expect(requestedReason).toBe("مدرک اختیار را تکمیل کنید.");
  expect(await screen.findByText("تصمیم ثبت شد.")).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "خانه‌یاب" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("Source Proposal در انتظار بررسی وجود ندارد."),
  ).toBeVisible();
});

test("reviews each simulated External Listing candidate independently", async () => {
  const user = userEvent.setup();
  const candidates = [
    {
      id: "30000000-0000-4000-8000-000000000001",
      source_proposal_id: proposal.id,
      source: {
        id: "40000000-0000-4000-8000-000000000001",
        display_name: "خانه‌یاب",
        domain: "khaneh.example",
        is_active: true,
      },
      listing_id: null,
      state: "pending",
      revision: 1,
      simulated: true,
      title: "آپارتمان شبیه‌سازی‌شده برای بررسی",
      external_url: "https://khaneh.example/sample-listings/residential-1",
      property_type: "apartment",
      area_sqm: 85,
      room_count: 2,
      deposit_rial: 5_000_000_000,
      monthly_rent_rial: 250_000_000,
      description: "هیچ داده یا رسانه‌ای از وب‌سایت دریافت نشده است.",
      media: [],
      history: [],
      created_at: "2026-09-01T08:00:00Z",
      updated_at: "2026-09-01T08:00:00Z",
    },
    {
      id: "30000000-0000-4000-8000-000000000002",
      source_proposal_id: proposal.id,
      source: {
        id: "40000000-0000-4000-8000-000000000001",
        display_name: "خانه‌یاب",
        domain: "khaneh.example",
        is_active: true,
      },
      listing_id: null,
      state: "pending",
      revision: 1,
      simulated: true,
      title: "دفتر شبیه‌سازی‌شده برای بررسی",
      external_url: "https://khaneh.example/sample-listings/commercial-2",
      property_type: "office",
      area_sqm: 110,
      room_count: null,
      deposit_rial: 8_000_000_000,
      monthly_rent_rial: 400_000_000,
      description: "هیچ داده یا رسانه‌ای از وب‌سایت دریافت نشده است.",
      media: [],
      history: [],
      created_at: "2026-09-01T08:00:01Z",
      updated_at: "2026-09-01T08:00:01Z",
    },
  ];
  const decisions: Array<{ id: string; kind: string; reason?: string }> = [];
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([]),
    ),
    http.get("*/api/v1/operator/external-listing-candidates/", () =>
      HttpResponse.json(candidates),
    ),
    http.post(
      "*/api/v1/operator/external-listing-candidates/:candidateId/claim/",
      () =>
        HttpResponse.json(
          {
            id: "50000000-0000-4000-8000-000000000001",
            operator_label: "operator@example.com",
            revision: 1,
            expires_at: "2026-09-01T08:15:00Z",
            created_at: "2026-09-01T08:00:00Z",
          },
          { status: 201 },
        ),
    ),
    http.post(
      "*/api/v1/operator/external-listing-candidates/:candidateId/request-changes/",
      async ({ params, request }) => {
        const body = (await request.json()) as { reason: string };
        decisions.push({
          id: String(params.candidateId),
          kind: "request-changes",
          reason: body.reason,
        });
        return HttpResponse.json({
          ...candidates[0],
          state: "changes_requested",
        });
      },
    ),
    http.post(
      "*/api/v1/operator/external-listing-candidates/:candidateId/approve/",
      ({ params }) => {
        decisions.push({ id: String(params.candidateId), kind: "approve" });
        return HttpResponse.json({
          ...candidates[1],
          state: "published",
          listing_id: "60000000-0000-4000-8000-000000000001",
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
        <OperatorSourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("heading", {
      name: "آپارتمان شبیه‌سازی‌شده برای بررسی",
    }),
  ).toBeVisible();
  expect(screen.getAllByText("داده شبیه‌سازی‌شده")).toHaveLength(2);
  expect(screen.getAllByText("بدون رسانه خارجی")).toHaveLength(2);
  expect(screen.getByText(candidates[0]!.external_url)).toBeVisible();

  await user.click(
    screen.getByRole("button", {
      name: "شروع بررسی آپارتمان شبیه‌سازی‌شده برای بررسی",
    }),
  );
  await user.type(
    screen.getByLabelText("دلیل تصمیم آپارتمان شبیه‌سازی‌شده برای بررسی"),
    "جزئیات این مورد نیازمند اصلاح است.",
  );
  await user.click(
    screen.getByRole("button", {
      name: "درخواست اصلاح آپارتمان شبیه‌سازی‌شده برای بررسی",
    }),
  );
  expect(decisions[0]).toEqual({
    id: candidates[0]!.id,
    kind: "request-changes",
    reason: "جزئیات این مورد نیازمند اصلاح است.",
  });
  expect(
    screen.getByRole("heading", {
      name: "دفتر شبیه‌سازی‌شده برای بررسی",
    }),
  ).toBeVisible();

  await user.click(
    screen.getByRole("button", {
      name: "شروع بررسی دفتر شبیه‌سازی‌شده برای بررسی",
    }),
  );
  await user.click(
    screen.getByLabelText("تأیید انتشار دفتر شبیه‌سازی‌شده برای بررسی"),
  );
  await user.click(
    screen.getByRole("button", {
      name: "تأیید و انتشار دفتر شبیه‌سازی‌شده برای بررسی",
    }),
  );
  expect(decisions[1]).toEqual({ id: candidates[1]!.id, kind: "approve" });
  expect(await screen.findByText("تصمیم Listing ثبت شد.")).toBeVisible();
});

test("URL approval keeps the case visible with Discovery evidence and renewable responsibility", async () => {
  const user = userEvent.setup();
  let claimCount = 0;
  const completed = {
    ...proposal,
    discovery_stage: "complete",
    discovery: {
      expires_at: "2026-09-06T08:00:00Z",
      evidence: {
        page_count: 8,
        detail_page_count: 6,
        classifications: { rental_listing: 6, rental_index: 1, fetch_error: 1 },
        structures: [
          {
            fingerprint: "group-1",
            representative_url_shape: "/rent/:id",
            coverage: 0.75,
            selected: true,
            supported_page_urls: ["/rent/1"],
            page_urls: ["/rent/1"],
            excluded_page_urls: [],
          },
        ],
        exclusions: ["https://khaneh.example/unsupported"],
        samples: [
          {
            url: "https://khaneh.example/rent/1",
            classification: "rental_listing",
            evidence: ["مبلغ اجاره شناسایی شد"],
          },
        ],
        failures: [
          {
            url: "https://khaneh.example/unavailable",
            code: "timeout",
            detail: "زمان دریافت به پایان رسید",
          },
        ],
      },
    },
  };
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([proposal]),
    ),
    http.post("*/api/v1/operator/source-proposals/:proposalId/claim/", () => {
      claimCount += 1;
      return HttpResponse.json(
        { expires_at: "2026-09-05T08:15:00Z" },
        { status: 201 },
      );
    }),
    http.post("*/api/v1/operator/source-proposals/:proposalId/approve/", () =>
      HttpResponse.json(completed),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OperatorSourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole("button", { name: "شروع بررسی" }));
  await user.click(screen.getByLabelText(/نشانی و اختیار نماینده/));
  await user.click(
    screen.getByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  );
  expect(
    await screen.findByText("کشف پایان یافت؛ در انتظار بررسی پروفایل"),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: "خانه‌یاب" })).toBeVisible();
  expect(screen.getByText(/صفحات بررسی‌شده: ۸/)).toBeVisible();
  expect(screen.getByText(/ساختار غالب؛ پوشش: ۷۵/)).toBeVisible();
  expect(screen.getByText("https://khaneh.example/unsupported")).toBeVisible();
  expect(screen.getByText("مبلغ اجاره شناسایی شد")).toBeVisible();
  expect(screen.getByText("زمان دریافت به پایان رسید")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "تمدید مسئولیت بررسی" }));
  expect(claimCount).toBe(2);
  server.use(
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/claim/release/",
      () => HttpResponse.json({ ...completed, discovery_stage: "released" }),
    ),
  );
  await user.type(screen.getByLabelText("دلیل تصمیم"), "بررسی متوقف شد");
  await user.click(
    screen.getByRole("button", { name: "آزادسازی مسئولیت و رزرو" }),
  );
  expect(
    await screen.findByText("رزرو آزاد شد؛ در انتظار بررسی دوباره"),
  ).toBeVisible();
});

test("reviews profile evidence, edits a field, and approves only a validated version", async () => {
  const user = userEvent.setup();
  const version = {
    id: "profile-1",
    reservation: "discovery-1",
    number: 1,
    parent: null,
    provenance: "discovery",
    status: "proposed",
    is_active: false,
    rules: {
      floor_area_sqm: { kind: "css", selector: ".wrong", transform: "integer" },
    },
    structural_fingerprint: "fingerprint",
    created_by_label: "",
    created_at: "2026-09-05T08:00:00Z",
    exclusions: ["https://khaneh.example/unsupported"],
    validation: {
      training_page_urls: ["https://khaneh.example/train"],
      held_out_page_urls: ["https://khaneh.example/held"],
      approval_enabled: false,
      fields: { floor_area_sqm: { coverage: 0, passed: false, conflicts: 1 } },
    },
    samples: [
      {
        canonical_url: "https://khaneh.example/held",
        normalized: { city: "تهران", deposit_rial: 5_000_000_000 },
        conflicts: { floor_area_sqm: [85, 500] },
        unresolved: ["floor_area_sqm"],
        evidence: {
          floor_area_sqm: [
            {
              source_locator: ".area",
              normalized_value: 85,
              evidence_snippet: "۸۵ متر",
              disposition: "conflict",
            },
          ],
        },
      },
    ],
  };
  const caseData = {
    ...proposal,
    discovery_stage: "complete",
    discovery: { id: "discovery-1", evidence: { page_count: 10 } },
    profile_versions: [version],
  };
  const edits: unknown[] = [];
  let approved = false;
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([caseData]),
    ),
    http.post("*/api/v1/operator/source-proposals/:proposalId/claim/", () =>
      HttpResponse.json({}, { status: 201 }),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/profile/edit/",
      async ({ request }) => {
        const body = (await request.json()) as { rules: unknown };
        edits.push(body);
        return HttpResponse.json({
          ...caseData,
          profile_versions: [
            {
              ...version,
              id: "profile-2",
              number: 2,
              parent: version.id,
              provenance: "manual",
              rules: body.rules,
              validation: {
                ...version.validation,
                approval_enabled: true,
                fields: {
                  floor_area_sqm: { coverage: 1, passed: true, conflicts: 0 },
                },
              },
            },
            version,
          ],
        });
      },
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/profile/approve/",
      async ({ request }) => {
        expect(await request.json()).toEqual({
          reviewed_revision: 1,
          reviewed_profile_version: "profile-2",
          confirmed: true,
          review_mode: "automatic",
        });
        approved = true;
        return HttpResponse.json({ ...caseData, state: "approved" });
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
        <OperatorSourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("پروفایل منبع — نسخه ۱")).toBeVisible();
  expect(screen.getByText("۸۵ متر")).toBeVisible();
  expect(screen.getByText("۵۰۰٬۰۰۰٬۰۰۰ تومان")).toBeVisible();
  expect(screen.getByText("https://khaneh.example/unsupported")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "شروع بررسی" }));
  expect(
    screen.getByRole("button", { name: "تأیید پروفایل و تخصیص منبع" }),
  ).toBeDisabled();
  await user.selectOptions(
    screen.getByLabelText("فیلد مورد اصلاح"),
    "floor_area_sqm",
  );
  await user.type(screen.getByLabelText("مسیر عنصر"), ".area");
  await user.click(
    screen.getByRole("button", { name: "ثبت نسخه و اعتبارسنجی" }),
  );
  expect(await screen.findByText("پروفایل منبع — نسخه ۲")).toBeVisible();
  expect(edits).toEqual([
    {
      reviewed_revision: 1,
      reviewed_profile_version: "profile-1",
      rules: {
        floor_area_sqm: {
          kind: "css",
          selector: ".area",
          transform: "integer",
        },
      },
    },
  ]);
  await user.click(
    screen.getByLabelText("نمونه‌ها و اعتبارسنجی پروفایل را بررسی کردم."),
  );
  expect(
    screen.getByRole("button", { name: "تأیید پروفایل و تخصیص منبع" }),
  ).toBeDisabled();
  await user.selectOptions(
    screen.getByLabelText("روش بررسی نتایج"),
    "automatic",
  );
  await user.click(
    screen.getByRole("button", { name: "تأیید پروفایل و تخصیص منبع" }),
  );
  expect(approved).toBe(true);
  expect(await screen.findByText("تصمیم ثبت شد.")).toBeVisible();
});

test("requires field selection for explicit repair and shows failure history", async () => {
  const user = userEvent.setup();
  const version = {
    id: "profile-1",
    reservation: "discovery-1",
    number: 1,
    provenance: "discovery",
    status: "proposed",
    is_active: false,
    rules: {},
    validation: {
      approval_enabled: false,
      fields: {},
      training_page_urls: [],
      held_out_page_urls: [],
    },
    samples: [],
    exclusions: [],
  };
  const caseData = {
    ...proposal,
    discovery_stage: "complete",
    discovery: { id: "discovery-1", evidence: { page_count: 10 } },
    profile_versions: [version],
    profile_repairs: [],
  };
  const calls: unknown[] = [];
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([caseData]),
    ),
    http.post("*/api/v1/operator/source-proposals/:proposalId/claim/", () =>
      HttpResponse.json({}, { status: 201 }),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/profile/repair/",
      async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json({
          ...caseData,
          profile_repairs: [
            {
              id: "repair-1",
              parent: "profile-1",
              selected_fields: ["floor_area_sqm"],
              outcome: "timeout",
              detail:
                "مهلت پاسخ مدل تمام شد؛ دوباره درخواست دهید یا دستی اصلاح کنید.",
              model: "test-model",
              structured_result: null,
            },
          ],
        });
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
        <OperatorSourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText("پروفایل منبع — نسخه ۱");
  expect(
    screen.queryByRole("button", { name: "درخواست اصلاح هوشمند" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "شروع بررسی" }));
  const repair = screen.getByRole("button", { name: "درخواست اصلاح هوشمند" });
  expect(repair).toBeDisabled();
  expect(calls).toEqual([]);
  await user.click(screen.getByLabelText("اصلاح هوشمند متراژ"));
  expect(calls).toEqual([]);
  await user.click(repair);
  expect(
    await screen.findByText(
      "مهلت پاسخ مدل تمام شد؛ دوباره درخواست دهید یا دستی اصلاح کنید.",
    ),
  ).toBeVisible();
  expect(calls).toEqual([
    {
      request_id: expect.any(String) as unknown,
      reviewed_revision: 1,
      reviewed_profile_version: "profile-1",
      selected_fields: ["floor_area_sqm"],
    },
  ]);
  expect(screen.getByText("پروفایل منبع — نسخه ۱")).toBeVisible();
});

test("keeps approved Source cases available for run monitoring", async () => {
  const user = userEvent.setup();
  let reviewBody: unknown;
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "operator",
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/profile/review/",
      async ({ request }) => {
        reviewBody = await request.json();
        return HttpResponse.json({
          ...proposal,
          revision: 2,
          discovery_stage: "queued",
        });
      },
    ),
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([
        {
          ...proposal,
          state: "approved",
          assignment: {
            id: 8,
            review_operator: "operator",
            state: "active",
            source: { domain: "khaneh.example", display_name: "خانه‌یاب" },
            active_profile_version: { id: "version", number: 1 },
            review_mode: "approval_required",
            recent_requests: [
              {
                id: "request",
                canonical_url: "https://khaneh.example/new-rentals",
                state: "running",
                created_at: "2026-09-05T08:00:00Z",
                run: {
                  attempts: 1,
                  discovered: 0,
                  extracted: 0,
                  published: 0,
                  needs_attention: 0,
                  rejected: 0,
                  failed: 0,
                  errors: [],
                },
              },
            ],
          },
        },
      ]),
    ),
    http.get("*/api/v1/operator/external-listing-candidates/", () =>
      HttpResponse.json([]),
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <OperatorSourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText("https://khaneh.example/new-rentals"),
  ).toBeVisible();
  expect(screen.getByText("در حال استخراج")).toBeVisible();
  expect(screen.queryByRole("button", { name: "شروع بررسی" })).toBeNull();
  expect(screen.queryByRole("button", { name: "درخواست استخراج" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "آغاز بررسی نسخه تازه پروفایل" }),
  ).toBeVisible();
  const begin = screen.getByRole("button", {
    name: "آغاز بررسی نسخه تازه پروفایل",
  });
  expect(begin).toBeDisabled();
  await user.click(
    screen.getByRole("checkbox", {
      name: "دریافت دوباره صفحات و بررسی نسخه تازه پروفایل را تأیید می‌کنم.",
    }),
  );
  await user.click(begin);
  expect(reviewBody).toEqual({ reviewed_revision: 1, confirmed: true });
  expect(
    await screen.findByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).toBeDisabled();
});

test("reviews run samples and sends one revision-checked batch approval", async () => {
  const user = userEvent.setup();
  let approved = false;
  const bodies: unknown[] = [];
  const run = {
    id: "run-1",
    revision: 4,
    state: "complete",
    attempts: 1,
    discovered: 2,
    extracted: 2,
    published: 0,
    needs_attention: 1,
    rejected: 0,
    failed: 0,
    errors: [],
    decisions: [],
    candidates: [
      {
        id: "valid",
        title: "آپارتمان معتبر",
        external_url: "https://khaneh.example/valid",
        state: "pending",
        validation_errors: {},
        area_sqm: 85,
        deposit_rial: 5000000000,
        monthly_rent_rial: 200000000,
      },
      {
        id: "exception",
        title: "متراژ نامشخص",
        external_url: "https://khaneh.example/exception",
        state: "pending",
        validation_errors: { area_sqm: ["متراژ الزامی است"] },
      },
    ],
  };
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "operator",
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
    http.get("*/api/v1/operator/external-listing-candidates/", () =>
      HttpResponse.json([]),
    ),
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([
        {
          ...proposal,
          state: "approved",
          assignment: {
            id: 8,
            state: "active",
            review_operator: "operator",
            source: { domain: "khaneh.example", display_name: "خانه‌یاب" },
            active_profile_version: { id: "version", number: 1 },
            review_mode: "approval_required",
            recent_requests: [
              {
                id: "request",
                canonical_url: "https://khaneh.example/rentals",
                state: "complete",
                created_at: "2026-09-05T08:00:00Z",
                run: approved
                  ? {
                      ...run,
                      revision: 5,
                      published: 1,
                      candidates: run.candidates.map((c) =>
                        c.id === "valid" ? { ...c, state: "published" } : c,
                      ),
                    }
                  : run,
              },
            ],
          },
        },
      ]),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/runs/:runId/approve/",
      async ({ request }) => {
        bodies.push(await request.json());
        approved = true;
        return HttpResponse.json({ ...run, published: 1, revision: 5 });
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
        <OperatorSourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("آپارتمان معتبر")).toBeVisible();
  expect(screen.getByText("متراژ الزامی است")).toBeVisible();
  const button = screen.getByRole("button", { name: "انتشار همه نتایج معتبر" });
  expect(button).toBeDisabled();
  await user.click(
    screen.getByLabelText(
      "نمونه‌ها را بررسی و انتشار نتایج معتبر را تأیید می‌کنم",
    ),
  );
  await user.click(button);
  expect(await screen.findByText("نتایج معتبر منتشر شد.")).toBeVisible();
  expect(bodies).toEqual([{ reviewed_revision: 4, confirmed: true }]);
});

test("corrects an exception and approves its new revision", async () => {
  const user = userEvent.setup();
  let candidate = {
    id: "exception",
    title: "آگهی نیازمند اصلاح",
    source: { display_name: "خانه‌یاب", domain: "khaneh.example" },
    state: "pending",
    revision: 1,
    simulated: false,
    extraction_run: "run",
    external_url: "https://khaneh.example/detail",
    property_type: "apartment",
    area_sqm: null as number | null,
    room_count: 2,
    deposit_rial: 5000000000,
    monthly_rent_rial: 200000000,
    validation_errors: { area_sqm: ["متراژ را بررسی کنید"] } as Record<
      string,
      string[]
    >,
    evidence: {},
    history: [],
  };
  const corrections: unknown[] = [];
  const approvals: unknown[] = [];
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([]),
    ),
    http.get("*/api/v1/operator/external-listing-candidates/", () =>
      HttpResponse.json(candidate.state === "published" ? [] : [candidate]),
    ),
    http.post(
      "*/api/v1/operator/external-listing-candidates/:candidateId/claim/",
      () => HttpResponse.json({ revision: 1 }, { status: 201 }),
    ),
    http.post(
      "*/api/v1/operator/external-listing-candidates/:candidateId/correct/",
      async ({ request }) => {
        corrections.push(await request.json());
        candidate = {
          ...candidate,
          area_sqm: 95,
          revision: 2,
          validation_errors: {},
        };
        return HttpResponse.json(candidate);
      },
    ),
    http.post(
      "*/api/v1/operator/external-listing-candidates/:candidateId/approve/",
      async ({ request }) => {
        approvals.push(await request.json());
        candidate = { ...candidate, state: "published" };
        return HttpResponse.json(candidate);
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
        <OperatorSourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(
    await screen.findByRole("button", {
      name: "شروع بررسی آگهی نیازمند اصلاح",
    }),
  );
  await user.type(screen.getByLabelText("متراژ (متر مربع)"), "95");
  await user.type(screen.getByLabelText("دلیل اصلاح"), "بررسی سند");
  await user.click(screen.getByRole("button", { name: "ذخیره اصلاح آگهی" }));
  expect(
    await screen.findByText("اصلاح ذخیره شد؛ اعتبارسنجی دوباره انجام شد."),
  ).toBeVisible();
  expect(corrections).toEqual([
    { reviewed_revision: 1, reason: "بررسی سند", values: { area_sqm: 95 } },
  ]);
  await user.click(screen.getByLabelText("تأیید انتشار آگهی نیازمند اصلاح"));
  await user.click(
    screen.getByRole("button", { name: "تأیید و انتشار آگهی نیازمند اصلاح" }),
  );
  expect(await screen.findByText("تصمیم Listing ثبت شد.")).toBeVisible();
  expect(approvals).toEqual([{ reviewed_revision: 2, confirmed: true }]);
});

test("revokes an assignment with a reason and the reviewed revision", async () => {
  const user = userEvent.setup();
  let body: unknown;
  server.use(
    http.get("*/api/v1/auth/me/", () =>
      HttpResponse.json({
        id: "operator",
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([
        {
          ...proposal,
          state: "approved",
          assignment: {
            id: 8,
            state: "active",
            review_operator: "operator",
            source: { domain: "khaneh.example", display_name: "خانه‌یاب" },
            active_profile_version: { id: "version", number: 1 },
            review_mode: "approval_required",
            recent_requests: [],
          },
        },
      ]),
    ),
    http.get("*/api/v1/operator/external-listing-candidates/", () =>
      HttpResponse.json([]),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/assignment/revoke/",
      async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          ...proposal,
          state: "revoked",
          revision: 2,
        });
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
        <OperatorSourceProposalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const button = await screen.findByRole("button", { name: "لغو تخصیص منبع" });
  expect(button).toBeDisabled();
  await user.type(
    screen.getByLabelText("دلیل لغو تخصیص"),
    "اختیار نماینده تأیید نشد",
  );
  await user.click(button);
  expect(body).toEqual({
    reviewed_revision: 1,
    reason: "اختیار نماینده تأیید نشد",
  });
  expect(await screen.findByText("تصمیم ثبت شد.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "لغو تخصیص منبع" })).toBeNull();
});

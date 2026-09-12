import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, test } from "vitest";

import { OperatorSourceProposalDetailPage } from "@/pages/OperatorSourceProposalDetailPage";
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
    title: "بازبینی اطلاعات وب‌سایت",
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
          expires_at: new Date(Date.now() + 900_000).toISOString(),
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
      <MemoryRouter initialEntries={["/#overview"]}>
        <OperatorSourceProposalDetailPage proposalId={proposal.id} />
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
  await user.click(screen.getByRole("tab", { name: "نشانی و کشف" }));
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
  expect(screen.getByRole("heading", { name: "خانه‌یاب" })).toBeVisible();
});

test("URL approval keeps the case visible with Discovery evidence and renewable responsibility", async () => {
  const user = userEvent.setup();
  let claimCount = 0;
  const completed = {
    ...proposal,
    discovery_stage: "complete",
    discovery: {
      max_pages: 250,
      target_detail_pages: 200,
      expires_at: "2026-09-06T08:00:00Z",
      evidence: {
        page_count: 8,
        stop_reason: "frontier_exhausted",
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
        { expires_at: new Date(Date.now() + 900_000).toISOString() },
        { status: 201 },
      );
    }),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/approve/",
      async ({ request }) => {
        expect(await request.json()).toEqual({
          reviewed_revision: 1,
          confirmed: true,
          max_pages: 250,
          target_detail_pages: 200,
        });
        return HttpResponse.json(completed);
      },
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/#url"]}>
        <OperatorSourceProposalDetailPage proposalId={proposal.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole("button", { name: "شروع بررسی" }));
  await user.click(screen.getByLabelText(/نشانی و اختیار نماینده/));
  const approve = screen.getByRole("button", {
    name: "تأیید نشانی و شروع کشف",
  });
  expect(approve).toBeDisabled();
  expect(approve).toHaveAccessibleDescription(
    /سقف صفحات و تعداد آگهی هدف را وارد کنید/,
  );
  expect(screen.getByText(/موجودی تقریبی اعلام‌شده/)).toHaveTextContent(
    "۵۱ تا ۲۰۰",
  );
  await user.type(screen.getByLabelText("سقف صفحات قابل بررسی"), "250");
  await user.type(screen.getByLabelText("تعداد آگهی اجاره هدف"), "251");
  expect(approve).toBeDisabled();
  await user.clear(screen.getByLabelText("تعداد آگهی اجاره هدف"));
  await user.type(screen.getByLabelText("تعداد آگهی اجاره هدف"), "200");
  await user.click(
    screen.getByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  );
  expect(
    await screen.findByText("کشف پایان یافت؛ در انتظار بررسی پروفایل"),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: "خانه‌یاب" })).toBeVisible();
  expect(screen.getByText(/صفحات بررسی‌شده: ۸/)).toBeVisible();
  expect(screen.getByText("پیوند تازه‌ای برای ادامه پیدا نشد.")).toBeVisible();
  expect(
    screen.getByText(/حدود تأییدشده: سقف ۲۵۰ صفحه؛ هدف ۲۰۰/),
  ).toBeVisible();
  expect(screen.getByText(/ساختار غالب؛ پوشش: ۷۵/)).toBeVisible();
  expect(screen.getByText("https://khaneh.example/unsupported")).toBeVisible();
  expect(screen.getByText("مبلغ اجاره شناسایی شد")).toBeVisible();
  expect(screen.getByText("زمان دریافت به پایان رسید")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "تمدید مهلت بررسی" }));
  expect(claimCount).toBe(2);
  server.use(
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/claim/release/",
      () => HttpResponse.json({ ...completed, discovery_stage: "released" }),
    ),
  );
  await user.type(screen.getByLabelText("دلیل تصمیم"), "بررسی متوقف شد");
  await user.click(
    screen.getByRole("button", { name: "انصراف از بررسی و آزادسازی رزرو" }),
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
                quality_passed: true,
                limitations_present: false,
                rules_valid: true,
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
          limitations_acknowledged: false,
          reason: "",
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
      <MemoryRouter initialEntries={["/#profile"]}>
        <OperatorSourceProposalDetailPage proposalId={proposal.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("پروفایل منبع — نسخه ۱")).toBeVisible();
  expect(screen.getByText("۸۵ متر")).toBeVisible();
  expect(screen.getByText("۵۰۰٬۰۰۰٬۰۰۰ تومان")).toBeVisible();
  expect(screen.getByText("https://khaneh.example/unsupported")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "پذیرش بررسی پروفایل" }));
  expect(
    screen.getByRole("button", { name: "تأیید پروفایل و تخصیص منبع" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "اصلاح دستی" }));
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
      <MemoryRouter initialEntries={["/#profile"]}>
        <OperatorSourceProposalDetailPage proposalId={proposal.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText("پروفایل منبع — نسخه ۱");
  expect(
    screen.queryByRole("button", { name: "درخواست اصلاح هوشمند" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "پذیرش بررسی پروفایل" }));
  await user.click(screen.getByRole("button", { name: "اصلاح هوشمند" }));
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
    http.post("*/api/v1/operator/source-proposals/:proposalId/claim/", () =>
      HttpResponse.json(
        { expires_at: new Date(Date.now() + 900_000).toISOString() },
        { status: 201 },
      ),
    ),
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
      <MemoryRouter initialEntries={["/#exceptions"]}>
        <OperatorSourceProposalDetailPage proposalId={proposal.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    await within(await screen.findByRole("tabpanel")).findByText(
      "https://khaneh.example/new-rentals",
    ),
  ).toBeVisible();
  expect(
    within(screen.getByRole("tabpanel")).getByText("در حال استخراج"),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "شروع بررسی" })).toBeNull();
  expect(screen.queryByRole("button", { name: "درخواست استخراج" })).toBeNull();
  await user.click(screen.getByRole("tab", { name: "نشانی و کشف" }));
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
  await user.type(screen.getByLabelText("سقف صفحات قابل بررسی"), "100");
  await user.type(screen.getByLabelText("تعداد آگهی اجاره هدف"), "70");
  await user.click(begin);
  expect(reviewBody).toEqual({
    reviewed_revision: 1,
    confirmed: true,
    max_pages: 100,
    target_detail_pages: 70,
  });
  expect(
    await screen.findByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).toBeDisabled();
});

test.each(["approval_required", "automatic"])(
  "reviews run samples and sends one revision-checked batch approval (%s)",
  async (mode) => {
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
          media: [],
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
          media: [],
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
              review_mode: mode,
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
        <MemoryRouter initialEntries={["/#exceptions"]}>
          <OperatorSourceProposalDetailPage proposalId={proposal.id} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("آپارتمان معتبر")).toBeVisible();
    expect(screen.getByText("متراژ: متراژ الزامی است")).toBeVisible();
    const button = screen.getByRole("button", {
      name: "انتشار همه نتایج معتبر",
    });
    expect(button).toBeDisabled();
    await user.click(
      screen.getByLabelText(
        "نتایج را بررسی و انتشار همه موارد آماده تأیید این نوبت را تأیید می‌کنم",
      ),
    );
    await user.click(button);
    expect(await screen.findByText("نتایج معتبر منتشر شد.")).toBeVisible();
    expect(bodies).toEqual([{ reviewed_revision: 4, confirmed: true }]);
  },
);

test("revokes an assignment with a reason and the reviewed revision", async () => {
  const user = userEvent.setup();
  let body: unknown;
  server.use(
    http.get("*/api/v1/users/me/", () =>
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
      <MemoryRouter initialEntries={["/#responsibility"]}>
        <OperatorSourceProposalDetailPage proposalId={proposal.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(await screen.findByText("لغو تخصیص و توقف همکاری"));
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

test.each([
  ["approval_required", false],
  ["automatic", false],
  ["approval_required", true],
  ["automatic", true],
] as const)(
  "approves sample limitations only with acknowledgement and a reason (%s, quality=%s)",
  async (mode, qualityPassed) => {
    const user = userEvent.setup();
    const version = {
      id: "limited-profile",
      reservation: "limited-discovery",
      number: 1,
      status: "proposed",
      rules: {},
      validation: {
        rules_valid: true,
        quality_passed: qualityPassed,
        limitations_present: true,
        approval_enabled: true,
        training_page_urls: ["https://khaneh.example/train"],
        held_out_page_urls: ["https://khaneh.example/held"],
        fields: {
          floor_area_sqm: { coverage: 0, conflicts: 1, passed: false },
        },
        pages: [
          {
            url: "https://khaneh.example/held",
            status: "needs_review",
            unresolved: ["floor_area_sqm"],
            conflicts: { floor_area_sqm: [85, 500] },
            evidence: {},
          },
        ],
      },
      samples: [
        {
          canonical_url: "https://khaneh.example/held",
          normalized: {},
          unresolved: ["floor_area_sqm"],
          conflicts: {},
          evidence: {},
          status: "needs_review",
        },
      ],
    };
    const caseData = {
      ...proposal,
      discovery_stage: "complete",
      discovery: { id: "limited-discovery", evidence: { page_count: 10 } },
      profile_versions: [version],
    };
    const approvals: unknown[] = [];
    server.use(
      http.get("*/api/v1/operator/source-proposals/", () =>
        HttpResponse.json([caseData]),
      ),
      http.post("*/api/v1/operator/source-proposals/:proposalId/claim/", () =>
        HttpResponse.json({}, { status: 201 }),
      ),
      http.post(
        "*/api/v1/operator/source-proposals/:proposalId/profile/approve/",
        async ({ request }) => {
          approvals.push(await request.json());
          return HttpResponse.json({
            ...caseData,
            state: "approved",
            profile_versions: [{ ...version, status: "approved" }],
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
        <MemoryRouter initialEntries={["/#profile"]}>
          <OperatorSourceProposalDetailPage proposalId={proposal.id} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText("قواعد از نظر فنی معتبر و قابل اجرا هستند."),
    ).toBeVisible();
    expect(
      screen.getByText(/اعتبارسنجی تضمین درستی واقعی اطلاعات نیست/),
    ).toBeVisible();
    expect(
      screen.getAllByText(/فیلدهای حل‌نشده: متراژ/).length,
    ).toBeGreaterThan(0);
    await user.click(
      screen.getByRole("button", { name: "پذیرش بررسی پروفایل" }),
    );
    await user.selectOptions(screen.getByLabelText("روش بررسی نتایج"), mode);
    await user.click(
      screen.getByLabelText("نمونه‌ها و اعتبارسنجی پروفایل را بررسی کردم."),
    );
    const approve = screen.getByRole("button", {
      name: "تأیید پروفایل و تخصیص منبع",
    });
    expect(approve).toBeDisabled();
    await user.click(screen.getByLabelText("محدودیت‌های کیفیت را می‌پذیرم."));
    expect(approve).toBeDisabled();
    await user.type(
      screen.getByLabelText("دلیل تأیید با وجود محدودیت‌ها"),
      "   ",
    );
    expect(approve).toBeDisabled();
    await user.clear(screen.getByLabelText("دلیل تأیید با وجود محدودیت‌ها"));
    await user.type(
      screen.getByLabelText("دلیل تأیید با وجود محدودیت‌ها"),
      "نتایج معتبر قابل استفاده هستند",
    );
    expect(approve).toBeEnabled();
    await user.click(approve);
    await waitFor(() =>
      expect(approvals).toEqual([
        {
          reviewed_revision: 1,
          reviewed_profile_version: "limited-profile",
          confirmed: true,
          review_mode: mode,
          limitations_acknowledged: true,
          reason: "نتایج معتبر قابل استفاده هستند",
        },
      ]),
    );
  },
);

test.each([
  [1, 0, "بدون اعتبارسنجی مستقل"],
  [2, 1, "شواهد محدود"],
  [5, 5, null],
] as const)(
  "shows actual sample evidence (%s training, %s validation)",
  async (training, heldOut, label) => {
    const user = userEvent.setup();
    const version = {
      id: "small-profile",
      reservation: "small-discovery",
      number: 1,
      status: "proposed",
      rules: {},
      samples: [],
      validation: {
        rules_valid: true,
        quality_passed: heldOut > 0,
        limitations_present: training + heldOut < 10,
        approval_enabled: true,
        training_page_urls: Array.from(
          { length: training },
          (_, i) => `https://khaneh.example/train/${i}`,
        ),
        held_out_page_urls: Array.from(
          { length: heldOut },
          (_, i) => `https://khaneh.example/held/${i}`,
        ),
        fields: {
          floor_area_sqm: {
            coverage: heldOut ? 1 : null,
            passed: heldOut ? true : null,
            conflicts: 0,
          },
        },
        pages: [],
      },
    };
    server.use(
      http.post("*/api/v1/operator/source-proposals/:proposalId/claim/", () =>
        HttpResponse.json({}, { status: 201 }),
      ),
      http.get("*/api/v1/operator/source-proposals/", () =>
        HttpResponse.json([
          {
            ...proposal,
            discovery_stage: "complete",
            discovery: {
              id: "small-discovery",
              evidence: { page_count: training + heldOut },
            },
            profile_versions: [version],
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
        <MemoryRouter initialEntries={["/#profile"]}>
          <OperatorSourceProposalDetailPage proposalId={proposal.id} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText(
        `آموزش: ${training.toLocaleString("fa-IR")} صفحه · اعتبارسنجی مستقل: ${heldOut.toLocaleString("fa-IR")} صفحه`,
      ),
    ).toBeVisible();
    if (label) expect(screen.getByText(label, { exact: true })).toBeVisible();
    else
      expect(
        screen.queryByText("شواهد محدود", { exact: true }),
      ).not.toBeInTheDocument();
    await user.click(screen.getByText("گزارش پوشش و تعارض فیلدها"));
    if (!heldOut) {
      expect(screen.getByText("ارزیابی نشده")).toBeVisible();
      expect(screen.queryByText(/^[۰-۹]+٪$/)).not.toBeInTheDocument();
      expect(
        screen.queryByText("اعتبارسنجی هشت فیلد اصلی موفق بود."),
      ).not.toBeInTheDocument();
    }
    await user.click(
      screen.getByRole("button", { name: "پذیرش بررسی پروفایل" }),
    );
    await user.click(
      screen.getByLabelText("نمونه‌ها و اعتبارسنجی پروفایل را بررسی کردم."),
    );
    const approve = screen.getByRole("button", {
      name: "تأیید پروفایل و تخصیص منبع",
    });
    if (label) {
      expect(approve).toBeDisabled();
      await user.click(screen.getByLabelText("محدودیت‌های کیفیت را می‌پذیرم."));
      expect(approve).toBeDisabled();
      await user.type(
        screen.getByLabelText("دلیل تأیید با وجود محدودیت‌ها"),
        "شواهد محدود بررسی شد.",
      );
    }
    for (const mode of ["automatic", "approval_required"]) {
      await user.selectOptions(screen.getByLabelText("روش بررسی نتایج"), mode);
      expect(approve).toBeEnabled();
    }
  },
);

test("compares imperfect repair evidence and requires a fresh explicit approval", async () => {
  const user = userEvent.setup();
  const validation = {
    rules_valid: true,
    quality_passed: false,
    approval_enabled: true,
    limitations_present: true,
    training_page_urls: [],
    held_out_page_urls: [],
    fields: {},
  };
  const parent = {
    id: "before-repair",
    reservation: "discovery-1",
    number: 1,
    provenance: "manual",
    status: "proposed",
    is_active: true,
    rules: {},
    validation,
    samples: [],
    exclusions: [],
  };
  const counts = {
    resolved: 0,
    conflicts: 1,
    coverage: 0,
    passed: false,
    missing_page_urls: [],
    conflict_page_urls: ["https://khaneh.example/listing/10001"],
  };
  const draft = {
    ...parent,
    id: "after-repair",
    parent: parent.id,
    number: 2,
    provenance: "llm",
    is_active: false,
    comparison: [
      {
        field: "monthly_rent_rial",
        before_rule: { selector: ".deposit" },
        after_rule: { selector: ".rent" },
        before_validation: counts,
        after_validation: {
          ...counts,
          resolved: 1,
          conflicts: 0,
          coverage: 1,
          passed: true,
        },
        samples: [
          {
            url: "https://khaneh.example/listing/10001",
            split: "held_out",
            change: "improved",
            before: {
              value: null,
              conflicts: [200000000, 5000000000],
              status: "conflict",
            },
            after: { value: 200000000, conflicts: [], status: "resolved" },
          },
        ],
      },
      {
        field: "floor_area_sqm",
        before_rule: {},
        after_rule: {},
        before_validation: {
          ...counts,
          resolved: 1,
          conflicts: 0,
          coverage: 1,
          passed: true,
        },
        after_validation: counts,
        samples: [
          {
            url: "https://khaneh.example/listing/10002",
            split: "training",
            change: "regressed",
            before: { value: 85, conflicts: [], status: "resolved" },
            after: { value: null, conflicts: [85, 500], status: "conflict" },
          },
        ],
      },
    ],
  };
  const caseData = {
    ...proposal,
    discovery_stage: "complete",
    discovery: { id: "discovery-1", evidence: { page_count: 10 } },
    profile_versions: [parent],
    profile_repairs: [],
  };
  let approvalBody: unknown;
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([caseData]),
    ),
    http.post("*/api/v1/operator/source-proposals/:proposalId/claim/", () =>
      HttpResponse.json({}, { status: 201 }),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/profile/repair/",
      () =>
        HttpResponse.json({
          ...caseData,
          profile_versions: [draft, parent],
        }),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/profile/approve/",
      async ({ request }) => {
        approvalBody = await request.json();
        return HttpResponse.json(
          { detail: "نسخه پروفایل تغییر کرده است؛ پرونده را تازه کنید." },
          { status: 409 },
        );
      },
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/#profile"]}>
        <OperatorSourceProposalDetailPage proposalId={proposal.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText("پروفایل منبع — نسخه ۱");
  await user.click(screen.getByRole("button", { name: "پذیرش بررسی پروفایل" }));
  await user.selectOptions(
    screen.getByLabelText("روش بررسی نتایج"),
    "automatic",
  );
  await user.click(
    screen.getByLabelText("نمونه‌ها و اعتبارسنجی پروفایل را بررسی کردم."),
  );
  await user.click(screen.getByRole("button", { name: "اصلاح هوشمند" }));
  await user.click(screen.getByLabelText("اصلاح هوشمند اجاره ماهانه"));
  await user.click(
    screen.getByRole("button", { name: "درخواست اصلاح هوشمند" }),
  );
  expect(
    await screen.findByRole("heading", { name: "مقایسه اصلاح با نسخه پیشین" }),
  ).toBeVisible();
  expect(screen.getByText("بهبود: ۱ صفحه · پسرفت: ۰ صفحه")).toBeVisible();
  expect(screen.getByText("بهبود: ۰ صفحه · پسرفت: ۱ صفحه")).toBeVisible();
  const rentComparison = within(
    screen.getByRole("article", { name: "مقایسه اجاره ماهانه" }),
  );
  await user.click(rentComparison.getByText("صفحات نمونه تحت تأثیر"));
  expect(
    screen.getByText("https://khaneh.example/listing/10001"),
  ).toBeVisible();
  expect(screen.getByText("۲۰٬۰۰۰٬۰۰۰ تومان")).toBeVisible();
  expect(rentComparison.getByText("اعتبارسنجی مستقل")).toBeVisible();
  const approve = screen.getByRole("button", {
    name: "تأیید پروفایل و تخصیص منبع",
  });
  expect(approve).toBeDisabled();
  expect(approvalBody).toBeUndefined();
  await user.selectOptions(
    screen.getByLabelText("روش بررسی نتایج"),
    "approval_required",
  );
  await user.click(
    screen.getByLabelText("نمونه‌ها و اعتبارسنجی پروفایل را بررسی کردم."),
  );
  await user.click(screen.getByLabelText("محدودیت‌های کیفیت را می‌پذیرم."));
  await user.type(
    screen.getByLabelText("دلیل تأیید با وجود محدودیت‌ها"),
    "شواهد بررسی شد.",
  );
  await user.click(approve);
  expect(
    await screen.findByText(
      "نسخه پروفایل تغییر کرده است؛ پرونده را تازه کنید.",
    ),
  ).toBeVisible();
  expect(approvalBody).toMatchObject({
    reviewed_profile_version: "after-repair",
    review_mode: "approval_required",
    limitations_acknowledged: true,
  });
});

test("requires explicit legacy conflict resolution before URL approval", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([{ ...proposal, current_website_conflict: true }]),
    ),
    http.post("*/api/v1/operator/source-proposals/:id/claim/", () =>
      HttpResponse.json({ id: "claim", revision: 1 }, { status: 201 }),
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/#overview"]}>
        <OperatorSourceProposalDetailPage proposalId={proposal.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText("تعارض وب‌سایت‌های جاری ارسال‌کننده"),
  ).toBeVisible();
  await user.click(screen.getByRole("tab", { name: "نشانی و کشف" }));
  await user.click(screen.getByRole("button", { name: "شروع بررسی" }));
  expect(
    await screen.findByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "رد پیشنهاد" })).toBeDisabled();
});

test.each(["changes_requested", "rejected"])(
  "keeps revocation available for an active assignment in %s",
  async (state) => {
    server.use(
      http.get("*/api/v1/operator/source-proposals/", () =>
        HttpResponse.json([
          {
            ...proposal,
            state,
            is_current: true,
            current_website_conflict: false,
            assignment: {
              id: 1,
              state: "active",
              source: { display_name: "خانه‌یاب", domain: "khaneh.example" },
              active_profile_version: null,
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
        <MemoryRouter initialEntries={["/#responsibility"]}>
          <OperatorSourceProposalDetailPage proposalId={proposal.id} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByText("لغو تخصیص و توقف همکاری"));
    expect(
      await screen.findByRole("button", { name: "لغو تخصیص منبع" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "شروع بررسی" }),
    ).not.toBeInTheDocument();
  },
);

test("queue manager reassigns Source responsibility with a reason and reviewed revision", async () => {
  const user = userEvent.setup();
  let body: unknown;
  const caseData = {
    ...proposal,
    state: "approved",
    responsibility: {
      operator: "original",
      operator_label: "original@example.com",
      revision: 1,
      history: [
        {
          operator: "original",
          actor: "original",
          revision: 1,
          reason: "مسئول اولیه",
          created_at: "2026-09-01T08:00:00Z",
        },
      ],
    },
    assignment: {
      id: 8,
      state: "active",
      review_operator: "original",
      source: { domain: "khaneh.example", display_name: "خانه‌یاب" },
      active_profile_version: { id: "version", number: 1 },
      review_mode: "approval_required",
      recent_requests: [],
    },
  };
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "manager",
        email: "manager@example.com",
        operator_capabilities: ["manage_operator_queues"],
      }),
    ),
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([caseData]),
    ),
    http.get("*/api/v1/operator/external-listing-candidates/", () =>
      HttpResponse.json([]),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/responsibility/",
      async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          ...caseData,
          responsibility: {
            ...caseData.responsibility,
            operator: "next",
            operator_label: "next@example.com",
            revision: 2,
          },
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
      <MemoryRouter initialEntries={["/#responsibility"]}>
        <OperatorSourceProposalDetailPage proposalId={proposal.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    await within(await screen.findByRole("tabpanel")).findByText(
      "original@example.com",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "لغو تخصیص منبع" }),
  ).not.toBeInTheDocument();
  const submit = screen.getByRole("button", { name: "واگذاری مسئولیت منبع" });
  expect(submit).toBeDisabled();
  await user.type(
    screen.getByLabelText("ایمیل اپراتور مقصد"),
    "next@example.com",
  );
  await user.type(screen.getByLabelText("دلیل تغییر مسئول"), "تغییر شیفت");
  await user.click(submit);
  expect(body).toEqual({
    assignee_email: "next@example.com",
    reviewed_responsibility_revision: 1,
    reason: "تغییر شیفت",
  });
  expect(
    await within(await screen.findByRole("tabpanel")).findByText(
      "next@example.com",
    ),
  ).toBeVisible();
});

test.each([
  ["original", ["review_source_proposals"], false],
  ["next", ["manage_operator_queues"], false],
  ["next", ["review_source_proposals"], true],
])(
  "Source decisions require responsibility and capability (%s, %j)",
  async (id, capabilities, allowed) => {
    server.use(
      http.get("*/api/v1/users/me/", () =>
        HttpResponse.json({ id, operator_capabilities: capabilities }),
      ),
      http.get("*/api/v1/operator/source-proposals/", () =>
        HttpResponse.json([
          {
            ...proposal,
            state: "approved",
            discovery_stage: "complete",
            responsibility: {
              operator: "next",
              operator_label: "next@example.com",
              revision: 2,
              history: [],
            },
            assignment: {
              id: 1,
              state: "active",
              review_operator: "next",
              source: { domain: "khaneh.example", display_name: "خانه‌یاب" },
              active_profile_version: { id: "version", number: 1 },
              review_mode: "approval_required",
              mode_revision: 0,
              recent_requests: [],
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
        <MemoryRouter initialEntries={["/#responsibility"]}>
          <OperatorSourceProposalDetailPage proposalId={proposal.id} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await within(await screen.findByRole("tabpanel")).findByText(
        "next@example.com",
      ),
    ).toBeVisible();
    if (allowed)
      await userEvent.click(screen.getByText("لغو تخصیص و توقف همکاری"));
    expect(
      Boolean(screen.queryByRole("button", { name: "لغو تخصیص منبع" })),
    ).toBe(allowed);
    await userEvent.click(screen.getByRole("tab", { name: "پردازش و انتشار" }));
    expect(
      Boolean(screen.queryByRole("button", { name: "ثبت روش انتشار" })),
    ).toBe(allowed);
    await userEvent.click(screen.getByRole("tab", { name: "نشانی و کشف" }));
    if (allowed) {
      await userEvent.type(
        screen.getByLabelText("سقف صفحات قابل بررسی"),
        "250",
      );
      await userEvent.type(
        screen.getByLabelText("تعداد آگهی اجاره هدف"),
        "200",
      );
      await userEvent.click(
        screen.getByLabelText(/دریافت دوباره صفحات و بررسی نسخه تازه/),
      );
      expect(
        screen.getByRole("button", { name: "آغاز بررسی نسخه تازه پروفایل" }),
      ).toBeEnabled();
    }
    if (!allowed)
      expect(
        screen.getByRole("button", { name: "آغاز بررسی نسخه تازه پروفایل" }),
      ).toBeDisabled();
  },
);

test("stale reassignment reports the conflict and refreshes current responsibility", async () => {
  const user = userEvent.setup();
  let revision = 1;
  const makeCase = () => ({
    ...proposal,
    state: "approved",
    responsibility: {
      operator: revision === 1 ? "original" : "next",
      operator_label:
        revision === 1 ? "original@example.com" : "next@example.com",
      revision,
      history: [],
    },
    assignment: {
      id: 1,
      state: "active",
      review_operator: "next",
      source: { domain: "khaneh.example", display_name: "خانه‌یاب" },
      recent_requests: [],
    },
  });
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "manager",
        operator_capabilities: ["manage_operator_queues"],
      }),
    ),
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([makeCase()]),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/responsibility/",
      () => {
        revision = 2;
        return HttpResponse.json(
          {
            code: "responsibility_conflict",
            detail: "مسئول منبع تغییر کرده است",
          },
          { status: 409 },
        );
      },
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/#responsibility"]}>
        <OperatorSourceProposalDetailPage proposalId={proposal.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    await within(await screen.findByRole("tabpanel")).findByText(
      "original@example.com",
    ),
  ).toBeVisible();
  await user.type(
    screen.getByLabelText("ایمیل اپراتور مقصد"),
    "chosen@example.com",
  );
  await user.type(screen.getByLabelText("دلیل تغییر مسئول"), "تغییر شیفت");
  await user.click(
    screen.getByRole("button", { name: "واگذاری مسئولیت منبع" }),
  );
  expect(
    await within(
      screen.getByRole("region", { name: "مسئولیت منبع" }),
    ).findByRole("alert"),
  ).toHaveTextContent("مسئول منبع تغییر کرده است");
  expect(
    await within(await screen.findByRole("tabpanel")).findByText(
      "next@example.com",
    ),
  ).toBeVisible();
});

test("responsible operator switches publication mode using the reviewed profile and revision", async () => {
  const user = userEvent.setup();
  const bodies: unknown[] = [];
  let caseData = {
    ...proposal,
    state: "approved",
    assignment: {
      id: 8,
      state: "active",
      review_operator: "operator",
      source: { domain: "khaneh.example", display_name: "خانه‌یاب" },
      active_profile_version: { id: "version", number: 1 },
      review_mode: "approval_required",
      mode_revision: 0,
      recent_requests: [],
    },
  };
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "operator",
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([caseData]),
    ),
    http.get("*/api/v1/operator/external-listing-candidates/", () =>
      HttpResponse.json([]),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/publication-mode/",
      async ({ request }) => {
        const body = (await request.json()) as { review_mode: string };
        bodies.push(body);
        caseData = {
          ...caseData,
          assignment: {
            ...caseData.assignment,
            review_mode: body.review_mode,
            mode_revision: caseData.assignment.mode_revision + 1,
          },
        };
        return HttpResponse.json(caseData);
      },
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/#processing"]}>
        <OperatorSourceProposalDetailPage proposalId={proposal.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const automatic = await screen.findByRole("radio", {
    name: "انتشار خودکار نتایج معتبر",
  });
  expect(screen.getByRole("button", { name: "ثبت روش انتشار" })).toBeDisabled();
  await user.click(automatic);
  await user.click(screen.getByRole("button", { name: "ثبت روش انتشار" }));
  await waitFor(() =>
    expect(bodies).toEqual([
      {
        reviewed_profile_version: "version",
        reviewed_mode_revision: 0,
        review_mode: "automatic",
      },
    ]),
  );
  expect(await screen.findByText("خودکار")).toBeVisible();
  await user.click(screen.getByRole("radio", { name: "نیازمند تأیید انتشار" }));
  await user.click(screen.getByRole("button", { name: "ثبت روش انتشار" }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toEqual({
    reviewed_profile_version: "version",
    reviewed_mode_revision: 1,
    review_mode: "approval_required",
  });
});

test("pauses a Source separately and resumes with explicit fresh publication mode", async () => {
  const user = userEvent.setup();
  const bodies: unknown[] = [];
  let caseData = {
    ...proposal,
    state: "approved",
    assignment: {
      id: 8,
      state: "active",
      review_operator: "operator",
      source: {
        domain: "khaneh.example",
        display_name: "خانه‌یاب",
        processing_paused: false,
        processing_revision: 0,
      },
      active_profile_version: { id: "version", number: 1 },
      review_mode: "automatic",
      mode_revision: 0,
      recent_requests: [],
    },
  };
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "operator",
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([caseData]),
    ),
    http.get("*/api/v1/operator/external-listing-candidates/", () =>
      HttpResponse.json([]),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/processing/",
      async ({ request }) => {
        const body = (await request.json()) as {
          action: string;
          review_mode?: string;
        };
        bodies.push(body);
        caseData = {
          ...caseData,
          assignment: {
            ...caseData.assignment,
            review_mode: body.review_mode ?? caseData.assignment.review_mode,
            source: {
              ...caseData.assignment.source,
              processing_paused: body.action === "pause",
              processing_revision:
                caseData.assignment.source.processing_revision + 1,
            },
          },
        };
        return HttpResponse.json(caseData);
      },
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/#processing"]}>
        <OperatorSourceProposalDetailPage proposalId={proposal.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(
    await screen.findByRole("button", { name: "توقف پردازش منبع" }),
  );
  expect(
    await within(await screen.findByRole("tabpanel")).findByText("متوقف"),
  ).toBeVisible();

  const resume = screen.getByRole("button", {
    name: "ازسرگیری با استخراج تازه",
  });
  expect(resume).toBeDisabled();
  await user.click(
    screen.getByRole("radio", { name: "بررسی اپراتور پیش از انتشار تازه" }),
  );
  await user.click(resume);
  await waitFor(() =>
    expect(bodies).toEqual([
      { action: "pause", reviewed_processing_revision: 0 },
      {
        action: "resume",
        reviewed_processing_revision: 1,
        review_mode: "approval_required",
      },
    ]),
  );
  expect(
    await screen.findByRole("button", { name: "توقف پردازش منبع" }),
  ).toBeVisible();
});

test("shows an expired review reservation and lets the operator claim it again", async () => {
  const user = userEvent.setup();
  let claims = 0;
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([proposal]),
    ),
    http.post("*/api/v1/operator/source-proposals/:id/claim/", () => {
      claims += 1;
      return HttpResponse.json(
        {
          expires_at: new Date(
            Date.now() + (claims === 1 ? -1000 : 900_000),
          ).toISOString(),
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
      <MemoryRouter initialEntries={["/#url"]}>
        <OperatorSourceProposalDetailPage proposalId={proposal.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole("button", { name: "شروع بررسی" }));
  expect(await screen.findByText("مهلت بررسی شما تمام شد.")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "پذیرش دوباره بررسی" }));
  expect(
    await screen.findByText("بررسی این پرونده را پذیرفته‌اید."),
  ).toBeVisible();
  expect(screen.getByText(/مهلت بررسی:/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).toBeDisabled();
  await user.type(screen.getByLabelText("سقف صفحات قابل بررسی"), "250");
  await user.type(screen.getByLabelText("تعداد آگهی اجاره هدف"), "200");
  expect(
    screen.getByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).toHaveAccessibleDescription(/علامت بزنید/);
  await user.click(screen.getByLabelText(/نشانی و اختیار نماینده/));
  expect(
    screen.getByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).toBeEnabled();
  await user.click(screen.getByRole("tab", { name: "پروفایل" }));
  expect(
    screen.getByRole("button", { name: "تمدید مهلت بررسی" }),
  ).toBeVisible();
});

function renderCrawlControls(exceptions: unknown[] = []) {
  const bodies: unknown[] = [];
  let caseData = {
    ...proposal,
    state: "approved",
    assignment: {
      id: 8,
      state: "active",
      review_operator: "operator",
      source: {
        domain: "khaneh.example",
        display_name: "خانه‌یاب",
        processing_paused: false,
        processing_revision: 0,
        crawl_interval_hours: 0,
        crawl_schedule_revision: 0,
        next_crawl_at: null as string | null,
        crawl_schedule_error: "",
      },
      active_profile_version: { id: "version", number: 1 },
      review_mode: "approval_required",
      mode_revision: 0,
      recent_requests: [],
      exceptions,
    },
  };
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "operator",
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([caseData]),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/crawl/",
      async ({ request }) => {
        const body = (await request.json()) as {
          action: string;
          interval_hours?: number;
        };
        bodies.push(body);
        if (body.action === "schedule")
          caseData = {
            ...caseData,
            assignment: {
              ...caseData.assignment,
              source: {
                ...caseData.assignment.source,
                crawl_interval_hours: body.interval_hours!,
                crawl_schedule_revision: 1,
                next_crawl_at: "2026-09-13T12:00:00Z",
              },
            },
          };
        return HttpResponse.json(caseData);
      },
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/#processing"]}>
        <OperatorSourceProposalDetailPage proposalId={proposal.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return bodies;
}

test("starts a crawl from another page", async () => {
  const user = userEvent.setup();
  const bodies = renderCrawlControls();
  expect(await screen.findByText("فقط اجرای دستی")).toBeVisible();
  const url = screen.getByRole("textbox", { name: "نشانی شروع دریافت" });
  await user.clear(url);
  await user.type(url, "https://khaneh.example/more");
  await user.click(
    screen.getByRole("button", { name: "دریافت و به‌روزرسانی اکنون" }),
  );
  await waitFor(() =>
    expect(bodies[0]).toEqual({
      action: "run",
      url: "https://khaneh.example/more",
    }),
  );
});

test("saves a revision-checked schedule", async () => {
  const user = userEvent.setup();
  const bodies = renderCrawlControls();
  expect(await screen.findByText("فقط اجرای دستی")).toBeVisible();
  await user.selectOptions(screen.getByLabelText("فاصله دریافت اطلاعات"), "6");
  await user.click(screen.getByRole("button", { name: "ذخیره برنامه دریافت" }));
  await waitFor(() =>
    expect(bodies[0]).toEqual({
      action: "schedule",
      interval_hours: 6,
      reviewed_schedule_revision: 0,
    }),
  );
  expect(await screen.findByText("برنامه دریافت ذخیره شد.")).toBeVisible();
  expect(screen.getByText(/دریافت از نشانی اصلی هر ۶ ساعت/)).toBeVisible();
});

test("opens page exclusions from processing controls", async () => {
  const user = userEvent.setup();
  renderCrawlControls();
  expect(await screen.findByText("فقط اجرای دستی")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "مدیریت صفحات مسدود" }));
  expect(
    screen.getByRole("heading", { name: "مدیریت محدودیت‌ها" }),
  ).toBeVisible();
});

test("reopening a page exclusion resets an edited URL and its confirmed preview", async () => {
  const user = userEvent.setup();
  renderCrawlControls([
    {
      id: "exception",
      canonical_url: "https://khaneh.example/listing/a",
      state: "open",
      problem: "candidate_checks",
      detail: "اطلاعات نیازمند بررسی است",
      first_occurrence: "2026-09-06T10:00:00Z",
      last_attempt_at: "2026-09-06T11:00:00Z",
      history: [],
    },
  ]);
  server.use(
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/exclusions/preview/",
      async ({ request }) => {
        const rule = (await request.json()) as { kind: string; url: string };
        return HttpResponse.json({
          ...rule,
          known_page_count: 0,
          known_pages: [],
          published_listing_count: 0,
          published_listings: [],
        });
      },
    ),
  );
  await screen.findByText("فقط اجرای دستی");
  await user.click(screen.getByRole("tab", { name: "ملک‌ها و نتایج" }));
  await user.click(screen.getByRole("button", { name: /مشکلات صفحات/ }));
  await user.click(screen.getByRole("button", { name: "مسدود کردن صفحه" }));
  const input = screen.getByLabelText("نشانی محدودیت");
  expect(input).toHaveValue("https://khaneh.example/listing/a");
  await user.clear(input);
  await user.type(input, "https://khaneh.example/listing/b");
  await user.click(screen.getByRole("button", { name: "پیش‌نمایش محدودیت" }));
  await user.type(
    await screen.findByLabelText("دلیل تصمیم"),
    "صفحه مرتبط نیست",
  );
  await user.click(screen.getByRole("checkbox", { name: /اعمال محدودیت/ }));
  expect(screen.getByRole("button", { name: "ثبت محدودیت" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: /مشکلات صفحات/ }));
  await user.click(screen.getByRole("button", { name: "مسدود کردن صفحه" }));
  expect(screen.getByLabelText("نشانی محدودیت")).toHaveValue(
    "https://khaneh.example/listing/a",
  );
  expect(
    screen.queryByRole("button", { name: "ثبت محدودیت" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("checkbox", { name: /اعمال محدودیت/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("https://khaneh.example/listing/b"),
  ).not.toBeInTheDocument();
});

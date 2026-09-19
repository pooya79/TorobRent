import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { beforeEach, expect, test } from "vitest";

import { OperatorSourceProposalDetailPage } from "@/pages/OperatorSourceProposalDetailPage";
import { server } from "./server";

import type { OperatorSourceProposal } from "@/features/source-proposals/queries";
let currentCase: OperatorSourceProposal | undefined;
function caseJson(
  body: Parameters<typeof HttpResponse.json>[0],
  init?: ResponseInit,
) {
  const value: unknown = Array.isArray(body) ? (body as unknown[])[0] : body;
  if (value && typeof value === "object" && "website_url" in value)
    currentCase = value as unknown as OperatorSourceProposal;
  return HttpResponse.json(body, init);
}

beforeEach(() => {
  currentCase = undefined;
  server.use(
    http.get(
      "*/api/v1/operator/source-proposals/:id/:resource/",
      ({ params, request }) => {
        const q = new URL(request.url);
        const records =
          params.resource === "runs"
            ? currentCase?.assignment?.recent_requests
            : params.resource === "repairs"
              ? currentCase?.profile_repairs
              : params.resource === "profiles"
                ? currentCase?.profile_versions
                : params.resource === "history"
                  ? currentCase?.history
                  : params.resource === "responsibility-history"
                    ? currentCase?.responsibility?.history
                    : params.resource === "problems"
                      ? (currentCase?.assignment?.current_results ??
                        currentCase?.assignment?.exceptions)
                      : params.resource === "exclusions"
                        ? currentCase?.assignment?.exclusions
                        : params.resource === "results"
                          ? q.searchParams.get("run")
                            ? currentCase?.assignment?.recent_requests?.find(
                                (r) => r.run?.id === q.searchParams.get("run"),
                              )?.run?.candidates
                            : currentCase?.properties
                          : [];
        const rows = records ?? [];
        const page = Number(q.searchParams.get("page") ?? 1);
        return HttpResponse.json({
          count: rows.length,
          results: rows.slice((page - 1) * 20, page * 20),
        });
      },
    ),
    http.get(
      "*/api/v1/operator/external-listing-candidates/:id/",
      ({ params }) =>
        HttpResponse.json(
          currentCase?.properties?.find((c) => c.id === params.id) ??
            currentCase?.assignment?.recent_requests
              ?.flatMap((r) => r.run?.candidates ?? [])
              .find((c) => c.id === params.id),
        ),
    ),
    http.get("*/api/v1/users/me/", () =>
      caseJson({
        id: "operator",
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
  );
});

async function openProfileDecision(user: ReturnType<typeof userEvent.setup>) {
  const button = screen.getByRole("button", { name: "بررسی و فعال‌سازی" });
  if (button.getAttribute("aria-expanded") !== "true") await user.click(button);
}

const proposal = {
  responsibility: {
    operator: "operator",
    operator_label: "operator@example.com",
    revision: 1,
    history: [],
  },
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

test("inspects an owned case and requests changes to a Source Proposal", async () => {
  const user = userEvent.setup();
  let claimed = false;
  let requestedReason = "";
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () => caseJson([proposal])),
    http.post("*/api/v1/operator/source-proposals/:proposalId/claim/", () => {
      claimed = true;
      return caseJson(
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
        return caseJson({
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

  expect(claimed).toBe(false);
  await screen.findByText("شما مسئول این پرونده هستید");
  await user.type(
    screen.getByLabelText("دلیل تصمیم"),
    "مدرک اختیار را تکمیل کنید.",
  );
  await user.click(screen.getByRole("button", { name: "درخواست اصلاح" }));

  expect(requestedReason).toBe("مدرک اختیار را تکمیل کنید.");
  expect(await screen.findByText("تصمیم ثبت شد.")).toBeVisible();
  expect(screen.getByRole("heading", { name: "خانه‌یاب" })).toBeVisible();
});

test("URL approval keeps the case visible with Discovery evidence and ongoing responsibility", async () => {
  const user = userEvent.setup();
  let claimCount = 0;
  const completed = {
    ...proposal,
    discovery_stage: "complete",
    discovery: {
      max_pages: 250,
      target_detail_pages: 200,
      pages: [
        {
          url: "https://khaneh.example/unsupported",
          classification: "rental_listing",
          description: "",
          is_current: true,
          last_fetched_at: null,
          http_status: null,
        },
        {
          url: "https://khaneh.example/rent/1",
          classification: "rental_listing",
          description: "مبلغ اجاره شناسایی شد",
          is_current: true,
          last_fetched_at: null,
          http_status: 200,
        },
        {
          url: "https://khaneh.example/unavailable",
          classification: "fetch_error",
          description: "زمان دریافت به پایان رسید",
          is_current: true,
          last_fetched_at: null,
          http_status: null,
        },
      ],
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
    http.get("*/api/v1/operator/source-proposals/", () => caseJson([proposal])),
    http.post("*/api/v1/operator/source-proposals/:proposalId/claim/", () => {
      claimCount += 1;
      return caseJson(
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
        return caseJson(completed);
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
  await user.click(await screen.findByLabelText(/نشانی و اختیار نماینده/));
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
  expect(screen.getByText("صفحات بررسی‌شده").parentElement).toHaveTextContent(
    "۸",
  );
  expect(screen.getByText("پیوند تازه‌ای برای ادامه پیدا نشد.")).toBeVisible();
  expect(screen.getByText(/حدود بررسی: ۲۵۰ صفحه · هدف: ۲۰۰/)).toBeVisible();
  expect(screen.getByText("ساختار غالب").parentElement).toHaveTextContent(
    "۷۵٪",
  );
  const report = screen.getByRole("region", { name: "نتیجه کشف صفحات" });
  expect(within(report).queryByText(/https:\/\//)).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("table")).getByText("خارج از پوشش"),
  ).toBeVisible();
  expect(
    within(screen.getByRole("table")).getByText("نمونه نماینده"),
  ).toBeVisible();
  expect(screen.getByText("https://khaneh.example/unsupported")).toBeVisible();
  expect(screen.getByText("مبلغ اجاره شناسایی شد")).toBeVisible();
  expect(screen.getByText("زمان دریافت به پایان رسید")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).toBeDisabled();
  expect(claimCount).toBe(0);
  server.use(
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/claim/release/",
      () => caseJson({ ...completed, discovery_stage: "released" }),
    ),
  );
  await user.type(screen.getByLabelText("دلیل تصمیم"), "بررسی متوقف شد");
  await user.click(
    screen.getByRole("button", { name: "توقف کشف و آزادسازی رزرو دامنه" }),
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
        canonical_url: "https://khaneh.example/second",
        normalized: { title: "آپارتمان دوم", city: "کرج" },
        conflicts: {},
        unresolved: [],
        evidence: {},
      },
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
    http.get("*/api/v1/operator/source-proposals/", () => caseJson([caseData])),
    http.post("*/api/v1/operator/source-proposals/:proposalId/claim/", () =>
      caseJson({}, { status: 201 }),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/profile/edit/",
      async ({ request }) => {
        const body = (await request.json()) as { rules: unknown };
        edits.push(body);
        return caseJson({
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
          review_mode: "approval_required",
          limitations_acknowledged: false,
          reason: "",
        });
        approved = true;
        return caseJson({ ...caseData, state: "approved" });
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
  expect(screen.getByRole("tab", { name: "استخراج اطلاعات" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByText("کرج")).toBeVisible();
  expect(screen.queryByText("۸۵ متر")).not.toBeInTheDocument();
  await user.selectOptions(
    screen.getByLabelText("صفحه نمونه"),
    "https://khaneh.example/held",
  );
  expect(screen.queryByText("کرج")).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "مشاهده صفحه اصلی" }),
  ).toHaveAttribute("href", "https://khaneh.example/held");
  const area = within(screen.getByRole("row", { name: "متراژ" }));
  expect(area.getByText("نیازمند توجه")).toBeVisible();
  expect(area.getByText("۸۵ متر")).toBeVisible();
  expect(screen.getByText("۵۰۰٬۰۰۰٬۰۰۰ تومان")).toBeVisible();
  expect(screen.getByText("https://khaneh.example/unsupported")).toBeVisible();
  await openProfileDecision(user);
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
  await openProfileDecision(user);
  await user.click(
    screen.getByLabelText("نمونه‌ها و اعتبارسنجی پروفایل را بررسی کردم."),
  );
  await openProfileDecision(user);
  expect(
    screen.getByRole("button", { name: "تأیید پروفایل و تخصیص منبع" }),
  ).toBeEnabled();
  expect(screen.queryByLabelText("روش بررسی نتایج")).not.toBeInTheDocument();
  await openProfileDecision(user);
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
    samples: [
      {
        canonical_url: "https://khaneh.example/held",
        normalized: {},
        unresolved: ["floor_area_sqm"],
        conflicts: {},
        evidence: {},
      },
    ],
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
    http.get("*/api/v1/operator/source-proposals/", () => caseJson([caseData])),
    http.post("*/api/v1/operator/source-proposals/:proposalId/claim/", () =>
      caseJson({}, { status: 201 }),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/profile/repair/",
      async ({ request }) => {
        calls.push(await request.json());
        return caseJson({
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
              started_at: "2026-09-17T08:00:00Z",
              finished_at: "2026-09-17T08:00:30Z",
              duration_ms: 30000,
              evidence_sha256: "internal-evidence-hash",
              structured_result: { internal: "private-provider-result" },
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
    screen.queryByRole("button", { name: "پذیرش بررسی پروفایل" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "اصلاح هوشمند" }));
  const repair = screen.getByRole("button", { name: "درخواست اصلاح هوشمند" });
  expect(repair).toBeDisabled();
  expect(calls).toEqual([]);
  expect(
    screen.queryByRole("button", { name: "نمایش همه فیلدها" }),
  ).not.toBeInTheDocument();
  const balcony = within(screen.getByRole("row", { name: "بالکن" }));
  expect(balcony.getByText("استخراج نشده")).toBeVisible();
  await user.click(balcony.getByLabelText("انتخاب بالکن برای اصلاح"));
  await user.click(balcony.getByLabelText("انتخاب بالکن برای اصلاح"));
  await user.click(screen.getByLabelText("انتخاب متراژ برای اصلاح"));
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
  expect(screen.getByLabelText("انتخاب متراژ برای اصلاح")).toBeChecked();
  expect(
    screen.getByRole("button", { name: "درخواست اصلاح هوشمند" }),
  ).toBeEnabled();
  await user.click(screen.getByText("تاریخچه اصلاح هوشمند"));
  const history = await screen.findByRole("region", {
    name: "تاریخچه اصلاح هوشمند",
  });
  await within(history).findByText("پایان مهلت پاسخ");
  expect(within(history).getByText("پایان مهلت پاسخ")).toBeVisible();
  expect(within(history).getByText("متراژ")).toBeVisible();
  await user.click(within(history).getByText("جزئیات درخواست"));
  expect(within(history).getByText("test-model")).toBeVisible();
  expect(within(history).getByText("۳۰ ثانیه")).toBeVisible();
  expect(history).not.toHaveTextContent("internal-evidence-hash");
  expect(history).not.toHaveTextContent("private-provider-result");
  expect(history.querySelector("pre")).toBeNull();
  expect(screen.getByText("پروفایل منبع — نسخه ۱")).toBeVisible();
});

test("keeps approved Source cases available for run monitoring", async () => {
  const user = userEvent.setup();
  let reviewBody: unknown;
  server.use(
    http.post("*/api/v1/operator/source-proposals/:proposalId/claim/", () =>
      caseJson(
        { expires_at: new Date(Date.now() + 900_000).toISOString() },
        { status: 201 },
      ),
    ),
    http.get("*/api/v1/users/me/", () =>
      caseJson({
        id: "operator",
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/profile/review/",
      async ({ request }) => {
        reviewBody = await request.json();
        return caseJson({
          ...proposal,
          revision: 2,
          discovery_stage: "queued",
        });
      },
    ),
    http.get("*/api/v1/operator/source-proposals/", () =>
      caseJson([
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
      caseJson([]),
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
  await user.click(
    await screen.findByRole("button", { name: /تاریخچه استخراج/ }),
  );
  expect(
    await within(await screen.findByRole("tabpanel")).findByText(
      "https://khaneh.example/new-rentals",
    ),
  ).toBeVisible();
  expect(
    within(screen.getByRole("tabpanel")).getByRole("heading", {
      name: "در حال استخراج",
    }),
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
        caseJson({
          id: "operator",
          operator_capabilities: ["review_source_proposals"],
        }),
      ),
      http.get("*/api/v1/operator/external-listing-candidates/", () =>
        caseJson([]),
      ),
      http.get("*/api/v1/operator/source-proposals/", () =>
        caseJson([
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
          return caseJson({ ...run, published: 1, revision: 5 });
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
    await user.click(
      await screen.findByRole("button", { name: /تاریخچه استخراج/ }),
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
      caseJson({
        id: "operator",
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
    http.get("*/api/v1/operator/source-proposals/", () =>
      caseJson([
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
      caseJson([]),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/assignment/revoke/",
      async ({ request }) => {
        body = await request.json();
        return caseJson({
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
      assignment: {
        review_mode: mode,
        state: "active",
        source: { processing_paused: false },
        recent_requests: [],
        exceptions: [],
        exclusions: [],
      },
      profile_versions: [version],
    };
    const approvals: unknown[] = [];
    server.use(
      http.get("*/api/v1/operator/source-proposals/", () =>
        caseJson([caseData]),
      ),
      http.post("*/api/v1/operator/source-proposals/:proposalId/claim/", () =>
        caseJson({}, { status: 201 }),
      ),
      http.post(
        "*/api/v1/operator/source-proposals/:proposalId/profile/approve/",
        async ({ request }) => {
          approvals.push(await request.json());
          return caseJson({
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
    await openProfileDecision(user);
    await user.click(
      screen.getByLabelText("نمونه‌ها و اعتبارسنجی پروفایل را بررسی کردم."),
    );
    await openProfileDecision(user);
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
        caseJson({}, { status: 201 }),
      ),
      http.get("*/api/v1/operator/source-proposals/", () =>
        caseJson([
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
    const trainingLabel = await screen.findByText("صفحات ساخت قواعد");
    expect(trainingLabel.parentElement).toHaveTextContent(
      `${training.toLocaleString("fa-IR")} صفحه`,
    );
    const validationLabel = screen.getByText("اعتبارسنجی مستقل", {
      selector: "dt",
    });
    expect(validationLabel.parentElement).toHaveTextContent(
      `${heldOut.toLocaleString("fa-IR")} صفحه`,
    );
    if (label) expect(screen.getByText(label, { exact: true })).toBeVisible();
    else
      expect(
        screen.queryByText("شواهد محدود", { exact: true }),
      ).not.toBeInTheDocument();
    await user.click(screen.getByText("گزارش فنی و قواعد استخراج"));
    await user.click(screen.getByText("گزارش پوشش و تعارض فیلدها"));
    await openProfileDecision(user);
    if (!heldOut) {
      expect(screen.getByText("ارزیابی نشده")).toBeVisible();
      expect(screen.queryByText(/^[۰-۹]+٪$/)).not.toBeInTheDocument();
      expect(
        screen.queryByText("اعتبارسنجی هشت فیلد اصلی موفق بود."),
      ).not.toBeInTheDocument();
    }
    await user.click(
      screen.getByLabelText("نمونه‌ها و اعتبارسنجی پروفایل را بررسی کردم."),
    );
    await openProfileDecision(user);
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
    expect(approve).toBeEnabled();
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
    samples: [
      {
        canonical_url: "https://khaneh.example/listing/10001",
        normalized: { monthly_rent_rial: 200000000 },
        conflicts: {},
        unresolved: ["city"],
        evidence: {},
      },
    ],
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
    http.get("*/api/v1/operator/source-proposals/", () => caseJson([caseData])),
    http.post("*/api/v1/operator/source-proposals/:proposalId/claim/", () =>
      caseJson({}, { status: 201 }),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/profile/repair/",
      () =>
        caseJson({
          ...caseData,
          profile_versions: [draft, parent],
        }),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/profile/approve/",
      async ({ request }) => {
        approvalBody = await request.json();
        return caseJson(
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
  await openProfileDecision(user);
  await openProfileDecision(user);
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

  expect(
    screen.getByText("https://khaneh.example/listing/10001"),
  ).toBeVisible();
  expect(rentComparison.getByText("۲۰٬۰۰۰٬۰۰۰ تومان")).toBeVisible();
  expect(screen.getByText("مشکلات بدون تغییر: شهر")).toBeVisible();
  expect(rentComparison.getByText("اعتبارسنجی مستقل")).toBeVisible();
  await openProfileDecision(user);
  const approve = screen.getByRole("button", {
    name: "تأیید پروفایل و تخصیص منبع",
  });
  expect(approve).toBeDisabled();
  expect(approvalBody).toBeUndefined();
  await openProfileDecision(user);
  await openProfileDecision(user);
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
      caseJson([{ ...proposal, current_website_conflict: true }]),
    ),
    http.post("*/api/v1/operator/source-proposals/:id/claim/", () =>
      caseJson({ id: "claim", revision: 1 }, { status: 201 }),
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
        caseJson([
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
      caseJson({
        id: "manager",
        email: "manager@example.com",
        operator_capabilities: ["manage_operator_queues"],
      }),
    ),
    http.get("*/api/v1/operator/source-proposals/", () => caseJson([caseData])),
    http.get("*/api/v1/operator/external-listing-candidates/", () =>
      caseJson([]),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/responsibility/",
      async ({ request }) => {
        body = await request.json();
        return caseJson({
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
        caseJson({ id, operator_capabilities: capabilities }),
      ),
      http.get("*/api/v1/operator/source-proposals/", () =>
        caseJson([
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
        caseJson([]),
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
      caseJson({
        id: "manager",
        operator_capabilities: ["manage_operator_queues"],
      }),
    ),
    http.get("*/api/v1/operator/source-proposals/", () =>
      caseJson([makeCase()]),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:proposalId/responsibility/",
      () => {
        revision = 2;
        return caseJson(
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
      caseJson({
        id: "operator",
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
    http.get("*/api/v1/operator/source-proposals/", () => caseJson([caseData])),
    http.get("*/api/v1/operator/external-listing-candidates/", () =>
      caseJson([]),
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
        return caseJson(caseData);
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
      caseJson({
        id: "operator",
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
    http.get("*/api/v1/operator/source-proposals/", () => caseJson([caseData])),
    http.get("*/api/v1/operator/external-listing-candidates/", () =>
      caseJson([]),
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
        return caseJson(caseData);
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

test("lets the responsible operator work across tabs without claiming or renewing a lease", async () => {
  const user = userEvent.setup();
  let claims = 0;
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () => caseJson([proposal])),
    http.post("*/api/v1/operator/source-proposals/:id/claim/", () => {
      claims += 1;
      return caseJson(
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
  expect(await screen.findByText("شما مسئول این پرونده هستید")).toBeVisible();
  expect(claims).toBe(0);
  expect(screen.queryByText(/مهلت بررسی:/)).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).toBeDisabled();
  await user.type(screen.getByLabelText("سقف صفحات قابل بررسی"), "250");
  await user.type(screen.getByLabelText("تعداد آگهی اجاره هدف"), "200");
  expect(
    screen.getByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).toHaveAccessibleDescription(/علامت بزنید/);
  await user.click(await screen.findByLabelText(/نشانی و اختیار نماینده/));
  expect(
    screen.getByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).toBeEnabled();
  await user.click(screen.getByRole("tab", { name: "استخراج اطلاعات" }));
  expect(
    screen.queryByRole("button", { name: "تمدید مهلت بررسی" }),
  ).not.toBeInTheDocument();
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
      caseJson({
        id: "operator",
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
    http.get("*/api/v1/operator/source-proposals/", () => caseJson([caseData])),
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
        return caseJson(caseData);
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
  await user.type(
    screen.getByRole("spinbutton", { name: "سقف صفحات بررسی‌شده" }),
    "25",
  );
  await user.type(
    screen.getByRole("spinbutton", { name: "تعداد آگهی هدف" }),
    "10",
  );
  await user.click(
    screen.getByRole("button", { name: "دریافت و به‌روزرسانی اکنون" }),
  );
  await waitFor(() =>
    expect(bodies[0]).toEqual({
      action: "run",
      url: "https://khaneh.example/more",
      max_pages: 25,
      target_detail_pages: 10,
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
    await screen.findByRole("heading", { name: "مدیریت محدودیت‌ها" }),
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
        return caseJson({
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

test("loads the selected section and fetches listing evidence only when opened", async () => {
  const requests: string[] = [];
  server.use(
    http.get("*/api/v1/operator/source-proposals/", ({ request }) => {
      requests.push(
        new URL(request.url).searchParams.get("section") ?? "missing",
      );
      return HttpResponse.json([
        {
          ...proposal,
          needs_reconciliation: false,
          assignment: {
            id: 1,
            state: "active",
            source: {},
            recent_requests: [],
            exceptions: [],
            exclusions: [],
          },
          properties: [],
          profile_versions: [],
          counts: { properties: 1, runs: 1, problems: 0, exclusions: 0 },
        },
      ]);
    }),
    http.get("*/api/v1/operator/source-proposals/:id/results/", () => {
      requests.push("results");
      return HttpResponse.json({
        count: 1,
        results: [
          {
            id: "candidate-lazy",
            title: "ملک تازه",
            external_url: "https://example.com/one",
            state: "pending",
            validation_errors: {},
          },
        ],
      });
    }),
    http.get("*/api/v1/operator/external-listing-candidates/:id/", () => {
      requests.push("candidate");
      return HttpResponse.json({
        id: "candidate-lazy",
        title: "ملک تازه",
        external_url: "https://example.com/one",
        state: "rejected",
        validation_errors: {},
        media: [],
        history: [],
        source: {},
        evidence: {},
      });
    }),
  );
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <OperatorSourceProposalDetailPage proposalId={proposal.id} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "خانه‌یاب" });
  expect(requests).toEqual(["overview"]);
  await user.click(screen.getByRole("tab", { name: "ملک‌ها و نتایج" }));
  await screen.findByText("ملک تازه");
  expect(requests).toEqual(["overview", "exceptions", "results"]);
  await user.click(screen.getByRole("link", { name: "بررسی آگهی" }));
  await screen.findByRole("dialog");
  await waitFor(() => expect(requests).toContain("candidate"));
});

test("offers the responsible operator a fresh review from an active profile tab", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      caseJson([
        {
          ...proposal,
          state: "approved",
          discovery_stage: "complete",
          discovery: { id: "discovery-1", evidence: {} },
          assignment: {
            id: 8,
            source: {
              domain: "khaneh.example",
              display_name: "خانه‌یاب",
              processing_paused: false,
            },
            review_operator: "operator",
            state: "active",
            active_profile_version: { id: "profile-1", number: 1 },
            recent_requests: [],
          },
          profile_versions: [
            {
              id: "profile-1",
              number: 1,
              reservation: "discovery-1",
              is_active: true,
              status: "approved",
              rules: {},
              validation: {
                training_page_urls: [],
                held_out_page_urls: [],
                fields: {},
                rules_valid: true,
              },
              samples: [],
              exclusions: [],
            },
          ],
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
  expect(await screen.findByText("نسخه فعال", { exact: true })).toBeVisible();
  expect(
    screen.queryByText(/برای تغییر قواعد، مسئولیت پرونده/),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/نمونه‌ای برای نمایش در این نسخه موجود نیست/),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "بررسی و فعال‌سازی" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "بهبود استخراج" }));
  expect(
    await screen.findByRole("button", { name: "آغاز بررسی نسخه تازه پروفایل" }),
  ).toBeDisabled();
  expect(screen.getByRole("tab", { name: "نشانی و کشف" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

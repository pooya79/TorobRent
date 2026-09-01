import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { OperatorSourceProposalPage } from "@/pages/OperatorSourceProposalPage";
import { server } from "./server";

const proposal = {
  id: "10000000-0000-4000-8000-000000000088",
  state: "pending",
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
  expect(screen.getAllByText("۵۱ تا ۲۰۰")).toHaveLength(2);
  expect(screen.getByText("دسته اجاره از فروش جداست.")).toBeVisible();
  expect(screen.getByText(/دامنه تکراری/)).toBeVisible();
  expect(screen.getByText("پیش‌نمایش شبیه‌سازی‌شده")).toBeVisible();
  expect(screen.getByText("تعداد تخمینی کشف")).toBeVisible();
  expect(screen.getByText("نمونه ملک مسکونی")).toBeVisible();

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
      external_url: "https://khaneh.example/demo-listings/residential-1",
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
      external_url: "https://khaneh.example/demo-listings/commercial-2",
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

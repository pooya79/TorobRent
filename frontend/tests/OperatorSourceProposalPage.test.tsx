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

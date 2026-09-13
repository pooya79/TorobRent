import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";

import { OperatorOverviewPage } from "@/pages/OperatorOverviewPage";
import {
  operatorQueueQueryOptions,
  submissionWorkloadSummaryQueryOptions,
} from "@/features/submissions/queries";
import {
  supportQueueQueryOptions,
  supportWorkloadSummaryQueryOptions,
} from "@/features/support/queries";
import { server } from "./server";

function renderOverview(
  capabilities: (
    | "handle_privacy_requests"
    | "handle_support"
    | "curate_catalog"
    | "manage_operator_queues"
    | "moderate_conversations"
    | "review_submissions"
    | "review_source_proposals"
  )[],
) {
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "1f77778d-c15f-4bd1-9c84-1ffea15ca80f",
        email: "operator@example.com",
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: capabilities,
      }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OperatorOverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("shows parallel workload summaries only for modules the Operator may access", async () => {
  const submissionSummary = vi.fn(() =>
    HttpResponse.json({
      unclaimed_count: 3,
      assigned_to_me_count: 2,
      aging_count: 1,
      aging_after_hours: 48,
    }),
  );
  const supportSummary = vi.fn(() =>
    HttpResponse.json({
      unclaimed_count: 4,
      assigned_to_me_count: 1,
      urgent_count: 2,
      aging_count: 3,
      aging_after_hours: 48,
    }),
  );
  server.use(
    http.get("*/api/v1/operator/submissions/summary/", submissionSummary),
    http.get("*/api/v1/operator/support-requests/summary/", supportSummary),
  );

  renderOverview(["handle_support"]);

  const summary = await screen.findByRole("list", { name: "خلاصه حجم کار" });
  expect(within(summary).getByText("۴")).toBeVisible();
  expect(within(summary).getByText("در انتظار مسئول")).toBeVisible();
  expect(within(summary).getByText("۱")).toBeVisible();
  expect(within(summary).getByText("واگذارشده به من")).toBeVisible();
  expect(within(summary).getByText("۲ درخواست فوری")).toBeVisible();
  expect(
    within(summary).getByText("۳ مورد با زمان انتظار بیش از ۴۸ ساعت"),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "بررسی درخواست‌های ثبت آگهی" }),
  ).toBeNull();
  expect(screen.getByText("بررسی پیوندها · به‌زودی")).toBeVisible();
  expect(
    screen.getByText(/بررسی پیوندها.*هنوز گردش‌کار عملیاتی ندارد/),
  ).toBeVisible();
  expect(supportSummary).toHaveBeenCalledOnce();
  expect(submissionSummary).not.toHaveBeenCalled();
});

test("shows the Catalog Curation count only with its capability", async () => {
  server.use(
    http.get("*/api/v1/operator/catalog-curation/summary/", () =>
      HttpResponse.json({
        suggestion_count: 4,
        grouped_property_count: 2,
        total_count: 6,
      }),
    ),
  );

  renderOverview(["curate_catalog"]);

  expect(await screen.findByText("۶")).toBeVisible();
  expect(screen.getByText("مورد نیازمند رسیدگی")).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "پشتیبانی" }),
  ).not.toBeInTheDocument();
});

test("shows Conversation Reports only for the dedicated moderation capability", async () => {
  renderOverview(["moderate_conversations"]);

  expect(
    await screen.findByRole("link", { name: "گزارش‌های گفت‌وگو" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "پشتیبانی" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "بررسی Submissionها" }),
  ).not.toBeInTheDocument();
});

test("polls accessible queues and their overview summaries every thirty seconds", () => {
  expect(operatorQueueQueryOptions().refetchInterval).toBe(30_000);
  expect(submissionWorkloadSummaryQueryOptions().refetchInterval).toBe(30_000);
  expect(supportQueueQueryOptions().refetchInterval).toBe(30_000);
  expect(supportWorkloadSummaryQueryOptions().refetchInterval).toBe(30_000);
});

test("keeps one domain summary failure local to its module", async () => {
  server.use(
    http.get("*/api/v1/operator/submissions/summary/", () =>
      HttpResponse.json(
        { detail: "Summary temporarily unavailable." },
        { status: 503 },
      ),
    ),
    http.get("*/api/v1/operator/support-requests/summary/", () =>
      HttpResponse.json({
        unclaimed_count: 1,
        assigned_to_me_count: 0,
        urgent_count: 0,
        aging_count: 0,
        aging_after_hours: 48,
      }),
    ),
  );

  renderOverview(["review_submissions", "handle_support"]);

  const summary = await screen.findByRole("list", { name: "خلاصه حجم کار" });
  expect(within(summary).getByText("۱")).toBeVisible();
  expect(within(summary).getByText("در انتظار مسئول")).toBeVisible();
  expect(
    await screen.findByText("خلاصه این بخش فعلاً در دسترس نیست."),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "بررسی درخواست‌های ثبت آگهی" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "پشتیبانی" })).toBeVisible();
});

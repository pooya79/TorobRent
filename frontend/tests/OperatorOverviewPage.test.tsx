import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
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
    | "manage_operator_queues"
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

  expect(await screen.findByText("۴ کار بدون مسئول")).toBeVisible();
  expect(screen.getByText("۱ کار واگذارشده به من")).toBeVisible();
  expect(screen.getByText("۲ درخواست فوری")).toBeVisible();
  expect(screen.getByText("۳ هشدار بیش از ۴۸ ساعت")).toBeVisible();
  expect(screen.queryByRole("link", { name: "بررسی Submissionها" })).toBeNull();
  expect(screen.getByText("بررسی پیوندها")).toBeVisible();
  expect(
    screen.getByText(/Link Verification.*هنوز گردش‌کار عملیاتی ندارد/),
  ).toBeVisible();
  expect(supportSummary).toHaveBeenCalledOnce();
  expect(submissionSummary).not.toHaveBeenCalled();
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

  expect(await screen.findByText("۱ کار بدون مسئول")).toBeVisible();
  expect(
    await screen.findByText("خلاصه این بخش فعلاً در دسترس نیست."),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "بررسی Submissionها" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "پشتیبانی" })).toBeVisible();
});

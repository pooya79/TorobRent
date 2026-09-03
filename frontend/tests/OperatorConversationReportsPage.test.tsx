import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";

import { OperatorConversationReportsPage } from "@/pages/OperatorConversationReportsPage";
import { server } from "./server";

const reportId = "10000000-0000-4000-8000-000000000102";
const renterId = "20000000-0000-4000-8000-000000000102";
const submitterId = "30000000-0000-4000-8000-000000000102";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OperatorConversationReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function serveReport(decision = vi.fn()) {
  server.use(
    http.get("*/api/v1/operator/conversation-reports/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: reportId,
            status: "pending",
            target: "message",
            created_at: "2026-09-03T08:00:00Z",
          },
        ],
      }),
    ),
    http.get("*/api/v1/operator/conversation-reports/:id/", () =>
      HttpResponse.json({
        id: reportId,
        status: "pending",
        target: "message",
        created_at: "2026-09-03T08:00:00Z",
        explanation: "پیام توهین‌آمیز است.",
        reporter: { display_name: "رها" },
        evidence: {
          inquiry_id: "40000000-0000-4000-8000-000000000102",
          target_message_id: "50000000-0000-4000-8000-000000000102",
          participants: {
            renter_id: renterId,
            submitter_id: submitterId,
          },
          messages: [
            {
              id: "50000000-0000-4000-8000-000000000102",
              author_id: renterId,
              author_display_name: "رها",
              body: "متن گزارش‌شده",
              created_at: "2026-09-03T07:58:00Z",
              edited_at: null,
            },
            {
              id: "60000000-0000-4000-8000-000000000102",
              author_id: submitterId,
              author_display_name: "مالک",
              body: "پاسخ پیرامونی",
              created_at: "2026-09-03T07:59:00Z",
              edited_at: null,
            },
          ],
        },
        pair_restricted: false,
        suspended_account_ids: [],
        audit_history: [
          {
            id: "70000000-0000-4000-8000-000000000102",
            event_type: "inspected",
            actor_label: "moderator@example.com",
            internal_note: "",
            metadata: {},
            created_at: "2026-09-03T08:01:00Z",
          },
        ],
      }),
    ),
    http.post(
      "*/api/v1/operator/conversation-reports/:id/decision/",
      async ({ request }) => {
        decision(await request.json());
        return HttpResponse.json({
          id: reportId,
          status: "upheld",
          pair_restricted: true,
          suspended_account_id: renterId,
          decided_at: "2026-09-03T08:03:00Z",
        });
      },
    ),
  );
  return decision;
}

test("investigates only report-scoped frozen evidence in an accessible workflow", async () => {
  serveReport();
  renderPage();

  expect(
    await screen.findByRole("heading", { name: "صف گزارش‌های گفت‌وگو" }),
  ).toBeVisible();
  expect(await screen.findByText("پیام توهین‌آمیز است.")).toBeVisible();
  expect(screen.getByText("متن گزارش‌شده")).toBeVisible();
  expect(screen.getByText("پاسخ پیرامونی")).toBeVisible();
  expect(screen.getAllByText("رها", { selector: "strong" })).toHaveLength(2);
  expect(
    screen.getByRole("heading", { name: "شواهد ثابت گزارش" }),
  ).toBeVisible();
  expect(screen.getByLabelText("تاریخچه ممیزی بررسی")).toBeVisible();
  expect(screen.queryByRole("link", { name: /گفت‌وگوی خصوصی/ })).toBeNull();
});

test("upholds a report with explicit proportionate restrictions", async () => {
  const decision = serveReport();
  const user = userEvent.setup();
  renderPage();

  await screen.findByText("متن گزارش‌شده");
  await user.selectOptions(screen.getByLabelText("نتیجه بررسی"), "upheld");
  await user.click(screen.getByLabelText("قطع ارتباط این دو حساب"));
  await user.selectOptions(
    screen.getByLabelText("تعلیق شروع گفت‌وگوی تازه"),
    renterId,
  );
  await user.type(
    screen.getByLabelText("یادداشت داخلی"),
    "الگوی آزار تأیید شد.",
  );
  await user.click(screen.getByRole("button", { name: "ثبت تصمیم" }));

  await waitFor(() =>
    expect(decision).toHaveBeenCalledWith({
      decision: "upheld",
      internal_note: "الگوی آزار تأیید شد.",
      restrict_pair: true,
      suspend_account_id: renterId,
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("تصمیم ثبت شد");
});

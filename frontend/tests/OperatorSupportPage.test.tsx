import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { OperatorSupportPage } from "@/pages/OperatorSupportPage";
import { server } from "./server";

const requestId = "10000000-0000-4000-8000-000000000039";
const assignedAt = "2026-08-24T08:00:00Z";

const queueItem = {
  id: requestId,
  name: "نگار محمدی",
  email: "negar@example.com",
  intake_kind: "general",
  classification: "guidance",
  status: "in_progress",
  assignee_id: "20000000-0000-4000-8000-000000000039",
  assignee_email: "operator@example.com",
  assigned_at: assignedAt,
  created_at: "2026-08-20T08:00:00Z",
  updated_at: assignedAt,
};

function serveSupportRequest() {
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: queueItem.assignee_id,
        email: queueItem.assignee_email,
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: ["handle_support"],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [queueItem],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/:id/", () =>
      HttpResponse.json({
        ...queueItem,
        message: "برای ورود به حساب راهنمایی می‌خواهم.",
        operator_note: "",
        history: [
          {
            id: "30000000-0000-4000-8000-000000000039",
            event_type: "assigned",
            actor_id: queueItem.assignee_id,
            actor_email: queueItem.assignee_email,
            prior_state: "open",
            new_state: "in_progress",
            reason: "",
            created_at: assignedAt,
          },
        ],
      }),
    ),
  );
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OperatorSupportPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("loads an existing durable assignment with request and event details", async () => {
  serveSupportRequest();
  renderPage();

  expect(
    await screen.findByRole("heading", { name: "صف درخواست‌های پشتیبانی" }),
  ).toBeVisible();
  expect(screen.getAllByText("نگار محمدی")[0]).toBeVisible();
  expect(screen.getByText(/سن واگذاری:/)).toBeVisible();
  expect(
    await screen.findByText("برای ورود به حساب راهنمایی می‌خواهم."),
  ).toBeVisible();
  expect(screen.getByText("زمان واگذاری")).toBeVisible();
  expect(screen.getByLabelText("زمان واگذاری ثبت‌شده")).toHaveAttribute(
    "datetime",
    assignedAt,
  );
  expect(screen.getByLabelText("زمان رویداد")).toHaveAttribute(
    "datetime",
    assignedAt,
  );
  expect(
    screen.getByRole("button", { name: "آزاد کردن درخواست" }),
  ).toBeVisible();
});

test("claims an open request and lets its assignee release it", async () => {
  const user = userEvent.setup();
  let status = "open";
  let claimCount = 0;
  let releaseCount = 0;
  const currentItem = () => ({
    ...queueItem,
    status,
    assignee_id: status === "open" ? null : queueItem.assignee_id,
    assignee_email: status === "open" ? null : queueItem.assignee_email,
    assigned_at: status === "open" ? null : assignedAt,
  });
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: queueItem.assignee_id,
        email: queueItem.assignee_email,
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: ["handle_support"],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [currentItem()],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/:id/", () =>
      HttpResponse.json({
        ...currentItem(),
        message: "برای ورود به حساب راهنمایی می‌خواهم.",
        operator_note: "",
        history: [],
      }),
    ),
    http.post("*/api/v1/operator/support-requests/:id/claim/", () => {
      claimCount += 1;
      status = "in_progress";
      return HttpResponse.json(
        {
          ...currentItem(),
          message: "درخواست",
          operator_note: "",
          history: [],
        },
        { status: 201 },
      );
    }),
    http.delete("*/api/v1/operator/support-requests/:id/claim/", () => {
      releaseCount += 1;
      status = "open";
      return new HttpResponse(null, { status: 204 });
    }),
  );
  renderPage();

  await user.click(
    await screen.findByRole("button", { name: "پذیرفتن درخواست" }),
  );

  await waitFor(() => expect(claimCount).toBe(1));
  await user.click(
    await screen.findByRole("button", { name: "آزاد کردن درخواست" }),
  );

  await waitFor(() => expect(releaseCount).toBe(1));
  expect(
    await screen.findByRole("button", { name: "پذیرفتن درخواست" }),
  ).toBeVisible();
});

test("sends queue filters to the server", async () => {
  const user = userEvent.setup();
  let requestedStatus: string | null = null;
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: queueItem.assignee_id,
        email: queueItem.assignee_email,
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: ["handle_support"],
      }),
    ),
    http.get("*/api/v1/operator/support-requests/", ({ request }) => {
      requestedStatus = new URL(request.url).searchParams.get("status");
      return HttpResponse.json({
        count: 0,
        next: null,
        previous: null,
        results: [],
      });
    }),
  );
  renderPage();

  await user.selectOptions(
    await screen.findByLabelText("وضعیت"),
    "in_progress",
  );

  await waitFor(() => expect(requestedStatus).toBe("in_progress"));
});

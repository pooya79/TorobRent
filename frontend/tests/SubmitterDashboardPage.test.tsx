import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { SubmitterDashboardPage } from "@/pages/SubmitterDashboardPage";
import { server } from "./server";

test("lists the Submitter's draft state and server-backed resume action", async () => {
  server.use(
    http.get("*/api/v1/submissions/", () =>
      HttpResponse.json([
        {
          id: "10000000-0000-4000-8000-000000000010",
          role: "agent",
          state: "draft",
          current_step: "rental_terms",
          media_complete: false,
          location: {
            neighborhood: "سعادت‌آباد",
            neighborhood_id: "30000000-0000-4000-8000-000000000043",
          },
          property_facts: null,
          rental_terms: null,
          features: {},
          description: "",
          contact: null,
          review: {},
          available_actions: ["edit", "submit"],
          created_at: "2026-08-22T08:00:00Z",
          updated_at: "2026-08-22T09:00:00Z",
        },
      ]),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SubmitterDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByText("ملک در سعادت‌آباد")).toBeVisible();
  expect(screen.getByText("پیش‌نویس")).toBeVisible();
  expect(screen.getByText("مرحله کنونی: شرایط اجاره")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "ادامه ملک در سعادت‌آباد" }),
  ).toHaveAttribute(
    "href",
    "/add-submission?submission=10000000-0000-4000-8000-000000000010&step=rental_terms",
  );
  expect(
    screen.getByRole("link", { name: "ارسال برای بررسی ملک در سعادت‌آباد" }),
  ).toHaveAttribute(
    "href",
    "/add-submission?submission=10000000-0000-4000-8000-000000000010&step=review",
  );
});

test("shows current review state, reason, history, and the available edit action", async () => {
  server.use(
    http.get("*/api/v1/submissions/", () =>
      HttpResponse.json([
        {
          id: "10000000-0000-4000-8000-000000000012",
          role: "owner",
          state: "changes_requested",
          revision: 1,
          current_step: "review",
          media_complete: true,
          images: [],
          location: { neighborhood: "سعادت‌آباد" },
          property_facts: null,
          rental_terms: null,
          features: {},
          description: "",
          contact: null,
          review: {},
          history: [
            {
              id: "40000000-0000-4000-8000-000000000004",
              actor_email: "operator@example.com",
              revision: 1,
              prior_state: "pending",
              new_state: "changes_requested",
              reason: "شماره تماس را اصلاح کنید.",
              created_at: "2026-08-22T09:00:00Z",
            },
          ],
          available_actions: ["edit"],
          created_at: "2026-08-22T08:00:00Z",
          updated_at: "2026-08-22T09:00:00Z",
        },
      ]),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SubmitterDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByText("نیازمند اصلاح")).toBeVisible();
  expect(screen.getAllByText("شماره تماس را اصلاح کنید.")).toHaveLength(2);
  expect(screen.getByText("نسخه ۱")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "اصلاح ملک در سعادت‌آباد" }),
  ).toHaveAttribute(
    "href",
    "/add-submission?submission=10000000-0000-4000-8000-000000000012&step=review",
  );
});

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
});

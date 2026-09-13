import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Outlet, Route, Routes, useLocation } from "react-router";
import { expect, test, vi } from "vitest";

import {
  OperatorCapabilityRoute,
  OperatorWorkspace,
} from "@/features/operator/OperatorWorkspace";
import { ThemeProvider } from "@/app/ThemeProvider";
import { loader as compatibilityRedirect } from "@/routes/operator-review-redirect";
import { server } from "./server";

type Capability =
  | "curate_catalog"
  | "handle_privacy_requests"
  | "handle_support"
  | "manage_operator_queues"
  | "moderate_conversations"
  | "review_submissions"
  | "review_source_proposals";

function LoginDestination() {
  const location = useLocation();
  return <p>ورود: {location.search}</p>;
}

function renderWorkspace(
  entry: string,
  capabilities: Capability[] = ["review_submissions"],
  emailVerified = true,
  authenticated = true,
) {
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated, csrf_token: "test-token" }),
    ),
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "1f77778d-c15f-4bd1-9c84-1ffea15ca80f",
        email: "operator@example.com",
        first_name: "",
        last_name: "",
        email_verified: emailVerified,
        operator_capabilities: capabilities,
      }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route element={<OperatorWorkspace />}>
              <Route index element={<h1>نمای کلی</h1>} />
              <Route
                path="operator/catalog-curation"
                element={
                  <OperatorCapabilityRoute capability="curate_catalog">
                    <h1>مقایسه هویت ملک‌ها</h1>
                  </OperatorCapabilityRoute>
                }
              />
              <Route
                path="operator/source-proposals"
                element={
                  <OperatorCapabilityRoute capability="review_source_proposals">
                    <h1>اعتبارسنجی Source Proposalها</h1>
                  </OperatorCapabilityRoute>
                }
              />
              <Route
                path="operator/submissions"
                element={
                  <OperatorCapabilityRoute capability="review_submissions">
                    <h1>بررسی Submissionها</h1>
                  </OperatorCapabilityRoute>
                }
              />
              <Route
                path="operator/support"
                element={
                  <OperatorCapabilityRoute capability="handle_support">
                    <h1>درخواست‌های پشتیبانی</h1>
                  </OperatorCapabilityRoute>
                }
              />
              <Route
                path="operator/conversation-reports"
                element={
                  <OperatorCapabilityRoute capability="moderate_conversations">
                    <h1>صف گزارش‌های گفت‌وگو</h1>
                  </OperatorCapabilityRoute>
                }
              />
              <Route path="operator/links" element={<Outlet />} />
            </Route>
            <Route path="login" element={<LoginDestination />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

test("redirects anonymous Operator access to login with a safe return URL", async () => {
  renderWorkspace(
    "/operator/submissions?state=pending",
    ["review_submissions"],
    true,
    false,
  );

  expect(
    await screen.findByText(
      "ورود: ?returnTo=%2Foperator%2Fsubmissions%3Fstate%3Dpending",
    ),
  ).toBeVisible();
});

test("shows verification required before exposing the Operator workspace", async () => {
  renderWorkspace("/operator/submissions", ["review_submissions"], false);

  expect(
    await screen.findByRole("heading", { name: "تأیید ایمیل لازم است" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "بررسی Submissionها" }),
  ).not.toBeInTheDocument();
});

test("shows explicit access denied for a verified account missing the requested capability", async () => {
  renderWorkspace("/operator/submissions", ["handle_support"]);

  expect(
    await screen.findByRole("heading", {
      name: "دسترسی به این بخش داده نشده است",
    }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "بررسی Submissionها" }),
  ).not.toBeInTheDocument();
});

test("navigation contains only modules covered by the account capabilities", async () => {
  renderWorkspace("/operator/support", ["handle_support"]);

  expect(
    await screen.findByRole("heading", { name: "درخواست‌های پشتیبانی" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "پشتیبانی" })).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "بررسی Submissionها" }),
  ).not.toBeInTheDocument();
});

test("shows Source Proposal validation only for its dedicated capability", async () => {
  renderWorkspace("/operator/source-proposals", ["review_source_proposals"]);

  expect(
    await screen.findByRole("heading", {
      name: "اعتبارسنجی Source Proposalها",
    }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "مدیریت منابع" })).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "بررسی درخواست‌های ثبت آگهی" }),
  ).not.toBeInTheDocument();
});

test("shows Catalog Curation only for its independent capability", async () => {
  server.use(
    http.get("*/api/v1/operator/catalog-curation/summary/", () =>
      HttpResponse.json({
        suggestion_count: 3,
        grouped_property_count: 2,
        total_count: 5,
      }),
    ),
  );
  renderWorkspace("/operator/catalog-curation", ["curate_catalog"]);

  expect(
    await screen.findByRole("heading", { name: "مقایسه هویت ملک‌ها" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "ساماندهی کاتالوگ" })).toBeVisible();
  await screen.findByText("۵");
  expect(
    screen.getByRole("link", { name: "ساماندهی کاتالوگ" }),
  ).toHaveTextContent("۵");
  expect(
    screen.queryByRole("link", { name: "بررسی درخواست‌های ثبت آگهی" }),
  ).not.toBeInTheDocument();
});

test("does not expose or count Catalog Curation without its capability", async () => {
  const summaryRequest = vi.fn();
  server.use(
    http.get("*/api/v1/operator/catalog-curation/summary/", () => {
      summaryRequest();
      return HttpResponse.json({
        suggestion_count: 3,
        grouped_property_count: 2,
        total_count: 5,
      });
    }),
  );
  renderWorkspace("/operator/catalog-curation", ["handle_support"]);

  expect(
    await screen.findByRole("heading", {
      name: "دسترسی به این بخش داده نشده است",
    }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "ساماندهی کاتالوگ" }),
  ).not.toBeInTheDocument();
  expect(summaryRequest).not.toHaveBeenCalled();
});

test("shows the Conversation Report queue only for its dedicated capability", async () => {
  renderWorkspace("/operator/conversation-reports", ["moderate_conversations"]);

  expect(
    await screen.findByRole("heading", { name: "صف گزارش‌های گفت‌وگو" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "گزارش‌های گفت‌وگو" })).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "پشتیبانی" }),
  ).not.toBeInTheDocument();
});

test("the old review route redirects to the canonical Submission Review route", () => {
  const response = compatibilityRedirect();

  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/operator/submissions");
});

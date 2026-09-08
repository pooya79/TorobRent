import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, test } from "vitest";
import { OperatorSourceProposalPage } from "@/pages/OperatorSourceProposalPage";
import { OperatorSourceProposalDetailPage } from "@/pages/OperatorSourceProposalDetailPage";
import { server } from "./server";

const source = {
  id: "source-a",
  website_name: "خانه آبی",
  website_url: "https://blue.example/rent",
  state: "pending",
  discovery_stage: "awaiting_url",
  created_at: "2026-09-01T08:00:00Z",
  revision: 1,
  history: [],
  profile_versions: [],
  authority_declared: true,
};
function setup(path = "/operator/source-proposals") {
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "me",
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/operator/source-proposals"
            element={<OperatorSourceProposalPage />}
          />
          <Route
            path="/operator/source-proposals/:proposalId"
            element={<OperatorSourceProposalDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
test("filters and searches the queue without rendering source review forms or fetching listings", async () => {
  let listingRequests = 0;
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([
        source,
        {
          ...source,
          id: "source-b",
          website_name: "خانه سبز",
          website_url: "https://green.example",
          discovery_stage: "complete",
          responsibility: {
            operator: "someone",
            operator_label: "reviewer@example.com",
            history: [],
          },
        },
      ]),
    ),
    http.get("*/api/v1/operator/external-listing-candidates/", () => {
      listingRequests++;
      return HttpResponse.json([]);
    }),
  );
  setup();
  const user = userEvent.setup();
  expect(await screen.findByRole("link", { name: "خانه آبی" })).toHaveAttribute(
    "href",
    "/operator/source-proposals/source-a",
  );
  expect(
    screen.queryByRole("button", { name: "شروع بررسی" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /بدون مسئول/ }));
  expect(
    screen.queryByRole("link", { name: "خانه سبز" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /همه منابع/ }));
  await user.type(
    screen.getByLabelText("جست‌وجوی نام یا دامنه"),
    "green.example",
  );
  expect(screen.getByRole("link", { name: "خانه سبز" })).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "خانه آبی" }),
  ).not.toBeInTheDocument();
  expect(listingRequests).toBe(0);
});
test("opens exactly one case from a legacy link and exposes its sections", async () => {
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([
        source,
        { ...source, id: "other", website_name: "منبع دیگر" },
      ]),
    ),
  );
  setup("/operator/source-proposals?proposal=source-a");
  expect(
    await screen.findByRole("heading", { name: "خانه آبی" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "منبع دیگر" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("tablist", { name: "بخش‌های پرونده" })).toBeVisible();
  expect(
    screen.getByRole("link", { name: "آگهی‌های این منبع" }),
  ).toHaveAttribute("href", "/operator/external-listings?proposal=source-a");
});
test("shows a useful empty result when search matches no source", async () => {
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([source]),
    ),
  );
  setup("/operator/source-proposals?q=missing");
  expect(
    await screen.findByRole("heading", { name: "منبعی پیدا نشد" }),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "پاک کردن فیلترها" }),
  );
  expect(screen.getByRole("link", { name: "خانه آبی" })).toBeVisible();
});

test("keeps flagged sources in their stage filter and identifies the assigned operator", async () => {
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([
        { ...source, needs_reconciliation: true },
        {
          ...source,
          id: "mine",
          website_name: "منبع من",
          discovery_stage: "complete",
          responsibility: {
            operator: "me",
            operator_label: "me@example.com",
            history: [],
          },
        },
        {
          ...source,
          id: "active",
          website_name: "منبع فعال",
          state: "approved",
          assignment: {
            state: "active",
            review_operator: "someone",
            source: { processing_paused: false },
          },
        },
      ]),
    ),
  );
  setup();
  const user = userEvent.setup();
  await screen.findByRole("link", { name: "خانه آبی" });
  await user.click(screen.getByRole("button", { name: /بررسی نشانی/ }));
  expect(screen.getByRole("link", { name: "خانه آبی" })).toBeVisible();
  expect(screen.getByText("دامنه تکراری")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /واگذارشده به من/ }));
  expect(screen.getByRole("link", { name: "منبع من" })).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "خانه آبی" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /منابع فعال/ }));
  expect(screen.getByRole("link", { name: "منبع فعال" })).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "منبع من" }),
  ).not.toBeInTheDocument();
});

test("shows submitter identity and keeps only the selected section visible without losing form input", async () => {
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([
        {
          ...source,
          submitter: {
            id: "representative",
            display_name: "سارا احمدی",
            account_label: "sara@example.com",
          },
        },
      ]),
    ),
    http.post("*/api/v1/operator/source-proposals/:id/claim/", () =>
      HttpResponse.json({ id: "claim" }),
    ),
  );
  setup();
  const user = userEvent.setup();
  expect(await screen.findByText("سارا احمدی")).toBeVisible();
  expect(screen.getByText("sara@example.com")).toBeVisible();
  await user.click(screen.getByRole("link", { name: "خانه آبی" }));
  expect(
    await screen.findByRole("tabpanel", { name: "نمای کلی" }),
  ).toBeVisible();
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  await user.click(screen.getByRole("tab", { name: "نشانی و کشف" }));
  await user.click(screen.getByRole("button", { name: "شروع بررسی" }));
  await user.type(screen.getByLabelText("سقف صفحات قابل بررسی"), "50");
  await user.click(screen.getByRole("tab", { name: "نمای کلی" }));
  expect(
    screen.queryByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).not.toBeInTheDocument();
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "نشانی و کشف" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByLabelText("سقف صفحات قابل بررسی")).toHaveValue(50);
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
});

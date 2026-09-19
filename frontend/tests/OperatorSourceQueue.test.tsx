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
function setup(path = "/operator/source-proposals?filter=all") {
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
  await user.click(screen.getByRole("button", { name: /^آماده پذیرش/ }));
  expect(
    screen.queryByRole("link", { name: "خانه سبز" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /همه پرونده‌ها/ }));
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
  ).toHaveAttribute("href", "/operator/source-proposals/source-a#exceptions");
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
    screen.getByRole("button", { name: "مشاهده پرونده‌های آماده پذیرش" }),
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
  await user.click(screen.getByRole("button", { name: /پرونده‌های من/ }));
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
          responsibility: { operator: "me", revision: 1, history: [] },
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
  await screen.findByText("شما مسئول این پرونده هستید");
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

test("defaults to my cases and takes durable responsibility from the unassigned queue", async () => {
  let owned = false;
  let claims = 0;
  const caseData = () => ({
    ...source,
    responsibility: {
      operator: owned ? "me" : null,
      operator_label: owned ? "me@example.com" : null,
      revision: owned ? 1 : 0,
      history: [],
    },
  });
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([caseData()]),
    ),
    http.post("*/api/v1/operator/source-proposals/:id/claim/", () => {
      owned = true;
      claims += 1;
      return HttpResponse.json(caseData(), { status: 201 });
    }),
  );
  setup("/operator/source-proposals");
  const user = userEvent.setup();
  expect(
    await screen.findByRole("button", { name: /پرونده‌های من/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.queryByRole("link", { name: "خانه آبی" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /^آماده پذیرش/ }));
  await user.click(
    await screen.findByRole("button", { name: "پذیرش مسئولیت و شروع کار" }),
  );
  expect(await screen.findByText("شما مسئول این پرونده هستید")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).toBeVisible();
  await user.click(screen.getByRole("tab", { name: "پروفایل" }));
  expect(
    screen.queryByRole("button", { name: "پذیرش بررسی پروفایل" }),
  ).not.toBeInTheDocument();
  expect(claims).toBe(1);
});

test("keeps another operator's case read-only even through a direct URL", async () => {
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([
        {
          ...source,
          responsibility: {
            operator: "other",
            operator_label: "other@example.com",
            revision: 1,
            history: [],
          },
        },
      ]),
    ),
  );
  setup("/operator/source-proposals/source-a#url");
  expect(await screen.findByText("پرونده فقط خواندنی است")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "تأیید نشانی و شروع کشف" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "پذیرش مسئولیت و شروع کار" }),
  ).not.toBeInTheDocument();
});

test("queue managers transfer a case without opening its workspace", async () => {
  let transferred = false;
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([
        {
          ...source,
          responsibility: {
            operator: transferred ? "next" : "me",
            operator_label: transferred ? "next@example.com" : "me@example.com",
            revision: transferred ? 2 : 1,
            history: [],
          },
        },
      ]),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:id/responsibility/",
      async ({ request }) => {
        expect(await request.json()).toEqual({
          assignee_email: "next@example.com",
          reason: "تحویل شیفت",
          reviewed_responsibility_revision: 1,
        });
        transferred = true;
        return HttpResponse.json({ ...source });
      },
    ),
  );
  setup();
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "me",
        operator_capabilities: [
          "review_source_proposals",
          "manage_operator_queues",
        ],
      }),
    ),
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "واگذاری یا آزادسازی مسئولیت" }),
  );
  await user.type(
    screen.getByLabelText("ایمیل اپراتور مقصد"),
    "next@example.com",
  );
  await user.type(screen.getByLabelText("دلیل تغییر مسئول"), "تحویل شیفت");
  await user.click(
    screen.getByRole("button", { name: "واگذاری مسئولیت منبع" }),
  );
  expect(await screen.findByText("next@example.com")).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "صف بررسی منابع" })).toBeVisible();
});

test.each([
  "/operator/source-proposals?filter=mine",
  "/operator/source-proposals/source-a#responsibility",
])("responsible operator releases a case from %s", async (path) => {
  let released = false;
  const caseData = () => ({
    ...source,
    responsibility: {
      operator: released ? null : "me",
      operator_label: released ? null : "me@example.com",
      revision: released ? 2 : 1,
      history: [],
    },
  });
  server.use(
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([caseData()]),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/:id/responsibility/",
      async ({ request }) => {
        expect(await request.json()).toEqual({
          assignee_email: null,
          reason: "پایان شیفت",
          reviewed_responsibility_revision: 1,
        });
        released = true;
        return HttpResponse.json(caseData());
      },
    ),
  );
  setup(path);
  const user = userEvent.setup();
  if (path.includes("filter=mine")) {
    await user.click(
      await screen.findByRole("button", { name: "آزادسازی مسئولیت" }),
    );
  }
  const release = await screen.findByRole("button", {
    name: "آزادسازی مسئولیت منبع",
  });
  expect(release).toBeDisabled();
  expect(screen.queryByLabelText("ایمیل اپراتور مقصد")).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("دلیل تغییر مسئول"), "پایان شیفت");
  await user.click(release);
  if (path.includes("filter=mine")) {
    await user.click(screen.getByRole("button", { name: /^آماده پذیرش/ }));
    expect(
      await screen.findByRole("button", { name: "پذیرش مسئولیت و شروع کار" }),
    ).toBeVisible();
  } else {
    expect(await screen.findByText("مسئول تعیین نشده است")).toBeVisible();
  }
  expect(released).toBe(true);
});

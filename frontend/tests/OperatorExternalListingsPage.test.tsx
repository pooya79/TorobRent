import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { expect, test } from "vitest";
import { OperatorExternalListingsPage } from "@/pages/OperatorExternalListingsPage";
import { OperatorSourceProposalDetailPage } from "@/pages/OperatorSourceProposalDetailPage";
import { server } from "./server";

const property = {
  id: "property",
  source_proposal_id: "source",
  extraction_run: "run",
  is_current: true,
  title: "آپارتمان نورگیر",
  source: { display_name: "خانه آبی", domain: "blue.example" },
  state: "pending",
  area_sqm: null as number | null,
  property_type: "apartment",
  deposit_rial: 0,
  monthly_rent_rial: 1000000,
  external_url: "https://blue.example/property",
  revision: 1,
  media: [],
  history: [],
  validation_errors: { area_sqm: ["متراژ ثبت نشده"] } as Record<
    string,
    string[]
  >,
};
function setup(path: string, overrides = {}) {
  let candidate = { ...property, ...overrides };
  const decisions: unknown[] = [];
  server.use(
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "me",
        operator_capabilities: ["review_source_proposals"],
      }),
    ),
    http.get("*/api/v1/operator/source-proposals/", () =>
      HttpResponse.json([
        {
          id: "source",
          website_name: "خانه آبی",
          website_url: "https://blue.example",
          state: "approved",
          discovery_stage: "complete",
          revision: 1,
          history: [],
          profile_versions: [],
          submitter: { id: "submitter" },
          responsibility: { operator: "me", history: [] },
          assignment: {
            state: "active",
            review_operator: "me",
            source: { processing_paused: false },
            recent_requests: [],
            exceptions: [],
            exclusions: [],
          },
          properties: [candidate],
        },
      ]),
    ),
    http.post("*/api/v1/operator/external-listing-candidates/:id/claim/", () =>
      HttpResponse.json({ revision: 1 }, { status: 201 }),
    ),
    http.post(
      "*/api/v1/operator/external-listing-candidates/:id/approve/",
      async ({ request }) => {
        decisions.push(await request.json());
        candidate = { ...candidate, state: "published" };
        return HttpResponse.json(candidate);
      },
    ),
  );
  function Location() {
    const location = useLocation();
    return (
      <output data-testid="location">
        {location.pathname}
        {location.search}
        {location.hash}
      </output>
    );
  }
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <Location />
        <Routes>
          <Route
            path="/operator/external-listings"
            element={<OperatorExternalListingsPage />}
          />
          <Route
            path="/operator/source-proposals/:proposalId"
            element={<OperatorSourceProposalDetailPage />}
          />
          <Route
            path="/operator/source-proposals"
            element={<p>قائمة منابع</p>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return decisions;
}

test("redirects a bookmarked property into its source review dialog", async () => {
  setup("/operator/external-listings?candidate=property");
  expect(await screen.findByRole("dialog")).toBeVisible();
  expect(screen.getByTestId("location")).toHaveTextContent(
    "/operator/source-proposals/source?candidate=property#exceptions",
  );
  expect(
    within(screen.getByRole("dialog")).getByText("متراژ: متراژ ثبت نشده"),
  ).toBeVisible();
});

test("redirects the retired queue and source-scoped links", async () => {
  setup("/operator/external-listings?proposal=source");
  expect(await screen.findByRole("link", { name: "بررسی آگهی" })).toBeVisible();
  expect(screen.getByTestId("location")).toHaveTextContent(
    "/operator/source-proposals/source#exceptions",
  );
});

test("publishes a valid extracted property without editing it", async () => {
  const user = userEvent.setup();
  const decisions = setup("/operator/source-proposals/source#exceptions", {
    area_sqm: 95,
    validation_errors: {},
  });
  await user.click(await screen.findByRole("link", { name: "بررسی آگهی" }));
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(
    dialog.queryByRole("button", { name: /درخواست اصلاح/ }),
  ).not.toBeInTheDocument();
  await user.click(dialog.getByLabelText("تأیید انتشار آپارتمان نورگیر"));
  await user.click(
    dialog.getByRole("button", { name: "تأیید و انتشار آپارتمان نورگیر" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(decisions).toEqual([{ reviewed_revision: 1, confirmed: true }]);
  expect(await screen.findByRole("link", { name: "مشاهده ملک" })).toBeVisible();
});

test.each([
  { state: "published" },
  { is_current: false },
  { state: "rejected" },
])("keeps closed or inactive properties read-only: %j", async (overrides) => {
  setup(
    "/operator/source-proposals/source?candidate=property#exceptions",
    overrides,
  );
  const dialog = within(await screen.findByRole("dialog"));
  expect(
    dialog.queryByRole("button", { name: "شروع بررسی آپارتمان نورگیر" }),
  ).not.toBeInTheDocument();
  expect(
    dialog.queryByRole("button", { name: "تأیید و انتشار آپارتمان نورگیر" }),
  ).not.toBeInTheDocument();
});

test("explains a missing old property instead of silently opening an empty queue", async () => {
  setup("/operator/external-listings?candidate=missing");
  expect(
    await screen.findByText(/این ملک دیگر در نتایج موجود نیست/),
  ).toBeVisible();
});

test("invalid extracted data can be rejected but cannot be edited or approved", async () => {
  const user = userEvent.setup();
  let rejection: unknown;
  server.use(
    http.post(
      "*/api/v1/operator/external-listing-candidates/:id/reject/",
      async ({ request }) => {
        rejection = await request.json();
        return HttpResponse.json({ ...property, state: "rejected" });
      },
    ),
  );
  setup("/operator/source-proposals/source?candidate=property#exceptions");
  const dialog = within(await screen.findByRole("dialog"));
  expect(dialog.queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(
    dialog.queryByText("اصلاح مشخصات و تصاویر این ملک"),
  ).not.toBeInTheDocument();
  await user.click(dialog.getByLabelText("تأیید انتشار آپارتمان نورگیر"));
  expect(
    dialog.getByRole("button", { name: "تأیید و انتشار آپارتمان نورگیر" }),
  ).toBeDisabled();
  await user.type(
    dialog.getByLabelText("دلیل رد آپارتمان نورگیر"),
    "اطلاعات نادرست",
  );
  await user.click(dialog.getByRole("button", { name: "رد آپارتمان نورگیر" }));
  await waitFor(() =>
    expect(rejection).toEqual({
      reviewed_revision: 1,
      reason: "اطلاعات نادرست",
    }),
  );
});

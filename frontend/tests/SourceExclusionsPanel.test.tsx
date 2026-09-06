import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, test, vi } from "vitest";
import {
  SourceExclusionsPanel,
  SourceExclusionsSummary,
} from "@/features/source-proposals/SourceExclusionsPanel";
import { server } from "./server";

function renderPanel() {
  const onUpdate = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SourceExclusionsPanel
        proposalId="case"
        exclusions={[]}
        onUpdate={onUpdate}
      />
    </QueryClientProvider>,
  );
  return onUpdate;
}

test("previews known examples before requiring a reason and confirmation", async () => {
  const user = userEvent.setup();
  let saved: unknown;
  server.use(
    http.post(
      "*/api/v1/operator/source-proposals/case/exclusions/preview/",
      () =>
        HttpResponse.json({
          kind: "path_prefix",
          url: "https://khaneh.example/archive",
          known_pages: [],
          published_listings: [],
          known_page_count: 0,
          published_listing_count: 0,
        }),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/case/exclusions/add/",
      async ({ request }) => {
        saved = await request.json();
        return HttpResponse.json({ id: "case" });
      },
    ),
  );
  const update = renderPanel();
  await user.selectOptions(screen.getByLabelText("نوع محدودیت"), "path_prefix");
  await user.type(
    screen.getByLabelText("نشانی محدودیت"),
    "https://khaneh.example/archive",
  );
  await user.click(screen.getByRole("button", { name: "پیش‌نمایش محدودیت" }));
  expect(
    await screen.findByText(
      "هیچ صفحه شناخته‌شده‌ای مطابق نیست؛ این پیش‌نمایش کشف کامل وب‌سایت نیست.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "ثبت محدودیت" })).toBeDisabled();
  await user.type(
    screen.getByLabelText("دلیل تصمیم"),
    "صفحات آرشیو پشتیبانی نمی‌شود",
  );
  await user.click(
    screen.getByLabelText(
      "اعمال محدودیت را تأیید می‌کنم؛ آگهی‌های منتشرشده باقی می‌ماند",
    ),
  );
  await user.click(screen.getByRole("button", { name: "ثبت محدودیت" }));
  await waitFor(() => expect(update).toHaveBeenCalled());
  expect(saved).toEqual({
    kind: "path_prefix",
    url: "https://khaneh.example/archive",
    reason: "صفحات آرشیو پشتیبانی نمی‌شود",
    confirmed: true,
  });
});

const rule = {
  id: "rule",
  kind: "path_prefix" as const,
  url: "https://khaneh.example/archive",
  reason: "آرشیو قدیمی",
  active: true,
  created_at: "2026-09-06T10:00:00Z",
  actions: [],
};

test("withdraws only previewed Listings with a separate reason and confirmation", async () => {
  const user = userEvent.setup();
  let body: unknown;
  server.use(
    http.post(
      "*/api/v1/operator/source-proposals/case/exclusions/preview/",
      () =>
        HttpResponse.json({
          kind: rule.kind,
          url: rule.url,
          known_pages: [rule.url + "/one"],
          known_page_count: 1,
          published_listings: [{ id: "listing-one", url: rule.url + "/one" }],
          published_listing_count: 1,
        }),
    ),
    http.post(
      "*/api/v1/operator/source-proposals/case/exclusions/withdraw/",
      async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "case" });
      },
    ),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SourceExclusionsPanel
        proposalId="case"
        exclusions={[rule]}
        onUpdate={() => {}}
      />
    </QueryClientProvider>,
  );
  await user.click(
    screen.getByRole("button", { name: "پیش‌نمایش خروج آگهی‌ها" }),
  );
  const withdraw = await screen.findByRole("button", {
    name: "خروج آگهی‌های نمایش‌داده‌شده",
  });
  expect(withdraw).toBeDisabled();
  expect(screen.getByText("آگهی‌های منتشرشده مطابق: ۱")).toBeVisible();
  await user.type(screen.getByLabelText("دلیل تصمیم"), "خروج آرشیو");
  await user.click(
    screen.getByLabelText(
      "خروج آگهی‌های نمایش‌داده‌شده از انتشار را تأیید می‌کنم",
    ),
  );
  await user.click(withdraw);
  await waitFor(() =>
    expect(body).toEqual({
      exclusion_id: "rule",
      listing_ids: ["listing-one"],
      reason: "خروج آرشیو",
      confirmed: true,
    }),
  );
});

test("removes a restriction explicitly and explains that held candidates stay unpublished", async () => {
  const user = userEvent.setup();
  let body: unknown;
  server.use(
    http.post(
      "*/api/v1/operator/source-proposals/case/exclusions/remove/",
      async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "case" });
      },
    ),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SourceExclusionsPanel
        proposalId="case"
        exclusions={[rule]}
        onUpdate={() => {}}
      />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "حذف این محدودیت" }));
  expect(
    screen.getByRole("button", { name: "ثبت حذف محدودیت" }),
  ).toBeDisabled();
  await user.type(screen.getByLabelText("دلیل تصمیم"), "پشتیبانی تازه");
  await user.click(
    screen.getByLabelText(
      "حذف محدودیت را تأیید می‌کنم؛ نتایج قبلی خودکار منتشر نمی‌شود",
    ),
  );
  await user.click(screen.getByRole("button", { name: "ثبت حذف محدودیت" }));
  await waitFor(() =>
    expect(body).toEqual({
      exclusion_id: "rule",
      reason: "پشتیبانی تازه",
      confirmed: true,
    }),
  );
});

test("invalidates the preview after changing the rule and displays server denial", async () => {
  const user = userEvent.setup();
  server.use(
    http.post(
      "*/api/v1/operator/source-proposals/case/exclusions/preview/",
      () =>
        HttpResponse.json({
          kind: "exact",
          url: rule.url,
          known_pages: [],
          published_listings: [],
          known_page_count: 0,
          published_listing_count: 0,
        }),
    ),
  );
  renderPanel();
  await user.type(screen.getByLabelText("نشانی محدودیت"), rule.url);
  await user.click(screen.getByRole("button", { name: "پیش‌نمایش محدودیت" }));
  await screen.findByRole("button", { name: "ثبت محدودیت" });
  await user.type(screen.getByLabelText("نشانی محدودیت"), "-old");
  expect(
    screen.queryByRole("button", { name: "ثبت محدودیت" }),
  ).not.toBeInTheDocument();
  server.use(
    http.post(
      "*/api/v1/operator/source-proposals/case/exclusions/preview/",
      () =>
        HttpResponse.json(
          { detail: "مسئول منبع تغییر کرده است" },
          { status: 400 },
        ),
    ),
  );
  await user.click(screen.getByRole("button", { name: "پیش‌نمایش محدودیت" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "مسئول منبع تغییر کرده است",
  );
});

test("shows the representative retained restrictions and removal reasons without decision controls", () => {
  render(
    <SourceExclusionsSummary
      exclusions={[
        rule,
        {
          ...rule,
          id: "removed",
          active: false,
          actions: [
            {
              id: 1,
              action: "remove",
              reason: "پشتیبانی تازه",
              listing_ids: [],
              created_at: rule.created_at,
            },
          ],
        },
      ]}
    />,
  );
  expect(screen.getByText("محدودیت فعال · بخش مسیر")).toBeVisible();
  expect(screen.getByText("محدودیت حذف‌شده · بخش مسیر")).toBeVisible();
  expect(screen.getByText("حذف محدودیت: پشتیبانی تازه")).toBeVisible();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

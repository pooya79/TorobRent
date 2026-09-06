import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { expect, test } from "vitest";
import { SourceBulkActions } from "@/features/source-proposals/SourceBulkActions";
import { server } from "./server";

const pages = ["one", "two", "three"].map((id) => ({
  id,
  canonical_url: `https://khaneh.example/${id}`,
  state: "open",
  problem: "candidate_checks",
  detail: "نیازمند بررسی",
  first_occurrence: null,
  last_run: "run",
  last_attempt: 1,
  last_attempt_at: "2026-09-06T11:00:00Z",
  history: [],
  exclusion_reason: "",
}));

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SourceBulkActions proposalId="case" pages={pages} />
    </QueryClientProvider>,
  );
}

test("previews mixed eligibility and requires confirmation before publication", async () => {
  const user = userEvent.setup();
  let applied: unknown;
  let selected: unknown;
  server.use(
    http.post("*/exceptions/bulk/preview/", async ({ request }) => {
      selected = await request.json();
      return HttpResponse.json({
        token: "preview",
        source_id: "source",
        items: pages.map((page, i) => ({
          id: page.id,
          url: page.canonical_url,
          status: i === 0 ? "eligible" : i === 1 ? "blocked" : "obsolete",
          detail: i === 0 ? "آماده انتشار" : "نیازمند بررسی",
          candidate_id: page.id,
          action_eligible: i === 0,
          published_listing_count: 0,
        })),
      });
    }),
    http.post("*/exceptions/bulk/apply/", async ({ request }) => {
      applied = await request.json();
      return HttpResponse.json({ affected: 1 });
    }),
  );
  mount();
  await user.click(screen.getByRole("button", { name: /انتخاب گروه/ }));
  await user.click(screen.getByRole("button", { name: "پیش‌نمایش انتخاب" }));
  expect(await screen.findByText("آماده انتشار")).toBeVisible();
  expect(selected).toEqual({
    exception_ids: ["one", "two", "three"],
    action: "publish",
    reason: "",
  });
  expect(applied).toBeUndefined();
  expect(
    screen.getByRole("button", { name: "اجرای اقدام گروهی" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /دامنه انتخاب/ }));
  await user.click(screen.getByRole("button", { name: "اجرای اقدام گروهی" }));
  await waitFor(() =>
    expect(applied).toEqual({ token: "preview", confirmed: true }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("۱ مورد");
});

test("exclusion preview shows published impact and resets when selection changes", async () => {
  const user = userEvent.setup();
  server.use(
    http.post("*/exceptions/bulk/preview/", () =>
      HttpResponse.json({
        token: "exclusion",
        source_id: "source",
        items: [
          {
            id: "one",
            url: pages[0]!.canonical_url,
            status: "excluded",
            detail: "محدودیت",
            candidate_id: "one",
            action_eligible: true,
            published_listing_count: 2,
          },
        ],
      }),
    ),
  );
  mount();
  await user.click(screen.getByRole("button", { name: /انتخاب گروه/ }));
  await user.selectOptions(screen.getByRole("combobox"), "exclude");
  expect(
    screen.getByRole("button", { name: "پیش‌نمایش انتخاب" }),
  ).toBeDisabled();
  await user.type(
    screen.getByRole("textbox", { name: "دلیل محدودیت" }),
    "خارج از محدوده",
  );
  await user.click(screen.getByRole("button", { name: "پیش‌نمایش انتخاب" }));
  expect(await screen.findByText("آگهی منتشرشده مرتبط: ۲")).toBeVisible();
  expect(screen.getByText(/آگهی‌های منتشرشده برداشته نمی‌شوند/)).toBeVisible();
  await user.click(
    screen.getByRole("checkbox", { name: pages[0]!.canonical_url }),
  );
  expect(
    screen.queryByRole("button", { name: "اجرای اقدام گروهی" }),
  ).not.toBeInTheDocument();
});

test("requests representative action only after choosing, previewing and confirming it", async () => {
  const user = userEvent.setup();
  let applied = false;
  server.use(
    http.post("*/exceptions/bulk/preview/", async ({ request }) => {
      expect(await request.json()).toEqual({
        exception_ids: ["one"],
        action: "request_action",
        reason: "بررسی متراژ",
      });
      return HttpResponse.json({
        token: "message",
        source_id: "source",
        items: [
          {
            id: "one",
            url: pages[0]!.canonical_url,
            status: "blocked",
            detail: "خطای استخراج",
            candidate_id: null,
            action_eligible: true,
            published_listing_count: 0,
          },
        ],
      });
    }),
    http.post("*/exceptions/bulk/apply/", () => {
      applied = true;
      return HttpResponse.json({ affected: 1 });
    }),
  );
  mount();
  await user.click(
    screen.getByRole("checkbox", { name: pages[0]!.canonical_url }),
  );
  await user.selectOptions(screen.getByRole("combobox"), "request_action");
  await user.type(screen.getByRole("textbox"), "بررسی متراژ");
  await user.click(screen.getByRole("button", { name: "پیش‌نمایش انتخاب" }));
  expect(await screen.findByText("پیام ارسالی: بررسی متراژ")).toBeVisible();
  expect(applied).toBe(false);
  await user.click(screen.getByRole("checkbox", { name: /دامنه انتخاب/ }));
  await user.click(screen.getByRole("button", { name: "اجرای اقدام گروهی" }));
  await waitFor(() => expect(applied).toBe(true));
});

test("discards a stale preview and refreshes outcomes before another attempt", async () => {
  const user = userEvent.setup();
  server.use(
    http.post("*/exceptions/bulk/preview/", () =>
      HttpResponse.json({
        token: "stale",
        source_id: "source",
        items: [
          {
            id: "one",
            url: pages[0]!.canonical_url,
            status: "eligible",
            detail: "آماده",
            candidate_id: "one",
            action_eligible: true,
            published_listing_count: 0,
          },
        ],
      }),
    ),
    http.post("*/exceptions/bulk/apply/", () =>
      HttpResponse.json({ detail: "نتایج تغییر کرده است" }, { status: 409 }),
    ),
  );
  mount();
  await user.click(
    screen.getByRole("checkbox", { name: pages[0]!.canonical_url }),
  );
  await user.click(screen.getByRole("button", { name: "پیش‌نمایش انتخاب" }));
  await user.click(
    await screen.findByRole("checkbox", { name: /دامنه انتخاب/ }),
  );
  await user.click(screen.getByRole("button", { name: "اجرای اقدام گروهی" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "نتایج تغییر کرده است",
  );
  expect(
    screen.queryByRole("button", { name: "اجرای اقدام گروهی" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "پیش‌نمایش انتخاب" }),
  ).toBeEnabled();
});

test("corrects a valid current candidate directly from its group without recent history", async () => {
  const user = userEvent.setup();
  let correction: unknown;
  const candidate = {
    id: "one",
    revision: 1,
    title: "آپارتمان منبع",
    state: "pending",
    superseded: false,
    area_sqm: 85,
    room_count: 2,
    deposit_rial: 100000000,
    monthly_rent_rial: 1000000,
    property_type: "apartment",
    evidence: { floor_area_sqm: [{ evidence_snippet: "متراژ اولیه ۸۵" }] },
    validation_errors: {},
    media: [],
    conflicts: {},
    corrections: {},
    extraction_run: "old-run",
  };
  server.use(
    http.post("*/exceptions/bulk/preview/", () =>
      HttpResponse.json({
        token: "valid",
        source_id: "source",
        items: [
          {
            id: "one",
            url: pages[0]!.canonical_url,
            status: "eligible",
            detail: "آماده",
            candidate_id: "one",
            candidate,
            action_eligible: true,
            published_listing_count: 0,
          },
        ],
      }),
    ),
    http.post(
      "*/external-listing-candidates/one/claim/",
      async ({ request }) => {
        expect(await request.json()).toEqual({ for_correction: true });
        return HttpResponse.json({});
      },
    ),
    http.post(
      "*/external-listing-candidates/one/correct/",
      async ({ request }) => {
        correction = await request.json();
        return HttpResponse.json({ ...candidate, area_sqm: 120, revision: 2 });
      },
    ),
  );
  mount();
  await user.click(
    screen.getByRole("checkbox", { name: pages[0]!.canonical_url }),
  );
  await user.click(screen.getByRole("button", { name: "پیش‌نمایش انتخاب" }));
  await user.click(await screen.findByText("جزئیات و اصلاح همین آگهی"));
  await user.click(screen.getByText("شواهد و اعتبارسنجی"));
  expect(screen.getByText("متراژ اولیه ۸۵")).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "شروع اصلاح همین آگهی" }),
  );
  const area = await screen.findByRole("spinbutton", {
    name: "متراژ (متر مربع)",
  });
  await user.clear(area);
  await user.type(area, "120");
  await user.type(
    screen.getByRole("textbox", { name: "دلیل اصلاح" }),
    "بررسی با منبع",
  );
  await user.click(screen.getByRole("button", { name: "ذخیره اصلاح آگهی" }));
  await waitFor(() =>
    expect(correction).toEqual({
      reviewed_revision: 1,
      reason: "بررسی با منبع",
      values: { area_sqm: 120 },
    }),
  );
  expect(
    screen.queryByRole("button", { name: "اجرای اقدام گروهی" }),
  ).not.toBeInTheDocument();
});

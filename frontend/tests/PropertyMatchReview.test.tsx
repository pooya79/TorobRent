import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { CatalogCurationPage } from "@/pages/CatalogCurationPage";
import { expect, test, vi } from "vitest";

import { PropertyMatchReview } from "@/features/catalog-curation/PropertyMatchReview";
import { server } from "./server";

const left = "11111111-1111-4111-8111-111111111111";
const right = "22222222-2222-4222-8222-222222222222";
const comparison = {
  revision: "review-one",
  claim: null,
  suggested_survivor_id: right,
  score: 0,
  band: "below_threshold" as const,
  scoring_version: "property-match-v2",
  is_calibrated_probability: false,
  signals: [],
  properties: [left, right].map((id) => ({
    id,
    normalized_facts: {},
    provenance_note: "",
    exact_location: { latitude: null, longitude: null, operator_notes: "" },
    listings: [],
  })),
  decision_fields: [
    {
      key: "area_sqm",
      label: "متراژ",
      values: { [left]: 90, [right]: 95 },
      display_values: { [left]: 90, [right]: 95 },
      conflicting: true,
    },
  ],
  property_images: [
    { id: "image-left", property_id: left, url: "/left.webp" },
    { id: "image-right", property_id: right, url: "/right.webp" },
  ],
};

test("searches for two Properties and completes the manual approval path", async () => {
  const user = userEvent.setup();
  let submitted: unknown;
  server.use(
    http.get("*/api/v1/operator/catalog-curation/properties/", () =>
      HttpResponse.json({
        count: 2,
        next: null,
        previous: null,
        results: [left, right].map((id) => ({
          id,
          title: "آپارتمان",
          property_type: "apartment",
          area_sqm: 90,
          room_count: 2,
          city: "تهران",
          neighborhood: "سعادت‌آباد",
          listings: [],
        })),
      }),
    ),
    http.get("*/api/v1/operator/catalog-curation/comparison/", () =>
      HttpResponse.json(comparison),
    ),
    http.post("*/api/v1/operator/catalog-curation/claim/", () =>
      HttpResponse.json({
        ...comparison,
        claim: {
          id: "claim-one",
          actor_id: "operator",
          expires_at: "2099-01-01T00:00:00Z",
        },
      }),
    ),
    http.post(
      "*/api/v1/operator/catalog-curation/approve/",
      async ({ request }) => {
        submitted = await request.json();
        return HttpResponse.json(
          { id: "decision-one", survivor_id: right },
          { status: 201 },
        );
      },
    ),
  );
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <CatalogCurationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "جست‌وجو" }));
  const choices = await screen.findAllByRole("button", {
    name: "انتخاب برای مقایسه",
  });
  await user.click(choices[0]!);
  await user.click(choices[1]!);
  await user.click(screen.getByRole("button", { name: "مقایسه دو ملک" }));
  await screen.findByRole("button", { name: "شروع بررسی" });
  expect(
    screen.getByRole("button", { name: "تأیید و گروه‌بندی" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "شروع بررسی" }));
  await screen.findByRole("button", { name: "تمدید بررسی" });
  expect(screen.getByLabelText("ملک باقی‌مانده")).toHaveValue(right);
  await user.click(screen.getByLabelText("ملک باقی‌مانده را تأیید می‌کنم"));
  await user.selectOptions(screen.getByLabelText("متراژ"), left);
  await user.click(screen.getByLabelText("انتخاب تصویر ۲"));
  await user.click(screen.getByLabelText("انتخاب تصاویر را تأیید می‌کنم"));
  expect(screen.getByRole("alert")).toHaveTextContent("شواهد ضعیف یا متعارض");
  expect(
    screen.getByRole("button", { name: "تأیید و گروه‌بندی" }),
  ).toBeDisabled();
  await user.click(
    screen.getByLabelText("با آگاهی از هشدار، گروه‌بندی را تأیید می‌کنم"),
  );
  await user.click(screen.getByRole("button", { name: "تأیید و گروه‌بندی" }));
  await screen.findByText("گروه‌بندی ثبت شد.");
  expect(submitted).toMatchObject({
    properties: [left, right],
    survivor_id: right,
    survivor_confirmed: true,
    fact_choices: { area_sqm: left },
    image_ids: ["image-right"],
    images_confirmed: true,
    warning_confirmed: true,
    claim_id: "claim-one",
    revision: "review-one",
  });
});

test("another Operator's claim stays read-only and offers refresh", async () => {
  const user = userEvent.setup();
  const refresh = vi.fn();
  server.use(
    http.post("*/api/v1/operator/catalog-curation/claim/", () =>
      HttpResponse.json({ detail: "claimed" }, { status: 409 }),
    ),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PropertyMatchReview
        comparison={{
          ...comparison,
          claim: {
            id: "other-claim",
            actor_id: "other",
            expires_at: "2099-01-01T00:00:00Z",
          },
        }}
        onRefresh={refresh}
      />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "شروع بررسی" }));
  expect(await screen.findByText(/بررسی در اختیار شما نیست/)).toBeVisible();
  expect(screen.getByLabelText("ملک باقی‌مانده")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "تأیید و گروه‌بندی" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "تازه‌سازی مقایسه" }));
  expect(refresh).toHaveBeenCalledOnce();
});

test("approves a scheduled suggestion with its review identity", async () => {
  const user = userEvent.setup();
  let claimBody: unknown;
  let approvalBody: unknown;
  const scheduledComparison = {
    ...comparison,
    band: "likely" as const,
    decision_fields: [],
    property_images: [],
  };
  server.use(
    http.post(
      "*/api/v1/operator/catalog-curation/claim/",
      async ({ request }) => {
        claimBody = await request.json();
        return HttpResponse.json({
          ...scheduledComparison,
          claim: {
            id: "claim-approval",
            actor_id: "operator",
            expires_at: "2099-01-01T00:00:00Z",
          },
        });
      },
    ),
    http.post(
      "*/api/v1/operator/catalog-curation/approve/",
      async ({ request }) => {
        approvalBody = await request.json();
        return HttpResponse.json(
          { id: "decision-approval", survivor_id: right },
          { status: 201 },
        );
      },
    ),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PropertyMatchReview
        comparison={scheduledComparison}
        suggestionId="suggestion-one"
        onRefresh={vi.fn()}
      />
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("button", { name: "شروع بررسی" }));
  await user.click(screen.getByLabelText("ملک باقی‌مانده را تأیید می‌کنم"));
  await user.click(screen.getByLabelText("انتخاب تصاویر را تأیید می‌کنم"));
  await user.click(screen.getByRole("button", { name: "تأیید و گروه‌بندی" }));

  expect(await screen.findByText("گروه‌بندی ثبت شد.")).toBeVisible();
  expect(claimBody).toMatchObject({ suggestion_id: "suggestion-one" });
  expect(approvalBody).toMatchObject({
    suggestion_id: "suggestion-one",
    claim_id: "claim-approval",
  });
});

test("snoozes a scheduled suggestion for a supported duration", async () => {
  const user = userEvent.setup();
  let submitted: unknown;
  server.use(
    http.post("*/api/v1/operator/catalog-curation/claim/", () =>
      HttpResponse.json({
        ...comparison,
        claim: {
          id: "claim-snooze",
          actor_id: "operator",
          expires_at: "2099-01-01T00:00:00Z",
        },
      }),
    ),
    http.post(
      "*/api/v1/operator/catalog-curation/suggestions/suggestion-one/snooze/",
      async ({ request }) => {
        submitted = await request.json();
        return HttpResponse.json(
          { id: "decision-snooze", outcome: "snoozed" },
          { status: 201 },
        );
      },
    ),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PropertyMatchReview
        comparison={comparison}
        suggestionId="suggestion-one"
        onRefresh={vi.fn()}
      />
    </QueryClientProvider>,
  );

  expect(screen.getByLabelText("مدت تعویق")).toHaveValue("7");
  await user.click(screen.getByRole("button", { name: "شروع بررسی" }));
  await user.selectOptions(screen.getByLabelText("مدت تعویق"), "30");
  await user.type(screen.getByLabelText("دلیل (اختیاری)"), "بررسی بعدی");
  await user.click(screen.getByRole("button", { name: "تعویق پیشنهاد" }));

  expect(await screen.findByText("پیشنهاد به تعویق افتاد.")).toBeVisible();
  expect(submitted).toEqual({
    revision: "review-one",
    claim_id: "claim-snooze",
    reason: "بررسی بعدی",
    days: 30,
  });
});

test("shows a stale-review conflict and requires a fresh claim", async () => {
  const user = userEvent.setup();
  server.use(
    http.post("*/api/v1/operator/catalog-curation/claim/", () =>
      HttpResponse.json({
        ...comparison,
        claim: {
          id: "claim-stale",
          actor_id: "operator",
          expires_at: "2099-01-01T00:00:00Z",
        },
      }),
    ),
    http.post(
      "*/api/v1/operator/catalog-curation/suggestions/suggestion-one/reject/",
      () => HttpResponse.json({ detail: "stale" }, { status: 409 }),
    ),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PropertyMatchReview
        comparison={comparison}
        suggestionId="suggestion-one"
        onRefresh={vi.fn()}
      />
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("button", { name: "شروع بررسی" }));
  await user.click(
    screen.getByRole("button", { name: "این دو ملک متفاوت‌اند" }),
  );

  expect(
    await screen.findByText(
      "شواهد یا مسئول بررسی تغییر کرده است. پیشنهاد را تازه کنید.",
    ),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "شروع بررسی" })).toBeVisible();
});

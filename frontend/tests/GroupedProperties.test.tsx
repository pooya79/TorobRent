import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { CatalogCurationPage } from "@/pages/CatalogCurationPage";
import { server } from "./server";

const propertyId = "11111111-1111-4111-8111-111111111111";
const listingA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const listingB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("browses grouped Properties and distinguishes contradictions from missing evidence", async () => {
  const user = userEvent.setup();
  const requestedPages: string[] = [];
  const summary = {
    id: propertyId,
    title: "آپارتمان در سعادت‌آباد",
    listing_count: 3,
    listing_states: ["archived", "published", "unavailable"],
    measurement_status: "measured",
    attention_status: "needs_attention",
    needs_attention: true,
    scoring_version: "property-match-v2",
    measured_at: "2026-09-13T08:00:00Z",
    last_grouping_change: "2026-09-12T08:00:00Z",
  };
  server.use(
    http.get(
      "*/api/v1/operator/catalog-curation/grouped-properties/",
      ({ request }) => {
        const requestedPage =
          new URL(request.url).searchParams.get("page") ?? "";
        requestedPages.push(requestedPage);
        return HttpResponse.json({
          count: 26,
          next:
            requestedPage === "1"
              ? "http://localhost/api/v1/operator/catalog-curation/grouped-properties/?page=2"
              : null,
          previous:
            requestedPage === "2"
              ? "http://localhost/api/v1/operator/catalog-curation/grouped-properties/"
              : null,
          results: [summary],
        });
      },
    ),
    http.get(
      `*/api/v1/operator/catalog-curation/grouped-properties/${propertyId}/`,
      () =>
        HttpResponse.json({
          ...summary,
          property: {
            id: propertyId,
            normalized_facts: { area_sqm: 90 },
            provenance_note: "بازبینی شده",
            exact_location: {
              latitude: "35.774100",
              longitude: "51.356200",
              operator_notes: "پلاک تطبیق داده شد",
            },
            listings: [
              {
                id: listingA,
                source: {
                  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                  name: "منبع الف",
                  domain: "a.example",
                },
                source_reference: "A-1",
                source_claims: {},
                provenance_note: "",
              },
              {
                id: listingB,
                source: {
                  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                  name: "منبع ب",
                  domain: "b.example",
                },
                source_reference: "B-1",
                source_claims: {},
                provenance_note: "",
              },
            ],
          },
          grouping_history: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              listing_id: listingB,
              from_property_id: "22222222-2222-4222-8222-222222222222",
              to_property_id: propertyId,
              action: "merge",
              reason: "تطبیق اپراتور",
              decision_id: "44444444-4444-4444-8444-444444444444",
              created_at: "2026-09-12T08:00:00Z",
            },
          ],
          approved_connections: [
            {
              decision_id: "44444444-4444-4444-8444-444444444444",
              left_property_id: "22222222-2222-4222-8222-222222222222",
              right_property_id: propertyId,
              created_at: "2026-09-12T08:00:00Z",
            },
          ],
          indirect_only_connections: [
            {
              listing_ids: [listingA, listingB],
              property_ids: [
                propertyId,
                "22222222-2222-4222-8222-222222222222",
              ],
            },
          ],
          measurement: {
            scoring_version: "property-match-v2",
            group_revision: "revision-one",
            listing_count: 3,
            pair_measurements: [
              {
                listing_ids: [listingA, listingB],
                status: "measured",
                score: 35,
                band: "below_threshold",
                signals: [],
                contradictions: [],
                reliable_contradictions: [
                  {
                    key: "area_sqm",
                    label: "متراژ",
                    compared_values: { left: 90, right: 180 },
                    classification: "contradiction",
                    contribution: -15,
                  },
                ],
              },
              {
                listing_ids: [listingA, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
                status: "missing_evidence",
                score: null,
                band: null,
                signals: [],
                contradictions: [],
                reliable_contradictions: [],
              },
            ],
            strongest_pair: {
              listing_ids: [listingA, listingB],
              status: "measured",
              score: 35,
              band: "below_threshold",
              signals: [],
              contradictions: [],
              reliable_contradictions: [],
            },
            weakest_pair: {
              listing_ids: [listingA, listingB],
              status: "measured",
              score: 35,
              band: "below_threshold",
              signals: [],
              contradictions: [],
              reliable_contradictions: [],
            },
            explicit_contradictions: [
              {
                listing_ids: [listingA, listingB],
                key: "area_sqm",
                label: "متراژ",
                compared_values: { left: 90, right: 180 },
                classification: "contradiction",
                contribution: -15,
              },
            ],
            needs_attention: true,
            measured_at: "2026-09-13T08:00:00Z",
          },
        }),
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

  expect(await screen.findByText("نیازمند توجه")).toBeVisible();
  expect(screen.getByText("۳ آگهی")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "بررسی سازگاری" }));
  expect(await screen.findByText("قوی‌ترین جفت سنجیده‌شده")).toBeVisible();
  expect(screen.getByText("ضعیف‌ترین جفت سنجیده‌شده")).toBeVisible();
  expect(screen.getByText("تناقض‌های صریح")).toBeVisible();
  expect(
    screen.getByText("دست‌کم یک تناقض قابل اتکا نیازمند توجه است."),
  ).toBeVisible();
  expect(screen.getByText("متراژ")).toBeVisible();
  expect(screen.getByText(/شواهد این جفت موجود نیست/)).toBeVisible();
  expect(screen.getByText("تطبیق اپراتور")).toBeVisible();
  expect(screen.getByText("۱ پیوند تأییدشده")).toBeVisible();
  expect(screen.getByText("۱ اتصال فقط غیرمستقیم")).toBeVisible();
  expect(screen.getByText("نسخه سنجش: property-match-v2")).toBeVisible();
  expect(screen.getByText("35.774100, 51.356200")).toBeVisible();
  expect(screen.getByText("منبع الف · A-1")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "بازگشت به گروه‌ها" }));
  await user.click(screen.getByRole("button", { name: "صفحه بعد گروه‌ها" }));
  expect(await screen.findByText("صفحه ۲")).toBeVisible();
  expect(requestedPages).toEqual(["1", "2"]);
});

test("shows a not-yet-measured group without raising a false alarm", async () => {
  const user = userEvent.setup();
  const summary = {
    id: propertyId,
    title: "گروه قدیمی",
    listing_count: 2,
    listing_states: ["published"],
    measurement_status: "stale",
    attention_status: "not_measured",
    needs_attention: false,
    scoring_version: "property-match-v1",
    measured_at: "2026-09-01T08:00:00Z",
    last_grouping_change: null,
  };
  server.use(
    http.get("*/api/v1/operator/catalog-curation/grouped-properties/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [summary],
      }),
    ),
    http.get(
      `*/api/v1/operator/catalog-curation/grouped-properties/${propertyId}/`,
      () =>
        HttpResponse.json({
          ...summary,
          property: {
            id: propertyId,
            normalized_facts: {},
            provenance_note: "",
            exact_location: {
              latitude: null,
              longitude: null,
              operator_notes: "",
            },
            listings: [],
          },
          grouping_history: [],
          approved_connections: [],
          indirect_only_connections: [],
          measurement: null,
        }),
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

  expect(await screen.findByText("هنوز سنجیده نشده")).toBeVisible();
  expect(screen.queryByText("نیازمند توجه")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "بررسی سازگاری" }));
  expect(await screen.findByText("سنجش جاری موجود نیست")).toBeVisible();
  expect(
    screen.getByText("این گروه هنوز با نسخه فعلی امتیازدهی سنجیده نشده است."),
  ).toBeVisible();
});

test("shows a low-weight contradiction without calling it reliable", async () => {
  const user = userEvent.setup();
  const summary = {
    id: propertyId,
    title: "گروه پایدار",
    listing_count: 2,
    listing_states: ["published"],
    measurement_status: "measured",
    attention_status: "stable",
    needs_attention: false,
    scoring_version: "property-match-v2",
    measured_at: "2026-09-13T08:00:00Z",
    last_grouping_change: null,
  };
  server.use(
    http.get("*/api/v1/operator/catalog-curation/grouped-properties/", () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [summary],
      }),
    ),
    http.get(
      `*/api/v1/operator/catalog-curation/grouped-properties/${propertyId}/`,
      () =>
        HttpResponse.json({
          ...summary,
          property: {
            id: propertyId,
            normalized_facts: {},
            provenance_note: "",
            exact_location: {
              latitude: null,
              longitude: null,
              operator_notes: "",
            },
            listings: [],
          },
          grouping_history: [],
          approved_connections: [],
          indirect_only_connections: [],
          measurement: {
            scoring_version: "property-match-v2",
            group_revision: "revision-low",
            listing_count: 2,
            pair_measurements: [],
            strongest_pair: null,
            weakest_pair: null,
            explicit_contradictions: [
              {
                listing_ids: [listingA, listingB],
                key: "features",
                label: "امکانات",
                compared_values: { left: "present", right: "absent" },
                classification: "contradiction",
                contribution: -5,
              },
            ],
            needs_attention: false,
            measured_at: "2026-09-13T08:00:00Z",
          },
        }),
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

  await user.click(
    await screen.findByRole("button", { name: "بررسی سازگاری" }),
  );
  expect(await screen.findByText("امکانات")).toBeVisible();
  expect(screen.getByText("هیچ تناقض قابل اتکایی ثبت نشده است.")).toBeVisible();
  expect(screen.queryByText("نیازمند توجه")).not.toBeInTheDocument();
});

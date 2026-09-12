import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { CatalogCurationPage } from "@/pages/CatalogCurationPage";
import { server } from "./server";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

test("browses the default Likely suggestion queue and opens current evidence", async () => {
  const user = userEvent.setup();
  const suggestion = {
    id: "33333333-3333-4333-8333-333333333333",
    property_ids: [firstId, secondId],
    properties: [
      {
        id: firstId,
        title: "آپارتمان اول",
        property_type: "apartment",
        area_sqm: 90,
        room_count: 2,
        city: "تهران",
        neighborhood: "سعادت‌آباد",
        listings: [],
      },
      {
        id: secondId,
        title: "آپارتمان دوم",
        property_type: "apartment",
        area_sqm: 92,
        room_count: 2,
        city: "تهران",
        neighborhood: "سعادت‌آباد",
        listings: [],
      },
    ],
    state: "pending",
    score: 92,
    band: "likely",
    scoring_version: "property-match-v2",
    evidence_summary: [
      { label: "فاصله مکان دقیق", classification: "support", contribution: 35 },
    ],
    claim: null,
    origin: "nightly",
    first_suggested_at: "2026-09-10T08:00:00Z",
    last_evaluated_at: "2026-09-12T01:30:00Z",
  };
  const comparison = {
    revision: "current-revision",
    claim: null,
    suggested_survivor_id: secondId,
    score: 92,
    band: "likely",
    scoring_version: "property-match-v2",
    is_calibrated_probability: false,
    signals: [
      {
        key: "exact_location",
        label: "فاصله مکان دقیق",
        compared_values: { distance_meters: 4 },
        classification: "support",
        contribution: 35,
      },
    ],
    properties: [firstId, secondId].map((id) => ({
      id,
      normalized_facts: {},
      provenance_note: "",
      exact_location: {
        latitude: "35.774100",
        longitude: "51.356200",
        operator_notes: "",
      },
      listings: [],
    })),
    decision_fields: [],
    property_images: [],
  };
  server.use(
    http.get(
      "*/api/v1/operator/catalog-curation/suggestions/",
      ({ request }) => {
        const params = new URL(request.url).searchParams;
        expect(params.get("band")).toBe("likely");
        expect(params.get("claim")).toBe("unclaimed");
        expect(params.get("ordering")).toBe("confidence");
        return HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [suggestion],
          filters: {
            band: "likely",
            claim: "unclaimed",
            ordering: "confidence",
          },
        });
      },
    ),
    http.get(
      `*/api/v1/operator/catalog-curation/suggestions/${suggestion.id}/`,
      () =>
        HttpResponse.json({
          ...suggestion,
          comparison,
        }),
    ),
    http.post(
      "*/api/v1/operator/catalog-curation/claim/",
      async ({ request }) => {
        expect(await request.json()).toMatchObject({
          suggestion_id: suggestion.id,
          revision: comparison.revision,
        });
        return HttpResponse.json({
          ...comparison,
          claim: {
            id: "44444444-4444-4444-8444-444444444444",
            actor_id: "55555555-5555-4555-8555-555555555555",
            expires_at: "2026-09-12T02:00:00Z",
          },
        });
      },
    ),
    http.post(
      `*/api/v1/operator/catalog-curation/suggestions/${suggestion.id}/reject/`,
      async ({ request }) => {
        expect(await request.json()).toEqual({
          revision: comparison.revision,
          claim_id: "44444444-4444-4444-8444-444444444444",
          reason: "",
        });
        return HttpResponse.json(
          {
            id: "66666666-6666-4666-8666-666666666666",
            outcome: "not_same_property",
          },
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

  expect(await screen.findByText("آپارتمان اول")).toBeVisible();
  expect(screen.getByText("۹۲ از ۱۰۰")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "مشاهده جزئیات" }));
  expect(
    await screen.findByRole("button", { name: "شروع بررسی" }),
  ).toBeVisible();
  expect(screen.getByText("فاصله مکان دقیق")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "شروع بررسی" }));
  await user.click(
    await screen.findByRole("button", { name: "این دو ملک متفاوت‌اند" }),
  );
  expect(await screen.findByText("تصمیم متفاوت بودن ثبت شد.")).toBeVisible();
});

test("searches, selects exactly two Properties, and explains Match Confidence", async () => {
  const user = userEvent.setup();
  const requestedPages: string[] = [];
  server.use(
    http.get(
      "*/api/v1/operator/catalog-curation/properties/",
      ({ request }) => {
        expect(new URL(request.url).searchParams.get("q")).toBe("REF-7");
        requestedPages.push(
          new URL(request.url).searchParams.get("page") ?? "",
        );
        return HttpResponse.json({
          count: 52,
          next: "http://localhost/api/v1/operator/catalog-curation/properties/?q=REF-7&page=2",
          previous: null,
          results: [
            {
              id: firstId,
              title: "آپارتمان در سعادت‌آباد",
              property_type: "apartment",
              area_sqm: 90,
              room_count: 2,
              city: "تهران",
              neighborhood: "سعادت‌آباد",
              listings: [
                {
                  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                  source: {
                    id: "aaaaaaaa-bbbb-4aaa-8aaa-aaaaaaaaaaaa",
                    name: "منبع یک",
                    domain: "one.example",
                  },
                  source_reference: "REF-7",
                },
              ],
            },
            {
              id: secondId,
              title: "آپارتمان در سعادت‌آباد",
              property_type: "apartment",
              area_sqm: 92,
              room_count: 2,
              city: "تهران",
              neighborhood: "سعادت‌آباد",
              listings: [],
            },
          ],
        });
      },
    ),
    http.get(
      "*/api/v1/operator/catalog-curation/comparison/",
      ({ request }) => {
        expect(new URL(request.url).searchParams.getAll("property")).toEqual([
          firstId,
          secondId,
        ]);
        return HttpResponse.json({
          scoring_version: "property-match-v2",
          score: 92,
          band: "likely",
          is_calibrated_probability: false,
          signals: [
            {
              key: "area_sqm",
              label: "متراژ",
              compared_values: { left: 90, right: 92 },
              classification: "support",
              contribution: 15,
            },
            {
              key: "images",
              label: "تصاویر آگهی",
              compared_values: {
                matched_pairs: [
                  {
                    left: {
                      image_id: "image-left-exact",
                      listing_id: "listing-left-1",
                      source: "نسخه یکسان یک",
                      thumbnail_url: null,
                    },
                    right: {
                      image_id: "image-right-exact",
                      listing_id: "listing-right-1",
                      source: "نسخه یکسان دو",
                      thumbnail_url: null,
                    },
                    method: "sha256",
                    perceptual_distance: null,
                    is_generic: false,
                  },
                  {
                    left: {
                      image_id: "image-left-reencoded",
                      listing_id: "listing-left-1",
                      source: "بازکدگذاری یک",
                      thumbnail_url: null,
                    },
                    right: {
                      image_id: "image-right-reencoded",
                      listing_id: "listing-right-1",
                      source: "بازکدگذاری دو",
                      thumbnail_url: null,
                    },
                    method: "normalized_pixels",
                    perceptual_distance: null,
                    is_generic: false,
                  },
                  {
                    left: {
                      image_id: "image-left-1",
                      listing_id: "listing-left-1",
                      source: "منبع یک",
                      thumbnail_url:
                        "/api/v1/catalog/media/33333333-3333-4333-8333-333333333333/",
                    },
                    right: {
                      image_id: "image-right-1",
                      listing_id: "listing-right-1",
                      source: "منبع دو",
                      thumbnail_url:
                        "/api/v1/catalog/media/44444444-4444-4444-8444-444444444444/",
                    },
                    method: "dhash",
                    perceptual_distance: 4,
                    is_generic: false,
                  },
                  {
                    left: {
                      image_id: "image-left-generic",
                      listing_id: "listing-left-1",
                      source: "تصویر عمومی یک",
                      thumbnail_url: null,
                    },
                    right: {
                      image_id: "image-right-generic",
                      listing_id: "listing-right-1",
                      source: "تصویر عمومی دو",
                      thumbnail_url: null,
                    },
                    method: "sha256",
                    perceptual_distance: null,
                    is_generic: true,
                  },
                ],
                contradictions: [
                  {
                    left: {
                      image_id: "image-left-2",
                      listing_id: "listing-left-1",
                      source: "منبع یک",
                      thumbnail_url: null,
                    },
                    right: {
                      image_id: "image-right-2",
                      listing_id: "listing-right-1",
                      source: "منبع دو",
                      thumbnail_url: null,
                    },
                    perceptual_distance: 31,
                  },
                ],
              },
              classification: "support",
              contribution: 25,
            },
          ],
          properties: [
            {
              id: firstId,
              normalized_facts: { area_sqm: 90, neighborhood: "سعادت‌آباد" },
              provenance_note: "بازبینی اپراتور",
              exact_location: {
                latitude: "35.774100",
                longitude: "51.356200",
                operator_notes: "پلاک تطبیق داده شد",
              },
              listings: [
                {
                  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                  source: {
                    id: "aaaaaaaa-bbbb-4aaa-8aaa-aaaaaaaaaaaa",
                    name: "منبع یک",
                    domain: "one.example",
                  },
                  source_reference: "REF-7",
                  source_claims: { address: "restricted source address" },
                  provenance_note: "صفحه منبع",
                },
              ],
            },
            {
              id: secondId,
              normalized_facts: { area_sqm: 92, neighborhood: "سعادت‌آباد" },
              provenance_note: "",
              exact_location: {
                latitude: "35.774120",
                longitude: "51.356180",
                operator_notes: "",
              },
              listings: [],
            },
          ],
        });
      },
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CatalogCurationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(screen.getByRole("link", { name: "پیشنهادها" })).toBeVisible();
  expect(
    screen.getByRole("link", { name: "ملک‌های گروه‌بندی‌شده" }),
  ).toBeVisible();
  expect(screen.getAllByText("به‌زودی")).toHaveLength(1);
  expect(
    screen.getByRole("heading", { name: "مقایسه دستی ملک‌ها" }),
  ).toBeVisible();

  await user.type(screen.getByRole("searchbox"), "REF-7");
  await user.click(screen.getByRole("button", { name: "جست‌وجو" }));
  await screen.findAllByRole("button", {
    name: "انتخاب برای مقایسه",
  });
  await user.click(screen.getByRole("button", { name: "صفحه بعد" }));
  await screen.findByText("صفحه ۲ · ۵۲ نتیجه");
  expect(requestedPages).toEqual(["1", "2"]);
  const selectButtons = screen.getAllByRole("button", {
    name: "انتخاب برای مقایسه",
  });
  await user.click(selectButtons[0]!);
  await user.click(selectButtons[1]!);
  await user.click(screen.getByRole("button", { name: "مقایسه دو ملک" }));

  expect(await screen.findByText("۹۲ از ۱۰۰")).toBeVisible();
  expect(screen.getByText("احتمال کالیبره‌شده نیست")).toBeVisible();
  expect(screen.getByText("نسخه امتیازدهی: property-match-v2")).toBeVisible();
  expect(screen.getByText("متراژ")).toBeVisible();
  expect(screen.getByText("+۱۵")).toBeVisible();
  expect(screen.getAllByText("SHA-256")).toHaveLength(2);
  expect(screen.getByText("Normalized pixels")).toBeVisible();
  expect(screen.getByText("dHash · فاصله ۴")).toBeVisible();
  expect(screen.getByText("تصویر عمومی؛ تقویت قاطع ندارد")).toBeVisible();
  expect(screen.getByText("ناسازگاری تصویری · فاصله ۳۱")).toBeVisible();
  expect(screen.getByAltText("تصویر منبع یک")).toBeVisible();
  expect(screen.getByAltText("تصویر منبع دو")).toBeVisible();
  expect(screen.getByText("+۲۵")).toBeVisible();
  expect(screen.getByText("35.774100, 51.356200")).toBeVisible();
  expect(screen.getAllByText("منبع یک · REF-7")).toHaveLength(2);
  expect(
    screen.getByText('{"address":"restricted source address"}'),
  ).toBeVisible();
});

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
          scoring_version: "property-match-v1",
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
  expect(screen.getAllByText("به‌زودی")).toHaveLength(2);
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
  expect(screen.getByText("نسخه امتیازدهی: property-match-v1")).toBeVisible();
  expect(screen.getByText("متراژ")).toBeVisible();
  expect(screen.getByText("+۱۵")).toBeVisible();
  expect(screen.getByText("35.774100, 51.356200")).toBeVisible();
  expect(screen.getAllByText("منبع یک · REF-7")).toHaveLength(2);
  expect(
    screen.getByText('{"address":"restricted source address"}'),
  ).toBeVisible();
});

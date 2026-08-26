import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { meta, ResultsPage } from "@/pages/ResultsPage";
import {
  officePropertySearchPage,
  propertySearchPage,
} from "./fixtures/catalog";
import { server } from "./server";

function renderResults(entry = "/search") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <ResultsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("presents each Property with normalized facts and freshest complete Rental Terms", async () => {
  let requestedLocation: string | null = null;
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      requestedLocation = new URL(request.url).searchParams.get("location");
      return HttpResponse.json(propertySearchPage);
    }),
  );

  renderResults("/search?location=سعادت‌آباد");

  expect(
    await screen.findByRole("heading", { name: "آپارتمان در سعادت‌آباد" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", {
      name: "ملک‌های اجاره‌ای در سعادت‌آباد",
      level: 1,
    }),
  ).toBeVisible();
  expect(requestedLocation).toBe("سعادت‌آباد");
  expect(screen.getByText("۲ آگهی فعال")).toBeVisible();
  expect(screen.getByText("۱۱۰ متر · ۲ خواب · ساخت ۱٬۴۰۰")).toBeVisible();
  expect(screen.getByText("ودیعه ۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان")).toBeVisible();
  expect(screen.getByText("اجاره ماهانه ۲۵٬۰۰۰٬۰۰۰ تومان")).toBeVisible();
});

test.each([
  ["office", "دفتر اداری", "دفترهای اداری اجاره‌ای"],
  ["shop", "مغازه", "مغازه‌های اجاره‌ای"],
  ["warehouse", "انبار", "انبارهای اجاره‌ای"],
  ["workshop", "کارگاه", "کارگاه‌های اجاره‌ای"],
] as const)(
  "presents a %s without residential wording or an absent room fact",
  async (propertyType, propertyTypeLabel, resultsHeading) => {
    const searchPage = {
      ...officePropertySearchPage,
      results: officePropertySearchPage.results.map((property) => ({
        ...property,
        title: `${propertyTypeLabel} در سعادت‌آباد`,
        property_type: propertyType,
        property_type_label: propertyTypeLabel,
      })),
    };
    server.use(
      http.get("*/api/v1/catalog/properties/", () =>
        HttpResponse.json(searchPage),
      ),
    );

    renderResults(`/search?property_type=${propertyType}`);

    expect(
      await screen.findByRole("heading", {
        name: `${propertyTypeLabel} در سعادت‌آباد`,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: `${resultsHeading} در تهران`,
        level: 1,
      }),
    ).toBeVisible();
    expect(screen.getByText("۱۱۰ متر · ساخت ۱٬۴۰۰")).toBeVisible();
    expect(screen.queryByText(/خواب/)).not.toBeInTheDocument();
  },
);

test("announces loading and explains when no Property matches", async () => {
  server.use(
    http.get("*/api/v1/catalog/properties/", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return HttpResponse.json({
        ...propertySearchPage,
        count: 0,
        results: [],
      });
    }),
  );

  renderResults();

  expect(screen.getByLabelText("در حال بارگذاری ملک‌ها")).toBeVisible();
  expect(
    await screen.findByRole("heading", { name: "ملکی در این محدوده پیدا نشد" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "جست‌وجوی دوباره" })).toBeVisible();
});

test("offers retry after a failure and distinguishes service unavailability", async () => {
  const user = userEvent.setup();
  let attempts = 0;
  server.use(
    http.get("*/api/v1/catalog/properties/", () => {
      attempts += 1;
      return attempts === 1
        ? HttpResponse.json({ detail: "failed" }, { status: 500 })
        : HttpResponse.json(propertySearchPage);
    }),
  );
  const firstRender = renderResults();

  expect(
    await screen.findByRole("heading", { name: "بارگذاری نتایج کامل نشد" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "تلاش دوباره" }));
  expect(
    await screen.findByRole("heading", { name: "آپارتمان در سعادت‌آباد" }),
  ).toBeVisible();

  firstRender.unmount();
  server.use(
    http.get("*/api/v1/catalog/properties/", () =>
      HttpResponse.json({ detail: "unavailable" }, { status: 503 }),
    ),
  );
  renderResults();
  expect(
    await screen.findByRole("heading", { name: "نتایج فعلاً در دسترس نیست" }),
  ).toBeVisible();
});

test("keeps location and page navigation shareable in the URL", async () => {
  server.use(
    http.get("*/api/v1/catalog/properties/", () =>
      HttpResponse.json({
        ...propertySearchPage,
        count: 26,
        next: "http://localhost/api/v1/catalog/properties/?location=تهران&page=2",
      }),
    ),
  );

  renderResults("/search?location=تهران");

  expect(await screen.findByText("۲۶ ملک پیدا شد")).toBeVisible();
  expect(screen.getByRole("link", { name: "صفحه بعد" })).toHaveAttribute(
    "href",
    "/search?location=%D8%AA%D9%87%D8%B1%D8%A7%D9%86&page=2",
  );
});

test("applies every filter with tolerant numeric entry and exposes removable chips", async () => {
  const user = userEvent.setup();
  let requestedParams = new URLSearchParams();
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      requestedParams = new URL(request.url).searchParams;
      return HttpResponse.json(propertySearchPage);
    }),
  );
  renderResults("/search?location=تهران&page=3");

  const filters = await screen.findByRole("complementary", {
    name: "فیلترهای جست‌وجو",
  });
  await user.type(within(filters).getByLabelText("حداقل ودیعه"), "۵۰۰٬۰۰۰٬۰۰۰");
  await user.type(within(filters).getByLabelText("تعداد اتاق"), "۲");
  await user.click(within(filters).getByRole("button", { name: "همه ملک‌ها" }));
  await user.click(within(filters).getByRole("checkbox", { name: "آپارتمان" }));
  await user.selectOptions(
    within(filters).getByLabelText("پارکینگ"),
    "present",
  );
  await user.click(
    within(filters).getByRole("button", { name: "اعمال فیلترها" }),
  );

  expect(requestedParams.get("deposit_min_toman")).toBe("500000000");
  expect(requestedParams.get("room_count")).toBe("2");
  expect(requestedParams.get("property_type")).toBe("apartment");
  expect(requestedParams.get("parking")).toBe("present");
  expect(requestedParams.has("page")).toBe(false);
  const parkingChip = await screen.findByRole("button", {
    name: /حذف فیلتر پارکینگ/,
  });
  expect(parkingChip).toBeVisible();
  await user.click(parkingChip);
  expect(requestedParams.has("parking")).toBe(false);
  expect(
    within(
      screen.getByRole("complementary", { name: "فیلترهای جست‌وجو" }),
    ).getByLabelText("پارکینگ"),
  ).toHaveValue("");
});

test("offers the same filter form in an accessible mobile drawer", async () => {
  const user = userEvent.setup();
  renderResults();

  await user.click(screen.getByRole("button", { name: "فیلترها" }));
  const drawer = await screen.findByRole("dialog");

  expect(
    within(drawer).getByRole("heading", { name: "فیلتر نتایج" }),
  ).toBeVisible();
  expect(within(drawer).getByLabelText("حداقل اجاره ماهانه")).toBeVisible();
  expect(within(drawer).getByLabelText("مبله")).toBeVisible();
});

test("preserves mixed Property Types through requests, filters, pagination, chips, and return navigation", async () => {
  const user = userEvent.setup();
  let requestedParams = new URLSearchParams();
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      requestedParams = new URL(request.url).searchParams;
      return HttpResponse.json({ ...propertySearchPage, count: 26 });
    }),
  );
  renderResults(
    "/search?property_type=apartment&property_type=office&parking=present",
  );

  const filters = await screen.findByRole("complementary", {
    name: "فیلترهای جست‌وجو",
  });
  expect(requestedParams.getAll("property_type")).toEqual([
    "apartment",
    "office",
  ]);
  expect(
    within(filters).getByRole("button", { name: "آپارتمان، دفتر اداری" }),
  ).toBeVisible();

  await user.type(within(filters).getByLabelText("حداکثر متراژ"), "۱۲۰");
  await user.click(
    within(filters).getByRole("button", { name: "اعمال فیلترها" }),
  );
  expect(requestedParams.getAll("property_type")).toEqual([
    "apartment",
    "office",
  ]);
  const nextPage = screen.getByRole("link", { name: "صفحه بعد" });
  expect(
    new URL(
      nextPage.getAttribute("href")!,
      "http://example.test",
    ).searchParams.getAll("property_type"),
  ).toEqual(["apartment", "office"]);
  expect(
    screen.getByRole("link", { name: "آپارتمان در سعادت‌آباد" }),
  ).toHaveAttribute("href", expect.stringContaining("property_type%3Doffice"));

  await user.click(screen.getByRole("button", { name: "حذف فیلتر نوع ملک" }));
  expect(requestedParams.has("property_type")).toBe(false);
  expect(requestedParams.get("parking")).toBe("present");
});

test("marks filtered result pages non-indexable and keeps return navigation on cards", async () => {
  renderResults("/search?location=تهران&parking=present");

  expect(
    meta({ location: { search: "?location=تهران&parking=present" } }),
  ).toContainEqual({ name: "robots", content: "noindex, follow" });
  expect(meta({ location: { search: "" } })).toContainEqual({
    title: "ملک‌های اجاره‌ای در تهران | ترب‌رنت",
  });
  expect(
    meta({ location: { search: "?property_type=office" } }),
  ).toContainEqual({
    title: "دفترهای اداری اجاره‌ای در تهران | ترب‌رنت",
  });
  expect(
    await screen.findByRole("link", { name: "آپارتمان در سعادت‌آباد" }),
  ).toHaveAttribute(
    "href",
    expect.stringContaining("returnTo=%2Fsearch%3Flocation%3D"),
  );
});

test("honors Persian digits in a shared filter URL and keeps controls synchronized", async () => {
  let requestedArea: string | null = null;
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      requestedArea = new URL(request.url).searchParams.get("area_max");
      return HttpResponse.json(propertySearchPage);
    }),
  );

  renderResults("/search?area_max=۱۰۰");

  const filters = await screen.findByRole("complementary", {
    name: "فیلترهای جست‌وجو",
  });
  expect(requestedArea).toBe("100");
  expect(within(filters).getByLabelText("حداکثر متراژ")).toHaveValue("۱۰۰");
});

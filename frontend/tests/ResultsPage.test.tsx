import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { expect, test } from "vitest";

import { meta, ResultsPage } from "@/pages/ResultsPage";
import { createFakeMapAdapter, type MapAdapter } from "@/features/map/adapter";
import {
  officePropertySearchPage,
  propertySearchPage,
} from "./fixtures/catalog";
import { server } from "./server";

function renderResults(
  entry: string | string[] = "/search",
  mapAdapter?: MapAdapter,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={Array.isArray(entry) ? entry : [entry]}
        initialIndex={Array.isArray(entry) ? entry.length - 1 : 0}
      >
        <ResultsPage mapAdapter={mapAdapter} />
        <SearchStateProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function SearchStateProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="وضعیت جست‌وجو">{location.search}</output>
      <button type="button" onClick={() => void navigate(-1)}>
        بازگشت آزمایشی
      </button>
    </>
  );
}

test("defaults to Tehran and Residential and scopes multiple Property Types to the category", async () => {
  const user = userEvent.setup();
  let requestedParams = new URLSearchParams();
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      requestedParams = new URL(request.url).searchParams;
      return HttpResponse.json(propertySearchPage);
    }),
  );

  renderResults();

  const toolbar = screen.getByRole("search", { name: "نوار جست‌وجوی ملک" });
  expect(within(toolbar).getByRole("combobox", { name: "شهر" })).toHaveValue(
    "تهران",
  );
  expect(
    within(toolbar).getByRole("button", { name: "مسکونی" }),
  ).toHaveAttribute("aria-pressed", "true");
  await screen.findByText("۱ ملک پیدا شد");
  expect(requestedParams.get("property_category")).toBe("residential");

  await user.click(within(toolbar).getByRole("button", { name: "همه نوع‌ها" }));
  expect(
    within(toolbar).getByRole("checkbox", { name: "آپارتمان" }),
  ).toBeVisible();
  expect(within(toolbar).getByRole("checkbox", { name: "خانه" })).toBeVisible();
  expect(
    within(toolbar).queryByRole("checkbox", { name: "دفتر اداری" }),
  ).toBeNull();

  await user.click(within(toolbar).getByRole("checkbox", { name: "آپارتمان" }));
  await user.click(within(toolbar).getByRole("checkbox", { name: "خانه" }));
  expect(requestedParams.getAll("property_type")).toEqual([
    "apartment",
    "house",
  ]);
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent(
    "property_type=apartment&property_type=house",
  );
});

test("switching Property Category clears incompatible state and preserves shared query parameters", async () => {
  const user = userEvent.setup();
  let requestedParams = new URLSearchParams();
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      requestedParams = new URL(request.url).searchParams;
      return HttpResponse.json(propertySearchPage);
    }),
  );
  renderResults(
    "/search?location=تهران&location_label=تهران&property_category=residential&property_type=apartment&room_count=2&area_min=60&parking=present&page=2",
  );

  const toolbar = screen.getByRole("search", { name: "نوار جست‌وجوی ملک" });
  await user.click(within(toolbar).getByRole("button", { name: "تجاری" }));

  expect(requestedParams.get("property_category")).toBe("commercial");
  expect(requestedParams.has("property_type")).toBe(false);
  expect(requestedParams.has("room_count")).toBe(false);
  expect(requestedParams.has("page")).toBe(false);
  expect(requestedParams.get("area_min")).toBe("60");
  expect(requestedParams.get("parking")).toBe("present");
  expect(requestedParams.get("location")).toBe("تهران");

  await user.click(within(toolbar).getByRole("button", { name: "همه نوع‌ها" }));
  expect(
    within(toolbar).getByRole("checkbox", { name: "دفتر اداری" }),
  ).toBeVisible();
  expect(
    within(toolbar).queryByRole("checkbox", { name: "آپارتمان" }),
  ).toBeNull();
});

test("finds every upcoming city as a disabled Coming soon option", async () => {
  const user = userEvent.setup();
  renderResults();

  const toolbar = screen.getByRole("search", { name: "نوار جست‌وجوی ملک" });
  const city = within(toolbar).getByRole("combobox", { name: "شهر" });
  for (const upcomingCity of ["مشهد", "اصفهان", "شیراز", "کرج", "تبریز"]) {
    await user.click(city);
    await user.clear(city);
    await user.type(city, upcomingCity);

    expect(
      await within(toolbar).findByRole("group", { name: "به‌زودی" }),
    ).toBeVisible();
    expect(
      within(toolbar).getByRole("option", {
        name: `${upcomingCity} — به‌زودی`,
      }),
    ).toHaveAttribute("aria-disabled", "true");
    await user.tab();
    expect(city).toHaveValue("تهران");
  }
});

test("restores category, Property Types, and city context from browser history", async () => {
  const user = userEvent.setup();
  renderResults([
    "/search?location=tehran-market&location_label=تهران&property_category=residential&property_type=apartment",
    "/search?location=temporary-market&location_label=تهران موقت&property_category=commercial&property_type=office",
  ]);

  const toolbar = screen.getByRole("search", { name: "نوار جست‌وجوی ملک" });
  expect(within(toolbar).getByRole("combobox", { name: "شهر" })).toHaveValue(
    "تهران موقت",
  );
  expect(
    within(toolbar).getByRole("button", { name: "تجاری" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    within(toolbar).getByRole("button", { name: "دفتر اداری" }),
  ).toBeVisible();

  await user.click(screen.getByRole("button", { name: "بازگشت آزمایشی" }));

  expect(within(toolbar).getByRole("combobox", { name: "شهر" })).toHaveValue(
    "تهران",
  );
  expect(
    within(toolbar).getByRole("button", { name: "مسکونی" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    within(toolbar).getByRole("button", { name: "آپارتمان" }),
  ).toBeVisible();
});

test("keeps Property discovery working when the map provider fails", async () => {
  const UnavailableMapAdapter = createFakeMapAdapter({
    failAttempts: Number.POSITIVE_INFINITY,
  });

  renderResults("/search", UnavailableMapAdapter);

  expect(
    await screen.findByRole("heading", { name: "آپارتمان در سعادت‌آباد" }),
  ).toBeVisible();
  expect(screen.getByText("نقشه موقتاً در دسترس نیست")).toBeVisible();
  expect(screen.getByRole("region", { name: "ملک‌های پیدا شده" })).toHaveClass(
    "xl:grid-cols-3",
  );
});

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

test("renders public approximate markers and uncertainty circles through the map adapter", async () => {
  server.use(
    http.get("*/api/v1/catalog/properties/", () =>
      HttpResponse.json(propertySearchPage),
    ),
  );

  renderResults("/search", createFakeMapAdapter());

  expect(
    await screen.findByRole("button", {
      name: "موقعیت تقریبی آپارتمان در سعادت‌آباد",
    }),
  ).toBeVisible();
  expect(screen.getByText("محدوده تقریبی ۵۰۰ متر")).toBeVisible();
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
  await user.click(within(filters).getByRole("button", { name: "همه نوع‌ها" }));
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

test("preserves compatible Property Types through requests, filters, pagination, chips, and return navigation", async () => {
  const user = userEvent.setup();
  let requestedParams = new URLSearchParams();
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      requestedParams = new URL(request.url).searchParams;
      return HttpResponse.json({ ...propertySearchPage, count: 26 });
    }),
  );
  renderResults(
    "/search?property_category=residential&property_type=apartment&property_type=house&parking=present",
  );

  const filters = await screen.findByRole("complementary", {
    name: "فیلترهای جست‌وجو",
  });
  expect(requestedParams.getAll("property_type")).toEqual([
    "apartment",
    "house",
  ]);
  expect(
    within(filters).getByRole("button", { name: "آپارتمان، خانه" }),
  ).toBeVisible();

  await user.type(within(filters).getByLabelText("حداکثر متراژ"), "۱۲۰");
  await user.click(
    within(filters).getByRole("button", { name: "اعمال فیلترها" }),
  );
  expect(requestedParams.getAll("property_type")).toEqual([
    "apartment",
    "house",
  ]);
  const nextPage = screen.getByRole("link", { name: "صفحه بعد" });
  expect(
    new URL(
      nextPage.getAttribute("href")!,
      "http://example.test",
    ).searchParams.getAll("property_type"),
  ).toEqual(["apartment", "house"]);
  expect(
    screen.getByRole("link", { name: "آپارتمان در سعادت‌آباد" }),
  ).toHaveAttribute("href", expect.stringContaining("property_type%3Dhouse"));

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

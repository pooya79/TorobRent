import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import {
  createMemoryRouter,
  MemoryRouter,
  Outlet,
  RouterProvider,
  ScrollRestoration,
  useLocation,
  useNavigate,
} from "react-router";
import { expect, test, vi } from "vitest";

import { meta, ResultsPage } from "@/pages/ResultsPage";
import { ProductShell } from "@/app/ProductShell";
import { ThemeProvider } from "@/app/ThemeProvider";
import { createFakeMapAdapter, type MapAdapter } from "@/features/map/adapter";
import { RenterAccessProvider } from "@/features/session/RenterAccessDialog";
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
        <RenterAccessProvider>
          <ResultsPage mapAdapter={mapAdapter} />
          <SearchStateProbe />
        </RenterAccessProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test("operates an authenticated Favorite independently and optimistically", async () => {
  const user = userEvent.setup();
  let saveRequests = 0;
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "favorite-token" }),
    ),
    http.put("*/api/v1/catalog/properties/:propertyId/favorite/", async () => {
      saveRequests += 1;
      await delay(100);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  renderResults();

  const propertyLink = await screen.findByRole("link", {
    name: "آپارتمان در سعادت‌آباد",
  });
  const favorite = screen.getByRole("button", {
    name: "ذخیره آپارتمان در سعادت‌آباد در علاقه‌مندی‌ها",
  });
  expect(favorite).toHaveAttribute("aria-pressed", "false");
  expect(propertyLink).not.toContainElement(favorite);

  await user.click(favorite);

  expect(favorite).toHaveAttribute("aria-pressed", "true");
  expect(favorite).toHaveAccessibleName(
    "حذف آپارتمان در سعادت‌آباد از علاقه‌مندی‌ها",
  );
  await waitFor(() => expect(saveRequests).toBe(1));
  expect(screen.queryByText(/ذخیره شد/)).toBeNull();
});

test("keeps another successful optimistic Favorite when one mutation fails", async () => {
  const user = userEvent.setup();
  const firstProperty = propertySearchPage.results[0]!;
  const secondProperty = {
    ...firstProperty,
    id: "20000000-0000-4000-8000-000000000059",
    title: "خانه در سعادت‌آباد",
    canonical_slug: "خانه-در-سعادتآباد",
  };
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "favorite-token" }),
    ),
    http.get("*/api/v1/catalog/properties/", () =>
      HttpResponse.json({
        ...propertySearchPage,
        count: 2,
        results: [firstProperty, secondProperty],
      }),
    ),
    http.put(
      "*/api/v1/catalog/properties/:propertyId/favorite/",
      async ({ params }) => {
        if (params.propertyId === firstProperty.id) {
          await delay(100);
          return HttpResponse.json({}, { status: 503 });
        }
        await delay(20);
        return new HttpResponse(null, { status: 204 });
      },
    ),
  );
  renderResults();

  const firstFavorite = await screen.findByRole("button", {
    name: "ذخیره آپارتمان در سعادت‌آباد در علاقه‌مندی‌ها",
  });
  const secondFavorite = screen.getByRole("button", {
    name: "ذخیره خانه در سعادت‌آباد در علاقه‌مندی‌ها",
  });
  await user.click(firstFavorite);
  await user.click(secondFavorite);

  expect(
    await screen.findByRole("alert", {
      name: "ذخیره علاقه‌مندی انجام نشد. دوباره تلاش کنید.",
    }),
  ).toBeVisible();
  expect(firstFavorite).toHaveAttribute("aria-pressed", "false");
  expect(secondFavorite).toHaveAttribute("aria-pressed", "true");
});

test("waits for the session before deciding whether Renter access is needed", async () => {
  const user = userEvent.setup();
  let saveRequests = 0;
  server.use(
    http.get("*/api/v1/auth/session/", async () => {
      await delay(100);
      return HttpResponse.json({
        authenticated: true,
        csrf_token: "favorite-token",
      });
    }),
    http.put("*/api/v1/catalog/properties/:propertyId/favorite/", () => {
      saveRequests += 1;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  renderResults();

  const favorite = await screen.findByRole("button", {
    name: "ذخیره آپارتمان در سعادت‌آباد در علاقه‌مندی‌ها",
  });
  expect(favorite).toBeDisabled();
  await user.click(favorite);
  expect(screen.queryByRole("dialog")).toBeNull();

  await waitFor(() => expect(favorite).toBeEnabled());
  await user.click(favorite);
  await waitFor(() => expect(saveRequests).toBe(1));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("resumes an anonymous Favorite intent after embedded login", async () => {
  const user = userEvent.setup();
  let authenticated = false;
  let saveRequests = 0;
  const existingFavorite = {
    ...propertySearchPage.results[0]!,
    id: "30000000-0000-4000-8000-000000000059",
    title: "خانه در سعادت‌آباد",
    canonical_slug: "خانه-در-سعادتآباد",
  };
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({
        authenticated,
        csrf_token: authenticated ? "authenticated-token" : "anonymous-token",
      }),
    ),
    http.post("*/api/v1/auth/login/", () => {
      authenticated = true;
      return HttpResponse.json({
        id: "10000000-0000-4000-8000-000000000059",
        email: "renter@example.com",
        first_name: "",
        last_name: "",
        email_verified: true,
        is_submitter: false,
      });
    }),
    http.put("*/api/v1/catalog/properties/:propertyId/favorite/", () => {
      saveRequests += 1;
      return new HttpResponse(null, { status: 204 });
    }),
    http.get("*/api/v1/catalog/properties/", () =>
      HttpResponse.json({
        ...propertySearchPage,
        count: 2,
        results: [
          propertySearchPage.results[0]!,
          { ...existingFavorite, is_favorite: authenticated },
        ],
      }),
    ),
  );
  renderResults("/search?parking=present");

  await user.click(
    await screen.findByRole("button", {
      name: "ذخیره آپارتمان در سعادت‌آباد در علاقه‌مندی‌ها",
    }),
  );
  expect(screen.getByRole("dialog", { name: "ورود به ترب‌رنت" })).toBeVisible();
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent(
    "?parking=present",
  );

  await user.type(screen.getByLabelText("ایمیل"), "renter@example.com");
  await user.type(screen.getByLabelText("گذرواژه"), "correct-horse-battery");
  await user.click(screen.getByRole("button", { name: "ورود و ادامه" }));

  await waitFor(() => expect(saveRequests).toBe(1));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.getByRole("button", {
      name: "حذف آپارتمان در سعادت‌آباد از علاقه‌مندی‌ها",
    }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent(
    "?parking=present",
  );
  expect(
    screen.getByRole("button", {
      name: "حذف خانه در سعادت‌آباد از علاقه‌مندی‌ها",
    }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("restores Favorite state and announces a failed mutation", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "favorite-token" }),
    ),
    http.put("*/api/v1/catalog/properties/:propertyId/favorite/", async () => {
      await delay(50);
      return HttpResponse.json({}, { status: 503 });
    }),
  );
  renderResults();
  const favorite = await screen.findByRole("button", {
    name: "ذخیره آپارتمان در سعادت‌آباد در علاقه‌مندی‌ها",
  });

  await user.click(favorite);
  expect(favorite).toHaveAttribute("aria-pressed", "true");

  expect(
    await screen.findByRole("alert", {
      name: "ذخیره علاقه‌مندی انجام نشد. دوباره تلاش کنید.",
    }),
  ).toBeVisible();
  expect(favorite).toHaveAttribute("aria-pressed", "false");
});

test("disables Favorite animation when reduced motion is preferred", async () => {
  renderResults();

  const favorite = await screen.findByRole("button", {
    name: "ذخیره آپارتمان در سعادت‌آباد در علاقه‌مندی‌ها",
  });

  expect(favorite.querySelector("svg")).toHaveClass(
    "motion-reduce:transition-none",
  );
});

test("scrubs mounted Favorite state when the Renter logs out", async () => {
  const user = userEvent.setup();
  let authenticated = true;
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated, csrf_token: "favorite-token" }),
    ),
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "10000000-0000-4000-8000-000000000059",
        email: "renter@example.com",
        first_name: "",
        last_name: "",
        email_verified: true,
        is_submitter: false,
        operator_capabilities: [],
      }),
    ),
    http.get("*/api/v1/catalog/properties/", () =>
      HttpResponse.json({
        ...propertySearchPage,
        results: propertySearchPage.results.map((property) => ({
          ...property,
          ...(authenticated ? { is_favorite: true } : {}),
        })),
      }),
    ),
    http.post("*/api/v1/auth/logout/", () => {
      authenticated = false;
      return HttpResponse.json({ detail: "با موفقیت خارج شدید." });
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/search"]}>
          <RenterAccessProvider>
            <ProductShell>
              <ResultsPage />
            </ProductShell>
          </RenterAccessProvider>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("button", {
      name: "حذف آپارتمان در سعادت‌آباد از علاقه‌مندی‌ها",
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "حساب کاربری" }));
  await user.click(screen.getByRole("menuitem", { name: "خروج" }));

  expect(
    await screen.findByRole("button", {
      name: "ذخیره آپارتمان در سعادت‌آباد در علاقه‌مندی‌ها",
    }),
  ).toHaveAttribute("aria-pressed", "false");
});

function SearchStateProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="وضعیت جست‌وجو">{location.search}</output>
      <div aria-label="مسیر جاری">{location.pathname}</div>
      <button type="button" onClick={() => void navigate(-1)}>
        بازگشت آزمایشی
      </button>
    </>
  );
}

function PropertyNavigationProbe() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => void navigate(-1)}>
      بازگشت به نتایج آزمایشی
    </button>
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
    "/search?location=تهران&location_label=تهران&property_category=residential&property_type=apartment&bedroom_count=2&area_min=60&parking=present&furnished=present&page=2",
  );

  const toolbar = screen.getByRole("search", { name: "نوار جست‌وجوی ملک" });
  await user.click(within(toolbar).getByRole("button", { name: "تجاری" }));

  expect(requestedParams.get("property_category")).toBe("commercial");
  expect(requestedParams.has("property_type")).toBe(false);
  expect(requestedParams.has("bedroom_count")).toBe(false);
  expect(requestedParams.has("furnished")).toBe(false);
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

test("applies Residential Quick Filters immediately and exposes them as removable chips", async () => {
  const user = userEvent.setup();
  let requestedParams = new URLSearchParams();
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      requestedParams = new URL(request.url).searchParams;
      return HttpResponse.json({
        ...propertySearchPage,
        facets: {
          property_types: [
            { value: "apartment", count: 1 },
            { value: "house", count: 0 },
            { value: "villa", count: 2 },
          ],
          bedroom_counts: [
            { value: "1", count: 1 },
            { value: "2", count: 2 },
            { value: "3_plus", count: 3 },
          ],
          features: {
            parking: { present: 0, absent: 2, unknown: 1 },
            elevator: { present: 2, absent: 1, unknown: 0 },
            storage: { present: 1, absent: 1, unknown: 1 },
            furnished: { present: 1, absent: 1, unknown: 1 },
          },
        },
      });
    }),
  );
  renderResults();
  await screen.findByText("۱ ملک پیدا شد");

  const toolbar = screen.getByRole("search", { name: "نوار جست‌وجوی ملک" });
  expect(
    within(toolbar).getByRole("button", { name: /یک خوابه/ }),
  ).toBeVisible();
  expect(
    within(toolbar).getByRole("button", { name: /دو خوابه/ }),
  ).toBeVisible();
  expect(
    within(toolbar).getByRole("button", { name: /سه خواب و بیشتر/ }),
  ).toBeVisible();
  expect(within(toolbar).getByRole("button", { name: /مبله/ })).toBeVisible();
  expect(within(toolbar).queryByRole("button", { name: /انباری/ })).toBeNull();
  expect(
    within(toolbar).getByRole("button", { name: /پارکینگ/ }),
  ).toBeDisabled();

  await user.click(
    within(toolbar).getByRole("button", { name: /سه خواب و بیشتر/ }),
  );
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent(
    "bedroom_count=3_plus",
  );
  await waitFor(() =>
    expect(requestedParams.get("bedroom_count")).toBe("3_plus"),
  );
  const chip = await screen.findByRole("button", {
    name: "حذف فیلتر تعداد اتاق خواب",
  });
  expect(chip).toHaveTextContent("سه خواب و بیشتر");
  expect(
    screen.getByRole("button", { name: "پاک کردن همه فیلترها" }),
  ).toBeVisible();
  await user.click(chip);
  expect(screen.getByLabelText("وضعیت جست‌وجو")).not.toHaveTextContent(
    "bedroom_count",
  );
});

test("shows Commercial Quick Filters without Bedroom Count choices", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/catalog/properties/", () =>
      HttpResponse.json({
        ...officePropertySearchPage,
        facets: {
          property_types: [
            { value: "office", count: 1 },
            { value: "shop", count: 0 },
            { value: "warehouse", count: 0 },
            { value: "workshop", count: 0 },
          ],
          bedroom_counts: [],
          features: {
            parking: { present: 1, absent: 0, unknown: 0 },
            elevator: { present: 1, absent: 0, unknown: 0 },
            storage: { present: 1, absent: 0, unknown: 0 },
            furnished: { present: 0, absent: 0, unknown: 1 },
          },
        },
      }),
    ),
  );
  renderResults("/search?property_category=commercial");

  const toolbar = screen.getByRole("search", { name: "نوار جست‌وجوی ملک" });
  expect(within(toolbar).queryByRole("button", { name: /خوابه/ })).toBeNull();
  expect(within(toolbar).getByRole("button", { name: /انباری/ })).toBeVisible();
  expect(within(toolbar).queryByRole("button", { name: /مبله/ })).toBeNull();

  await user.click(within(toolbar).getByRole("button", { name: "همه نوع‌ها" }));
  expect(
    within(toolbar).getByRole("checkbox", { name: "مغازه" }),
  ).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "فیلترهای پیشرفته" }));
  const panel = await screen.findByRole("dialog", {
    name: "فیلترهای پیشرفته",
  });
  expect(
    within(panel).queryByRole("group", { name: "تعداد اتاق خواب" }),
  ).toBeNull();
  expect(within(panel).getByRole("group", { name: "انباری" })).toBeVisible();
});

test("stages Advanced Filters, previews the count, and commits or discards as one query", async () => {
  const user = userEvent.setup();
  const requests: URLSearchParams[] = [];
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      const params = new URL(request.url).searchParams;
      requests.push(params);
      return HttpResponse.json({
        ...propertySearchPage,
        count: params.get("area_min") === "90" ? 7 : 1,
      });
    }),
  );
  renderResults(
    "/search?location=tehran-id&location_label=تهران&balcony=absent&ordering=deposit",
  );
  await screen.findByText("۱ ملک پیدا شد");

  const trigger = screen.getByRole("button", { name: "فیلترهای پیشرفته" });
  await user.click(trigger);
  let panel = await screen.findByRole("dialog", { name: "فیلترهای پیشرفته" });
  expect(within(panel).getByLabelText("مرتب‌سازی")).toHaveValue("deposit");
  expect(
    within(within(panel).getByRole("group", { name: "بالکن" })).getByRole(
      "radio",
      { name: "نباشد" },
    ),
  ).toBeChecked();
  await user.type(within(panel).getByLabelText("حداقل متراژ"), "۹۰");

  expect(screen.getByLabelText("وضعیت جست‌وجو")).not.toHaveTextContent(
    "area_min",
  );
  expect(
    await within(panel).findByRole("button", { name: "نمایش ۷ ملک" }),
  ).toBeVisible();
  expect(requests.some((params) => params.get("area_min") === "90")).toBe(true);

  await user.click(within(panel).getByRole("button", { name: "انصراف" }));
  expect(panel).not.toBeVisible();
  expect(trigger).toHaveFocus();
  expect(screen.getByLabelText("وضعیت جست‌وجو")).not.toHaveTextContent(
    "area_min",
  );

  await user.click(trigger);
  panel = await screen.findByRole("dialog", { name: "فیلترهای پیشرفته" });
  expect(within(panel).getByLabelText("حداقل متراژ")).toHaveValue("");
  await user.type(within(panel).getByLabelText("حداقل متراژ"), "90");
  await user.click(
    await within(panel).findByRole("button", { name: "نمایش ۷ ملک" }),
  );
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent(
    "area_min=90",
  );
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent(
    "balcony=absent",
  );
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent(
    "ordering=deposit",
  );

  await user.click(trigger);
  panel = await screen.findByRole("dialog", { name: "فیلترهای پیشرفته" });
  await user.click(within(panel).getByRole("button", { name: "پاک کردن همه" }));
  expect(within(panel).getByLabelText("حداقل متراژ")).toHaveValue("");
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent(
    "location=tehran-id",
  );
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent(
    "area_min=90",
  );
  await user.click(
    await within(panel).findByRole("button", { name: "نمایش ۱ ملک" }),
  );
  expect(screen.getByLabelText("وضعیت جست‌وجو")).not.toHaveTextContent(
    "area_min",
  );
});

test("selects several districts and neighborhoods independently of the city", async () => {
  const user = userEvent.setup();
  let requestedParams = new URLSearchParams();
  server.use(
    http.get("*/api/v1/catalog/locations/", ({ request }) => {
      const query = new URL(request.url).searchParams.get("q") ?? "";
      return HttpResponse.json(
        query.includes("منطقه")
          ? [
              {
                id: "20000000-0000-4000-8000-000000000002",
                kind: "district",
                name: "منطقه ۲",
                label: "منطقه ۲، تهران",
              },
            ]
          : [
              {
                id: "30000000-0000-4000-8000-000000000043",
                kind: "neighborhood",
                name: "سعادت‌آباد",
                label: "سعادت‌آباد، منطقه ۲، تهران",
              },
            ],
      );
    }),
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      requestedParams = new URL(request.url).searchParams;
      return HttpResponse.json(propertySearchPage);
    }),
  );
  renderResults("/search?location=tehran-id&location_label=تهران");
  await screen.findByText("۱ ملک پیدا شد");
  await user.click(screen.getByRole("button", { name: "فیلترهای پیشرفته" }));
  const panel = await screen.findByRole("dialog", {
    name: "فیلترهای پیشرفته",
  });

  const district = within(panel).getByRole("combobox", { name: "منطقه" });
  await user.type(district, "منطقه");
  const districtOption = await within(panel).findByRole("option", {
    name: "منطقه ۲، تهران",
  });
  await user.keyboard("{ArrowDown}");
  expect(districtOption).toHaveClass("bg-accent");
  await user.keyboard("{Enter}");
  await user.type(
    within(panel).getByRole("combobox", { name: "محله" }),
    "سعادت",
  );
  await user.click(
    await within(panel).findByRole("option", {
      name: "سعادت‌آباد، منطقه ۲، تهران",
    }),
  );

  expect(screen.getByLabelText("وضعیت جست‌وجو")).not.toHaveTextContent(
    "district",
  );
  await waitFor(() => {
    expect(requestedParams.getAll("district")).toEqual([
      "20000000-0000-4000-8000-000000000002",
    ]);
    expect(requestedParams.getAll("neighborhood")).toEqual([
      "30000000-0000-4000-8000-000000000043",
    ]);
  });
  await user.click(
    await within(panel).findByRole("button", { name: "نمایش ۱ ملک" }),
  );
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent(
    "location=tehran-id",
  );
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent("district=");
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent(
    "neighborhood=",
  );
});

test("announces an Advanced Filters preview failure and prevents a stale apply", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) =>
      new URL(request.url).searchParams.has("area_min")
        ? HttpResponse.json({ detail: "unavailable" }, { status: 503 })
        : HttpResponse.json(propertySearchPage),
    ),
  );
  renderResults();
  await screen.findByText("۱ ملک پیدا شد");
  await user.click(screen.getByRole("button", { name: "فیلترهای پیشرفته" }));
  const panel = await screen.findByRole("dialog", {
    name: "فیلترهای پیشرفته",
  });
  await user.type(within(panel).getByLabelText("حداقل متراژ"), "90");

  expect(
    await within(panel).findByText("به‌روزرسانی تعداد ملک‌ها ممکن نشد"),
  ).toHaveAttribute("role", "alert");
  expect(
    within(panel).getByRole("button", { name: "شمارش ملک‌ها ممکن نشد" }),
  ).toBeDisabled();
});

test("keeps legacy Bedroom Count URLs working during the API migration", async () => {
  const user = userEvent.setup();
  let requestedParams = new URLSearchParams();
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      requestedParams = new URL(request.url).searchParams;
      return HttpResponse.json(propertySearchPage);
    }),
  );

  renderResults("/search?room_count=3_plus");

  expect(
    await screen.findByRole("button", {
      name: "حذف فیلتر تعداد اتاق خواب",
    }),
  ).toHaveTextContent("سه خواب و بیشتر");
  expect(requestedParams.get("room_count")).toBe("3_plus");

  const toolbar = screen.getByRole("search", { name: "نوار جست‌وجوی ملک" });
  const quickFilter = within(toolbar).getByRole("button", {
    name: /سه خواب و بیشتر/,
  });
  expect(quickFilter).toHaveAttribute("aria-pressed", "true");
  await user.click(quickFilter);
  expect(screen.getByLabelText("وضعیت جست‌وجو")).not.toHaveTextContent(
    /(?:bedroom|room)_count/,
  );
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

test("selects a marker, highlights its loaded card, and opens the complete preview without scrolling", async () => {
  const user = userEvent.setup();
  const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");

  renderResults("/search", createFakeMapAdapter());

  const marker = await screen.findByRole("button", {
    name: /انتخاب آپارتمان در سعادت‌آباد، ودیعه ۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان، اجاره ماهانه ۲۵٬۰۰۰٬۰۰۰ تومان/,
  });
  await user.click(marker);

  expect(
    screen.getByRole("article", { name: "آپارتمان در سعادت‌آباد" }),
  ).toHaveAttribute("data-selected", "true");
  expect(scrollIntoView).not.toHaveBeenCalled();

  const preview = screen.getByRole("region", {
    name: "پیش‌نمایش آپارتمان در سعادت‌آباد",
  });
  expect(preview).toHaveFocus();
  expect(within(preview).getByRole("img")).toHaveAttribute(
    "src",
    "/media/reviewed-media/property-primary.webp",
  );
  expect(preview).toHaveTextContent("سعادت‌آباد");
  expect(preview).toHaveTextContent("آپارتمان · ۱۱۰ متر · ۲ خواب");
  expect(preview).toHaveTextContent("ودیعه ۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان");
  expect(preview).toHaveTextContent("اجاره ماهانه ۲۵٬۰۰۰٬۰۰۰ تومان");
  expect(preview).toHaveTextContent("۲ آگهی فعال");
  expect(
    within(preview).getByRole("button", {
      name: "ذخیره آپارتمان در سعادت‌آباد در علاقه‌مندی‌ها",
    }),
  ).toBeVisible();
  expect(
    within(preview).getByRole("link", {
      name: "مشاهده آپارتمان در سعادت‌آباد",
    }),
  ).toHaveAttribute("href", expect.stringContaining("/properties/"));

  await user.click(
    within(preview).getByRole("button", { name: "بستن پیش‌نمایش" }),
  );
  expect(marker).toHaveFocus();
});

test("keeps mobile list-first and restores focus after the full-screen map closes", async () => {
  const user = userEvent.setup();
  renderResults("/search", createFakeMapAdapter());

  const card = await screen.findByRole("article", {
    name: "آپارتمان در سعادت‌آباد",
  });
  const openMap = screen.getByRole("button", {
    name: "نمایش نقشه تمام‌صفحه",
  });
  expect(openMap.compareDocumentPosition(card)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(
    screen.queryByRole("dialog", { name: "نقشه تمام‌صفحه ملک‌ها" }),
  ).toBeNull();

  await user.click(openMap);
  const fullScreenMap = screen.getByRole("dialog", {
    name: "نقشه تمام‌صفحه ملک‌ها",
  });
  const mapApplication = within(fullScreenMap).getByRole("application", {
    name: "نقشه تعاملی ملک‌ها",
  });
  expect(mapApplication).toBeVisible();
  expect(mapApplication).toHaveClass("h-full");

  await user.click(
    within(fullScreenMap).getByRole("button", {
      name: /انتخاب آپارتمان در سعادت‌آباد/,
    }),
  );
  expect(
    within(fullScreenMap).getByRole("region", {
      name: "پیش‌نمایش آپارتمان در سعادت‌آباد",
    }),
  ).toHaveClass("rounded-t-2xl");

  await user.click(within(fullScreenMap).getByRole("button", { name: "بستن" }));
  expect(openMap).toHaveFocus();
});

test("uses an equal sticky viewport-height split for the desktop map", async () => {
  renderResults("/search", createFakeMapAdapter());

  await screen.findByRole("heading", { name: "آپارتمان در سعادت‌آباد" });
  const resultsAndMap = screen.getByRole("region", {
    name: "نتایج و نقشه جاری",
  });
  const desktopMap = within(resultsAndMap).getByRole("region", {
    name: "نقشه ملک‌ها",
  }).parentElement;

  expect(resultsAndMap).toHaveClass("xl:grid-cols-2");
  expect(desktopMap).toHaveClass(
    "xl:sticky",
    "xl:top-24",
    "xl:h-[calc(100dvh-7.5rem)]",
  );
});

test("keeps a marker preview useful when its result card is not loaded", async () => {
  const user = userEvent.setup();
  const loadedProperty = propertySearchPage.results[0]!;
  const mapOnlyProperty = {
    ...loadedProperty,
    id: "40000000-0000-4000-8000-000000000066",
    title: "خانه روی نقشه",
    canonical_slug: "خانه-روی-نقشه",
  };
  server.use(
    http.get("*/api/v1/catalog/properties/", () =>
      HttpResponse.json({
        ...propertySearchPage,
        map: {
          ...propertySearchPage.map,
          total_property_count: 2,
          mappable_property_count: 2,
          markers: [loadedProperty, mapOnlyProperty],
        },
      }),
    ),
  );
  renderResults("/search", createFakeMapAdapter());

  await user.click(
    await screen.findByRole("button", { name: /انتخاب خانه روی نقشه/ }),
  );

  expect(screen.queryByRole("article", { name: "خانه روی نقشه" })).toBeNull();
  const preview = screen.getByRole("region", {
    name: "پیش‌نمایش خانه روی نقشه",
  });
  expect(preview).toHaveTextContent("آپارتمان · ۱۱۰ متر · ۲ خواب");
  expect(
    within(preview).getByRole("link", { name: "مشاهده خانه روی نقشه" }),
  ).toHaveAttribute("href", expect.stringContaining(mapOnlyProperty.id));
  await user.click(
    within(preview).getByRole("link", { name: "مشاهده خانه روی نقشه" }),
  );
  expect(screen.getByLabelText("مسیر جاری")).toHaveTextContent(
    `/properties/${mapOnlyProperty.id}`,
  );
});

test("shares optimistic Favorite state between a marker preview and its loaded card", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "favorite-token" }),
    ),
    http.put("*/api/v1/catalog/properties/:propertyId/favorite/", async () => {
      await delay(100);
      return new HttpResponse(null, { status: 204 });
    }),
  );
  renderResults("/search", createFakeMapAdapter());

  await user.click(
    await screen.findByRole("button", {
      name: /انتخاب آپارتمان در سعادت‌آباد/,
    }),
  );
  const preview = screen.getByRole("region", {
    name: "پیش‌نمایش آپارتمان در سعادت‌آباد",
  });
  await user.click(
    within(preview).getByRole("button", {
      name: "ذخیره آپارتمان در سعادت‌آباد در علاقه‌مندی‌ها",
    }),
  );

  const selectedFavorite = within(preview).getByRole("button", {
    name: "حذف آپارتمان در سعادت‌آباد از علاقه‌مندی‌ها",
  });
  expect(selectedFavorite).toHaveAttribute("aria-pressed", "true");
  expect(selectedFavorite).toHaveFocus();
  expect(
    screen.getAllByRole("button", {
      name: "حذف آپارتمان در سعادت‌آباد از علاقه‌مندی‌ها",
    }),
  ).toHaveLength(2);
});

test("uses preview Favorite authentication and animation semantics", async () => {
  const user = userEvent.setup();
  renderResults("/search", createFakeMapAdapter());

  await user.click(
    await screen.findByRole("button", {
      name: /انتخاب آپارتمان در سعادت‌آباد/,
    }),
  );
  const preview = screen.getByRole("region", {
    name: "پیش‌نمایش آپارتمان در سعادت‌آباد",
  });
  const anonymousFavorite = within(preview).getByRole("button", {
    name: "ذخیره آپارتمان در سعادت‌آباد در علاقه‌مندی‌ها",
  });
  expect(anonymousFavorite.querySelector("svg")).toHaveClass(
    "motion-reduce:transition-none",
  );
  await user.click(anonymousFavorite);
  expect(screen.getByRole("dialog", { name: "ورود به ترب‌رنت" })).toBeVisible();
});

test("rolls back a failed optimistic Favorite from the marker preview", async () => {
  const user = userEvent.setup();

  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "favorite-token" }),
    ),
    http.put("*/api/v1/catalog/properties/:propertyId/favorite/", async () => {
      await delay(50);
      return HttpResponse.json({}, { status: 503 });
    }),
  );
  renderResults("/search", createFakeMapAdapter());

  await user.click(
    await screen.findByRole("button", {
      name: /انتخاب آپارتمان در سعادت‌آباد/,
    }),
  );
  const preview = screen.getByRole("region", {
    name: "پیش‌نمایش آپارتمان در سعادت‌آباد",
  });
  const favorite = within(preview).getByRole("button", {
    name: "ذخیره آپارتمان در سعادت‌آباد در علاقه‌مندی‌ها",
  });
  await user.click(favorite);
  expect(favorite).toHaveAttribute("aria-pressed", "true");
  expect(
    await within(preview).findByRole("alert", {
      name: "ذخیره علاقه‌مندی انجام نشد. دوباره تلاش کنید.",
    }),
  ).toBeVisible();
  expect(favorite).toHaveAttribute("aria-pressed", "false");
});

test("presents each Property with normalized facts and freshest complete Rental Terms", async () => {
  let requestedLocation: string | null = null;
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      requestedLocation = new URL(request.url).searchParams.get("location");
      return HttpResponse.json(propertySearchPage);
    }),
  );

  renderResults("/search?location=سعادت‌آباد", createFakeMapAdapter());

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
  expect(screen.getByText("آپارتمان · ۱۱۰ متر · ۲ خواب")).toBeVisible();
  expect(screen.getByText("۱ پیشنهاد دیگر")).toBeVisible();
  expect(screen.getByText("ودیعه ۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان")).toBeVisible();
  expect(screen.getByText("اجاره ماهانه ۲۵٬۰۰۰٬۰۰۰ تومان")).toBeVisible();
  expect(document.querySelector("img")).toHaveAttribute(
    "src",
    "/media/reviewed-media/property-primary.webp",
  );
  expect(
    screen.getByRole("link", { name: "آپارتمان در سعادت‌آباد" }),
  ).toHaveAttribute("href", expect.stringContaining("/properties/"));
  expect(
    screen.getByRole("button", {
      name: "ذخیره آپارتمان در سعادت‌آباد در علاقه‌مندی‌ها",
    }),
  ).toBeVisible();
  expect(screen.getByRole("region", { name: "ملک‌های پیدا شده" })).toHaveClass(
    "sm:grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))]",
  );
  const image = document.querySelector("img");
  const heading = screen.getByRole("heading", {
    name: "آپارتمان در سعادت‌آباد",
  });
  expect(image?.compareDocumentPosition(heading)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
});

test("uses a Property Type placeholder and keeps a single Active Listing badge visible", async () => {
  server.use(
    http.get("*/api/v1/catalog/properties/", () =>
      HttpResponse.json({
        ...propertySearchPage,
        results: propertySearchPage.results.map((property) => ({
          ...property,
          primary_image: null,
          listing_count: 1,
        })),
      }),
    ),
  );

  renderResults();

  expect(await screen.findByText("تصویر آپارتمان موجود نیست")).toBeVisible();
  expect(screen.getByText("۱ آگهی فعال")).toBeVisible();
  expect(screen.queryByText(/پیشنهاد دیگر/)).not.toBeInTheDocument();
});

test("offers the five specified sort choices with Newest selected by default", async () => {
  const user = userEvent.setup();
  renderResults();

  await user.click(screen.getByRole("button", { name: "فیلترهای پیشرفته" }));
  const filters = await screen.findByRole("dialog", {
    name: "فیلترهای پیشرفته",
  });
  const sorting = within(filters).getByLabelText("مرتب‌سازی");
  expect(sorting).toHaveValue("");
  expect(
    within(sorting)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual([
    "جدیدترین",
    "کمترین اجاره ماهانه",
    "کمترین ودیعه",
    "بیشترین متراژ",
    "کمترین متراژ",
  ]);
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
      name: /انتخاب آپارتمان در سعادت‌آباد، ودیعه .*، اجاره ماهانه /,
    }),
  ).toBeVisible();
  expect(screen.getByText("محدوده تقریبی ۵۰۰ متر")).toBeVisible();
});

test("settles user map movement into a shareable replacement viewport query", async () => {
  const user = userEvent.setup();
  const requestedViewports: URLSearchParams[] = [];
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      const parameters = new URL(request.url).searchParams;
      if (parameters.has("viewport_north")) {
        requestedViewports.push(parameters);
      }
      return HttpResponse.json(propertySearchPage);
    }),
  );
  renderResults(
    ["/search?location=previous", "/search?location=تهران"],
    createFakeMapAdapter(),
  );

  await screen.findByRole("heading", { name: "آپارتمان در سعادت‌آباد" });
  await user.click(
    screen.getByRole("button", { name: "تغییر محدوده آزمایشی" }),
  );
  expect(requestedViewports).toHaveLength(0);

  await waitFor(() => expect(requestedViewports).toHaveLength(1), {
    timeout: 1_000,
  });
  expect(requestedViewports[0]?.get("viewport_north")).toBe("35.82");
  expect(requestedViewports[0]?.get("viewport_zoom")).toBe("12");
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent(
    "viewport_north=35.82",
  );

  await user.click(screen.getByRole("button", { name: "بازگشت آزمایشی" }));
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent(
    "location=previous",
  );
});

test("preserves a newer filter when a pending viewport debounce settles", async () => {
  const user = userEvent.setup();
  renderResults("/search", createFakeMapAdapter());

  await screen.findByRole("heading", { name: "آپارتمان در سعادت‌آباد" });
  await user.click(
    screen.getByRole("button", { name: "تغییر محدوده آزمایشی" }),
  );
  const toolbar = screen.getByRole("search", { name: "نوار جست‌وجوی ملک" });
  await user.click(
    within(toolbar).getByRole("button", { name: /سه خواب و بیشتر/ }),
  );

  await waitFor(
    () => {
      const state = screen.getByLabelText("وضعیت جست‌وجو");
      expect(state).toHaveTextContent("bedroom_count=3_plus");
      expect(state).toHaveTextContent("viewport_north=35.82");
    },
    { timeout: 1_000 },
  );
});

test("shows server Property clusters and discloses city-wide map coverage", async () => {
  server.use(
    http.get("*/api/v1/catalog/properties/", () =>
      HttpResponse.json({
        ...propertySearchPage,
        count: 9,
        map: {
          total_property_count: 9,
          mappable_property_count: 7,
          markers: [],
          clusters: [
            {
              id: "11:357:514",
              latitude: "35.750000",
              longitude: "51.400000",
              property_count: 7,
              property_ids: propertySearchPage.results.map(
                (property) => property.id,
              ),
            },
          ],
        },
      }),
    ),
  );

  renderResults("/search", createFakeMapAdapter());

  expect(
    await screen.findByRole("button", { name: "خوشه ۷ ملک" }),
  ).toBeVisible();
  expect(screen.getByText("۹ ملک پیدا شد")).toBeVisible();
  expect(screen.getByText("از این تعداد، ۷ ملک روی نقشه است")).toBeVisible();
});

test("discards the previous map and results while a viewport replacement loads", async () => {
  const user = userEvent.setup();
  const replacement = {
    ...propertySearchPage,
    results: propertySearchPage.results.map((property) => ({
      ...property,
      title: "آپارتمان در ونک",
    })),
    map: {
      ...propertySearchPage.map,
      markers: propertySearchPage.map.markers.map((property) => ({
        ...property,
        title: "آپارتمان در ونک",
      })),
    },
  };
  server.use(
    http.get("*/api/v1/catalog/properties/", async ({ request }) => {
      if (new URL(request.url).searchParams.has("viewport_north")) {
        await delay(150);
        return HttpResponse.json(replacement);
      }
      return HttpResponse.json(propertySearchPage);
    }),
  );
  renderResults("/search", createFakeMapAdapter());

  await screen.findByRole("heading", { name: "آپارتمان در سعادت‌آباد" });
  await user.click(
    screen.getByRole("button", { name: "تغییر محدوده آزمایشی" }),
  );

  await waitFor(() =>
    expect(screen.getByLabelText("در حال بارگذاری ملک‌ها")).toBeVisible(),
  );
  expect(
    screen.queryByRole("heading", { name: "آپارتمان در سعادت‌آباد" }),
  ).toBeNull();

  expect(
    await screen.findByRole("heading", { name: "آپارتمان در ونک" }),
  ).toBeVisible();
  expect(screen.getByText("۱ ملک در این محدوده پیدا شد")).toBeVisible();
  expect(
    screen.getByRole("region", { name: "نتایج و نقشه جاری" }),
  ).toHaveAttribute("aria-busy", "false");
});

test("never lets an obsolete viewport response replace the final movement", async () => {
  const user = userEvent.setup();
  let viewportRequest = 0;
  const responseWithTitle = (title: string) => ({
    ...propertySearchPage,
    results: propertySearchPage.results.map((property) => ({
      ...property,
      title,
    })),
    map: {
      ...propertySearchPage.map,
      markers: propertySearchPage.map.markers.map((property) => ({
        ...property,
        title,
      })),
    },
  });
  server.use(
    http.get("*/api/v1/catalog/properties/", async ({ request }) => {
      if (!new URL(request.url).searchParams.has("viewport_north")) {
        return HttpResponse.json(propertySearchPage);
      }
      viewportRequest += 1;
      if (viewportRequest === 1) {
        await delay(1_000);
        return HttpResponse.json(responseWithTitle("پاسخ قدیمی"));
      }
      await delay(10);
      return HttpResponse.json(responseWithTitle("پاسخ نهایی"));
    }),
  );
  renderResults("/search", createFakeMapAdapter());

  await screen.findByRole("heading", { name: "آپارتمان در سعادت‌آباد" });
  await user.click(
    screen.getByRole("button", { name: "تغییر محدوده آزمایشی" }),
  );
  await waitFor(() => expect(viewportRequest).toBe(1), { timeout: 1_000 });
  await user.click(
    screen.getByRole("button", { name: "تغییر محدوده آزمایشی" }),
  );

  expect(
    await screen.findByRole(
      "heading",
      { name: "پاسخ نهایی" },
      { timeout: 1_000 },
    ),
  ).toBeVisible();
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(screen.queryByRole("heading", { name: "پاسخ قدیمی" })).toBeNull();
});

test("marker selection does not accidentally redefine the viewport", async () => {
  const user = userEvent.setup();
  let viewportRequests = 0;
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      if (new URL(request.url).searchParams.has("viewport_north")) {
        viewportRequests += 1;
      }
      return HttpResponse.json(propertySearchPage);
    }),
  );
  renderResults("/search", createFakeMapAdapter());

  await user.click(
    await screen.findByRole("button", {
      name: /انتخاب آپارتمان در سعادت‌آباد، ودیعه .*، اجاره ماهانه /,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 600));

  expect(viewportRequests).toBe(0);
  expect(screen.getByLabelText("وضعیت جست‌وجو")).not.toHaveTextContent(
    "viewport_north",
  );
});

test("keeps an empty viewport and offers clear filters and Reset to Tehran", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/catalog/properties/", () =>
      HttpResponse.json({
        ...propertySearchPage,
        count: 0,
        results: [],
        map: {
          total_property_count: 0,
          mappable_property_count: 0,
          clusters: [],
          markers: [],
        },
      }),
    ),
  );
  renderResults(
    "/search?parking=present&viewport_north=35.8&viewport_east=51.5&viewport_south=35.7&viewport_west=51.3&viewport_zoom=13",
    createFakeMapAdapter(),
  );

  await screen.findByRole("heading", { name: "ملکی در این محدوده پیدا نشد" });
  await user.click(screen.getByRole("button", { name: "پاک کردن فیلترها" }));
  expect(screen.getByLabelText("وضعیت جست‌وجو")).not.toHaveTextContent(
    "parking=present",
  );
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent(
    "viewport_north=35.8",
  );

  await user.click(screen.getByRole("button", { name: "بازنشانی به تهران" }));
  expect(screen.getByLabelText("وضعیت جست‌وجو")).not.toHaveTextContent(
    "viewport_north",
  );
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
    expect(screen.getByText(`${propertyTypeLabel} · ۱۱۰ متر`)).toBeVisible();
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

test("accumulates the server-provided next page through an accessible Load More action", async () => {
  const user = userEvent.setup();
  const secondProperty = {
    ...propertySearchPage.results[0]!,
    id: "20000000-0000-4000-8000-000000000067",
    title: "خانه در ونک",
    canonical_slug: "خانه-در-ونک",
  };
  const requestedUrls: string[] = [];
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      requestedUrls.push(request.url);
      const page = new URL(request.url).searchParams.get("page");
      return HttpResponse.json(
        page === "2"
          ? {
              ...propertySearchPage,
              count: 2,
              previous:
                "http://localhost/api/v1/catalog/properties/?location=تهران",
              results: [secondProperty],
            }
          : {
              ...propertySearchPage,
              count: 2,
              next: "http://localhost/api/v1/catalog/properties/?location=تهران&page=2",
            },
      );
    }),
  );

  renderResults("/search?location=تهران");

  expect(await screen.findByText("۲ ملک پیدا شد")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "نمایش ملک‌های بیشتر" }));

  expect(
    await screen.findByRole("heading", { name: "خانه در ونک" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "آپارتمان در سعادت‌آباد" }),
  ).toBeVisible();
  expect(requestedUrls).toContain(
    "http://localhost/api/v1/catalog/properties/?location=%D8%AA%D9%87%D8%B1%D8%A7%D9%86&page=2",
  );
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent("page=2");
  expect(screen.getByRole("link", { name: "خانه در ونک" })).toHaveAttribute(
    "href",
    expect.stringContaining("page%3D2"),
  );
});

test("deduplicates concurrent automatic continuation triggers", async () => {
  let intersectionCallback: IntersectionObserverCallback = () => undefined;
  class TriggerableIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly scrollMargin = "0px";
    readonly thresholds = [0];
    constructor(callback: IntersectionObserverCallback) {
      intersectionCallback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  const originalIntersectionObserver = globalThis.IntersectionObserver;
  globalThis.IntersectionObserver = TriggerableIntersectionObserver;
  let secondPageRequests = 0;
  const secondProperty = {
    ...propertySearchPage.results[0]!,
    id: "30000000-0000-4000-8000-000000000067",
    title: "خانه نزدیک پایان نتایج",
  };
  server.use(
    http.get("*/api/v1/catalog/properties/", async ({ request }) => {
      if (new URL(request.url).searchParams.get("page") === "2") {
        secondPageRequests += 1;
        await delay(100);
        return HttpResponse.json({
          ...propertySearchPage,
          count: 2,
          results: [secondProperty],
        });
      }
      return HttpResponse.json({
        ...propertySearchPage,
        count: 2,
        next: "http://localhost/api/v1/catalog/properties/?page=2",
      });
    }),
  );

  try {
    renderResults();
    await screen.findByRole("button", { name: "نمایش ملک‌های بیشتر" });
    act(() => {
      const entry = { isIntersecting: true } as IntersectionObserverEntry;
      intersectionCallback([entry], {} as IntersectionObserver);
      intersectionCallback([entry], {} as IntersectionObserver);
    });

    expect(
      await screen.findByRole("heading", { name: "خانه نزدیک پایان نتایج" }),
    ).toBeVisible();
    expect(secondPageRequests).toBe(1);
  } finally {
    globalThis.IntersectionObserver = originalIntersectionObserver;
  }
});

test("keeps accumulated Properties on continuation error and offers retry before announcing the end", async () => {
  const user = userEvent.setup();
  let secondPageAttempts = 0;
  const secondProperty = {
    ...propertySearchPage.results[0]!,
    id: "40000000-0000-4000-8000-000000000067",
    title: "خانه پس از تلاش دوباره",
  };
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      if (new URL(request.url).searchParams.get("page") === "2") {
        secondPageAttempts += 1;
        return secondPageAttempts === 1
          ? HttpResponse.json({ detail: "failed" }, { status: 500 })
          : HttpResponse.json({
              ...propertySearchPage,
              count: 2,
              results: [secondProperty],
            });
      }
      return HttpResponse.json({
        ...propertySearchPage,
        count: 2,
        next: "http://localhost/api/v1/catalog/properties/?page=2",
      });
    }),
  );

  renderResults();
  await user.click(
    await screen.findByRole("button", { name: "نمایش ملک‌های بیشتر" }),
  );

  expect(
    await screen.findByRole("heading", {
      name: "بارگذاری ملک‌های بیشتر کامل نشد",
    }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "آپارتمان در سعادت‌آباد" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "تلاش دوباره" }));

  expect(
    await screen.findByRole("heading", { name: "خانه پس از تلاش دوباره" }),
  ).toBeVisible();
  expect(screen.getByText("به پایان نتایج رسیدید")).toHaveAttribute(
    "role",
    "status",
  );
});

test("reloads accumulated pages from the beginning for a shared query URL", async () => {
  const requestedPages: Array<string | null> = [];
  const secondProperty = {
    ...propertySearchPage.results[0]!,
    id: "50000000-0000-4000-8000-000000000067",
    title: "خانه بازیابی‌شده",
  };
  const thirdProperty = {
    ...propertySearchPage.results[0]!,
    id: "51000000-0000-4000-8000-000000000067",
    title: "خانه بازیابی‌شده سوم",
  };
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      const page = new URL(request.url).searchParams.get("page");
      requestedPages.push(page);
      return HttpResponse.json(
        page === "3"
          ? { ...propertySearchPage, count: 3, results: [thirdProperty] }
          : page === "2"
            ? {
                ...propertySearchPage,
                count: 3,
                next: "http://localhost/api/v1/catalog/properties/?parking=present&ordering=deposit&page=3",
                results: [secondProperty],
              }
            : {
                ...propertySearchPage,
                count: 3,
                next: "http://localhost/api/v1/catalog/properties/?parking=present&ordering=deposit&page=2",
              },
      );
    }),
  );

  renderResults("/search?parking=present&ordering=deposit&page=3");

  expect(
    await screen.findByRole("heading", { name: "خانه بازیابی‌شده سوم" }),
  ).toBeVisible();
  expect(requestedPages).toEqual([null, "2", "3"]);
  expect(
    screen.getByRole("heading", { name: "آپارتمان در سعادت‌آباد" }),
  ).toBeVisible();
});

test("restores accumulated results, query context, and scroll after Property navigation", async () => {
  const user = userEvent.setup();
  const secondProperty = {
    ...propertySearchPage.results[0]!,
    id: "55000000-0000-4000-8000-000000000067",
    title: "خانه برای بازگشت",
  };
  let requests = 0;
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      requests += 1;
      return HttpResponse.json(
        new URL(request.url).searchParams.get("page") === "2"
          ? { ...propertySearchPage, count: 2, results: [secondProperty] }
          : {
              ...propertySearchPage,
              count: 2,
              next: "http://localhost/api/v1/catalog/properties/?parking=present&ordering=deposit&page=2",
            },
      );
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <>
            <ScrollRestoration />
            <Outlet />
          </>
        ),
        children: [
          {
            path: "search",
            element: (
              <>
                <ResultsPage />
                <SearchStateProbe />
              </>
            ),
          },
          {
            path: "properties/:propertyId",
            element: <PropertyNavigationProbe />,
          },
        ],
      },
    ],
    { initialEntries: ["/search?parking=present&ordering=deposit"] },
  );
  const scrollDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY");
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  render(
    <QueryClientProvider client={queryClient}>
      <RenterAccessProvider>
        <RouterProvider router={router} />
      </RenterAccessProvider>
    </QueryClientProvider>,
  );

  await user.click(
    await screen.findByRole("button", { name: "نمایش ملک‌های بیشتر" }),
  );
  await screen.findByRole("heading", { name: "خانه برای بازگشت" });
  Object.defineProperty(window, "scrollY", { configurable: true, value: 720 });
  await user.click(screen.getByRole("link", { name: "خانه برای بازگشت" }));
  await user.click(
    await screen.findByRole("button", { name: "بازگشت به نتایج آزمایشی" }),
  );

  expect(
    await screen.findByRole("heading", { name: "خانه برای بازگشت" }),
  ).toBeVisible();
  expect(screen.getByLabelText("وضعیت جست‌وجو")).toHaveTextContent(
    "parking=present&ordering=deposit&page=2",
  );
  expect(requests).toBe(2);
  expect(scrollTo).toHaveBeenCalledWith(0, 720);
  scrollTo.mockRestore();
  if (scrollDescriptor)
    Object.defineProperty(window, "scrollY", scrollDescriptor);
});

test("discards accumulated pages when the query changes", async () => {
  const user = userEvent.setup();
  const secondProperty = {
    ...propertySearchPage.results[0]!,
    id: "60000000-0000-4000-8000-000000000067",
    title: "خانه از پرس‌وجوی قبلی",
  };
  const filteredProperty = {
    ...propertySearchPage.results[0]!,
    id: "70000000-0000-4000-8000-000000000067",
    title: "خانه سه‌خوابه تازه",
  };
  server.use(
    http.get("*/api/v1/catalog/properties/", async ({ request }) => {
      const parameters = new URL(request.url).searchParams;
      if (parameters.get("bedroom_count") === "3_plus") {
        await delay(100);
        return HttpResponse.json({
          ...propertySearchPage,
          results: [filteredProperty],
        });
      }
      return HttpResponse.json(
        parameters.get("page") === "2"
          ? { ...propertySearchPage, count: 2, results: [secondProperty] }
          : {
              ...propertySearchPage,
              count: 2,
              next: "http://localhost/api/v1/catalog/properties/?page=2",
            },
      );
    }),
  );

  renderResults();
  await user.click(
    await screen.findByRole("button", { name: "نمایش ملک‌های بیشتر" }),
  );
  expect(
    await screen.findByRole("heading", { name: "خانه از پرس‌وجوی قبلی" }),
  ).toBeVisible();

  const toolbar = screen.getByRole("search", { name: "نوار جست‌وجوی ملک" });
  await user.click(
    within(toolbar).getByRole("button", { name: /سه خواب و بیشتر/ }),
  );

  expect(screen.getByLabelText("در حال بارگذاری ملک‌ها")).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "خانه از پرس‌وجوی قبلی" }),
  ).toBeNull();
  expect(
    await screen.findByRole("heading", { name: "خانه سه‌خوابه تازه" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "خانه از پرس‌وجوی قبلی" }),
  ).toBeNull();
  expect(screen.getByLabelText("وضعیت جست‌وجو")).not.toHaveTextContent(
    "page=2",
  );
});

test("applies Advanced Filters with tolerant numeric entry and exposes removable chips", async () => {
  const user = userEvent.setup();
  let requestedParams = new URLSearchParams();
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      requestedParams = new URL(request.url).searchParams;
      return HttpResponse.json(propertySearchPage);
    }),
  );
  renderResults("/search?location=تهران&page=3");

  const toolbar = screen.getByRole("search", { name: "نوار جست‌وجوی ملک" });
  await user.click(within(toolbar).getByRole("button", { name: "همه نوع‌ها" }));
  await user.click(within(toolbar).getByRole("checkbox", { name: "آپارتمان" }));
  await user.click(screen.getByRole("button", { name: "فیلترهای پیشرفته" }));
  const filters = await screen.findByRole("dialog", {
    name: "فیلترهای پیشرفته",
  });
  await user.type(within(filters).getByLabelText("حداقل ودیعه"), "۵۰۰٬۰۰۰٬۰۰۰");
  await user.click(
    within(
      within(filters).getByRole("group", { name: "تعداد اتاق خواب" }),
    ).getByRole("radio", { name: "دو خوابه" }),
  );
  await user.click(
    within(within(filters).getByRole("group", { name: "پارکینگ" })).getByRole(
      "radio",
      { name: "ضروری" },
    ),
  );
  await user.click(
    await within(filters).findByRole("button", { name: "نمایش ۱ ملک" }),
  );

  expect(requestedParams.get("deposit_min_toman")).toBe("500000000");
  expect(requestedParams.get("bedroom_count")).toBe("2");
  expect(requestedParams.get("property_type")).toBe("apartment");
  expect(requestedParams.get("parking")).toBe("present");
  expect(requestedParams.has("page")).toBe(false);
  const parkingChip = await screen.findByRole("button", {
    name: /حذف فیلتر پارکینگ/,
  });
  expect(parkingChip).toBeVisible();
  await user.click(parkingChip);
  expect(screen.getByLabelText("وضعیت جست‌وجو")).not.toHaveTextContent(
    "parking",
  );
});

test("offers the same filter form in an accessible mobile drawer", async () => {
  const user = userEvent.setup();
  renderResults();

  await user.click(screen.getByRole("button", { name: "فیلترهای پیشرفته" }));
  const drawer = await screen.findByRole("dialog", {
    name: "فیلترهای پیشرفته",
  });

  expect(
    within(drawer).getByRole("heading", { name: "فیلترهای پیشرفته" }),
  ).toBeVisible();
  expect(within(drawer).getByLabelText("حداقل اجاره ماهانه")).toBeVisible();
  expect(within(drawer).getByRole("group", { name: "مبله" })).toBeVisible();
});

test("preserves compatible Property Types through requests, filters, continuation, chips, and return navigation", async () => {
  const user = userEvent.setup();
  let requestedParams = new URLSearchParams();
  server.use(
    http.get("*/api/v1/catalog/properties/", ({ request }) => {
      requestedParams = new URL(request.url).searchParams;
      const next = new URLSearchParams(requestedParams);
      next.set("page", "2");
      return HttpResponse.json({
        ...propertySearchPage,
        count: 26,
        next: requestedParams.has("page")
          ? null
          : `http://localhost/api/v1/catalog/properties/?${next.toString()}`,
      });
    }),
  );
  renderResults(
    "/search?property_category=residential&property_type=apartment&property_type=house&parking=present",
  );

  await screen.findByText("۲۶ ملک پیدا شد");
  const toolbar = screen.getByRole("search", { name: "نوار جست‌وجوی ملک" });
  expect(requestedParams.getAll("property_type")).toEqual([
    "apartment",
    "house",
  ]);
  expect(
    within(toolbar).getByRole("button", { name: "آپارتمان، خانه" }),
  ).toBeVisible();

  await user.click(screen.getByRole("button", { name: "فیلترهای پیشرفته" }));
  const filters = await screen.findByRole("dialog", {
    name: "فیلترهای پیشرفته",
  });
  await user.type(within(filters).getByLabelText("حداکثر متراژ"), "۱۲۰");
  await user.click(
    await within(filters).findByRole("button", { name: "نمایش ۲۶ ملک" }),
  );
  expect(requestedParams.getAll("property_type")).toEqual([
    "apartment",
    "house",
  ]);
  await user.click(screen.getByRole("button", { name: "نمایش ملک‌های بیشتر" }));
  await waitFor(() => expect(requestedParams.get("page")).toBe("2"));
  expect(requestedParams.getAll("property_type")).toEqual([
    "apartment",
    "house",
  ]);
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

  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "فیلترهای پیشرفته" }));
  const filters = await screen.findByRole("dialog", {
    name: "فیلترهای پیشرفته",
  });
  expect(requestedArea).toBe("100");
  expect(within(filters).getByLabelText("حداکثر متراژ")).toHaveValue("۱۰۰");
});

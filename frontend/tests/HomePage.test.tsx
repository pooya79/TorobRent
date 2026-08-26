import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { expect, test } from "vitest";

import { ProductShell } from "@/app/ProductShell";
import { ThemeProvider } from "@/app/ThemeProvider";
import { HomePage } from "@/pages/HomePage";
import { server } from "./server";

function SearchLocationProbe() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  return (
    <p>
      {location.pathname}|{params.get("location")}|
      {params.get("location_label")}|{params.getAll("property_type").join(",")}
    </p>
  );
}

function ShellLocationProbe() {
  const location = useLocation();
  return <output aria-label="مسیر جاری">{location.pathname}</output>;
}

function renderHomeShell(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <MemoryRouter>
          <ProductShell>
            <>
              <HomePage />
              <ShellLocationProbe />
            </>
          </ProductShell>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

test("presents the anonymous public navbar and real advertisement introduction", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderHomeShell(queryClient);

  expect(
    screen.getByRole("heading", {
      name: "اجارهٔ ملک مسکونی و تجاری در تهران",
    }),
  ).toBeVisible();
  expect(screen.getByRole("combobox", { name: "شهر" })).toBeVisible();

  const navbar = screen.getByRole("banner", { name: "راهبری عمومی" });
  const navigation = within(navbar).getByRole("navigation", {
    name: "راهبری اصلی",
  });
  expect(
    within(navigation).getByRole("link", { name: "ورود" }),
  ).toHaveAttribute("href", "/login");
  expect(
    within(navigation).getByRole("link", { name: "ثبت‌نام" }),
  ).toHaveAttribute("href", "/register");
  expect(
    within(navigation).getByRole("link", {
      name: "می‌خواهم آگهی ثبت کنم",
    }),
  ).toHaveAttribute("href", "/advertise");
  expect(
    within(navbar).getByRole("combobox", { name: /پوستهٔ نمایش/ }),
  ).toBeVisible();
  expect(within(navbar).queryByText("آگهی‌های من")).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("contentinfo")).getByRole("link", {
      name: "اعتبار عکس‌ها",
    }),
  ).toHaveAttribute("href", "/photo-credits");

  expect(await screen.findByText("سامانه در دسترس است")).toBeVisible();
});

test("presents ordered Popular Cities with Tehran as the only discovery action", async () => {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <>
          <HomePage />
          <ShellLocationProbe />
        </>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  const gallery = screen.getByRole("region", { name: "شهرهای محبوب" });
  const cards = within(gallery).getAllByRole("article");
  const cityNames = [
    "تهران",
    "اصفهان",
    "مشهد",
    "شیراز",
    "تبریز",
    "قم",
    "اهواز",
    "رشت",
    "کرمانشاه",
    "یزد",
  ];

  expect(cards).toHaveLength(cityNames.length);
  expect(
    cards.map((card) => within(card).getByRole("heading").textContent),
  ).toEqual(cityNames);
  const tehranLink = within(cards[0]!).getByRole("link", {
    name: /مشاهدهٔ ملک‌های تهران/,
  });
  expect(tehranLink).toHaveAttribute(
    "href",
    "/search?location=%D8%AA%D9%87%D8%B1%D8%A7%D9%86&location_label=%D8%AA%D9%87%D8%B1%D8%A7%D9%86",
  );

  for (const [index, cityName] of cityNames.entries()) {
    expect(
      within(cards[index]!).getByRole("img", {
        name: new RegExp(cityName),
      }),
    ).toBeVisible();
    if (index > 0) {
      expect(within(cards[index]!).getByText("به‌زودی")).toBeVisible();
      expect(within(cards[index]!).queryByRole("link")).toBeNull();
      expect(cards[index]).not.toHaveTextContent(/[\d۰-۹]/);
    }
  }

  await user.click(tehranLink);
  expect(screen.getByRole("status", { name: "مسیر جاری" })).toHaveTextContent(
    "/search",
  );
});

test("closes the mobile navigation after choosing the advertisement introduction", async () => {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderHomeShell(queryClient);

  await user.click(
    screen.getByRole("button", { name: "باز کردن فهرست راهبری" }),
  );
  const mobileMenu = screen.getByRole("dialog", { name: "راهبری ترب‌رنت" });
  await user.click(
    within(mobileMenu).getByRole("link", {
      name: "می‌خواهم آگهی ثبت کنم",
    }),
  );

  expect(screen.queryByRole("dialog", { name: "راهبری ترب‌رنت" })).toBeNull();
  expect(screen.getByRole("status", { name: "مسیر جاری" })).toHaveTextContent(
    "/advertise",
  );
});

test("recovers when the readiness check fails during startup", async () => {
  let attempts = 0;
  server.use(
    http.get("*/api/v1/system/ready/", () => {
      attempts += 1;
      return attempts <= 2
        ? HttpResponse.json({ status: "unavailable" }, { status: 503 })
        : HttpResponse.json({ status: "ok" });
    }),
  );

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, retryDelay: 0 } },
  });
  renderHomeShell(queryClient);

  expect(
    await screen.findByText("سامانه در دسترس است", undefined, {
      timeout: 2_500,
    }),
  ).toBeVisible();
  expect(attempts).toBe(3);
});

test("shows Renter controls and honest placeholders in the authenticated account menu", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "test-token" }),
    ),
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "10000000-0000-4000-8000-000000000001",
        email: "renter@example.com",
        first_name: "پویا",
        last_name: "اجاره‌جو",
        email_verified: true,
        operator_capabilities: [],
      }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderHomeShell(queryClient);

  const navbar = screen.getByRole("banner", { name: "راهبری عمومی" });
  expect(
    await within(navbar).findByRole("button", {
      name: "پیام‌ها — به‌زودی",
    }),
  ).toHaveAttribute("aria-disabled", "true");
  expect(
    within(navbar).getByRole("button", {
      name: "علاقه‌مندی‌ها — به‌زودی",
    }),
  ).toHaveAttribute("aria-disabled", "true");
  expect(within(navbar).queryByRole("link", { name: "ورود" })).toBeNull();
  expect(within(navbar).queryByRole("link", { name: "ثبت‌نام" })).toBeNull();

  await user.click(within(navbar).getByRole("button", { name: "حساب کاربری" }));
  const account = screen.getByRole("menu", { name: "حساب کاربری" });
  expect(within(account).getByText("پویا اجاره‌جو")).toBeVisible();
  expect(within(account).getByText("renter@example.com")).toBeVisible();
  for (const name of [
    "نمایه — به‌زودی",
    "پیام‌ها — به‌زودی",
    "علاقه‌مندی‌ها — به‌زودی",
  ]) {
    expect(within(account).getByRole("menuitem", { name })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  }
  const profilePlaceholder = within(account).getByRole("menuitem", {
    name: "نمایه — به‌زودی",
  });
  profilePlaceholder.focus();
  expect(profilePlaceholder).toHaveFocus();
  await user.click(profilePlaceholder);
  expect(account).toBeVisible();
  expect(profilePlaceholder).toHaveFocus();
  expect(
    within(account).getByRole("menuitem", { name: "راهنما" }),
  ).toHaveAttribute("href", "/guide");
  expect(
    within(account).getByRole("menuitem", { name: "تماس با پشتیبانی" }),
  ).toHaveAttribute("href", "/contact");
  expect(within(account).queryByText("فضای کاری اپراتور")).toBeNull();
  expect(within(account).queryByText("آگهی‌های من")).toBeNull();
  expect(within(account).queryByText("ثبت آگهی")).toBeNull();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu", { name: "حساب کاربری" })).toBeNull();
  expect(
    within(navbar).getByRole("button", { name: "حساب کاربری" }),
  ).toHaveFocus();
});

test("offers the Operator workspace only when the account holds an Operator Capability", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "test-token" }),
    ),
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "10000000-0000-4000-8000-000000000002",
        email: "operator@example.com",
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: ["handle_support"],
      }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderHomeShell(queryClient);

  const navbar = screen.getByRole("banner", { name: "راهبری عمومی" });
  await user.click(
    await within(navbar).findByRole("button", { name: "حساب کاربری" }),
  );

  expect(
    screen.getByRole("menuitem", { name: "فضای کاری اپراتور" }),
  ).toHaveAttribute("href", "/operator");
});

test("keeps authenticated navigation and repeated account placeholders in the mobile menu", async () => {
  const user = userEvent.setup();
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "test-token" }),
    ),
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "10000000-0000-4000-8000-000000000003",
        email: "mobile@example.com",
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: [],
      }),
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderHomeShell(queryClient);

  await screen.findByRole("button", { name: "حساب کاربری" });
  await user.click(
    screen.getByRole("button", { name: "باز کردن فهرست راهبری" }),
  );
  const mobileMenu = screen.getByRole("dialog", { name: "راهبری ترب‌رنت" });
  expect(
    within(mobileMenu).getAllByRole("button", {
      name: "پیام‌ها — به‌زودی",
    }),
  ).toHaveLength(2);
  expect(
    within(mobileMenu).getAllByRole("button", {
      name: "علاقه‌مندی‌ها — به‌زودی",
    }),
  ).toHaveLength(2);
  expect(
    within(mobileMenu).getByRole("region", { name: "فهرست حساب کاربری" }),
  ).toBeVisible();
});

test("lets an authenticated Submitter log out from primary navigation", async () => {
  const user = userEvent.setup();
  let loggedOut = false;
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "test-token" }),
    ),
    http.get("*/api/v1/users/me/", () =>
      HttpResponse.json({
        id: "10000000-0000-4000-8000-000000000001",
        email: "renter@example.com",
        first_name: "",
        last_name: "",
        email_verified: true,
        operator_capabilities: [],
      }),
    ),
    http.post("*/api/v1/auth/logout/", () => {
      loggedOut = true;
      return HttpResponse.json({ detail: "با موفقیت خارج شدید." });
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderHomeShell(queryClient);

  const navbar = screen.getByRole("banner", { name: "راهبری عمومی" });
  await user.click(
    await within(navbar).findByRole("button", { name: "حساب کاربری" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "خروج" }));

  expect(loggedOut).toBe(true);
  expect(
    await within(navbar).findByRole("link", { name: "ورود" }),
  ).toBeVisible();
});

test("discovers Tehran on empty focus and waits for deliberate search submission", async () => {
  const user = userEvent.setup();
  let preciseLocationRequests = 0;
  server.use(
    http.get("*/api/v1/catalog/locations/", () => {
      preciseLocationRequests += 1;
      return HttpResponse.json([]);
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <HomePage />
                <ShellLocationProbe />
              </>
            }
          />
          <Route path="/search" element={<SearchLocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  const city = screen.getByRole("combobox", { name: "شهر" });
  await user.click(city);
  await user.click(await screen.findByRole("option", { name: "تهران" }));

  expect(city).toHaveValue("تهران");
  expect(screen.getByRole("status", { name: "مسیر جاری" })).toHaveTextContent(
    "/",
  );
  expect(preciseLocationRequests).toBe(0);

  await user.click(screen.getByRole("button", { name: "همه ملک‌ها" }));
  await user.click(screen.getByRole("checkbox", { name: "دفتر اداری" }));
  await user.click(screen.getByRole("button", { name: "جست‌وجوی ملک" }));

  expect(
    screen.getByText(
      "/search|11111111-1111-4111-8111-111111111111|تهران|office",
    ),
  ).toBeVisible();
});

test("selects Tehran with the keyboard from the city-only listbox", async () => {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderHomeShell(queryClient);

  const city = screen.getByRole("combobox", { name: "شهر" });
  await user.click(city);
  await screen.findByRole("option", { name: "تهران" });
  await user.keyboard("{ArrowDown}{Enter}");

  expect(city).toHaveValue("تهران");
  expect(city).toHaveAttribute("aria-expanded", "false");
});

test.each(["", "تهران"])(
  "searches Tehran explicitly when the unselected city input is %j",
  async (cityInput) => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchLocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    if (cityInput) {
      await user.type(screen.getByRole("combobox", { name: "شهر" }), cityInput);
    }
    await user.click(screen.getByRole("button", { name: "جست‌وجوی ملک" }));

    expect(screen.getByText("/search|تهران|تهران|")).toBeVisible();
  },
);

test("explains supported-city loading, empty, and failure states accessibly", async () => {
  const user = userEvent.setup();
  let response: "loading" | "empty" | "failure" | "success" = "loading";
  server.use(
    http.get("*/api/v1/catalog/supported-cities/", async () => {
      if (response === "loading") await delay(100);
      if (response === "failure") {
        return HttpResponse.json({ detail: "unavailable" }, { status: 503 });
      }
      if (response === "success") {
        return HttpResponse.json([
          {
            id: "11111111-1111-4111-8111-111111111111",
            name: "تهران",
            label: "تهران",
          },
        ]);
      }
      return HttpResponse.json([]);
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderHomeShell(queryClient);

  const city = screen.getByRole("combobox", { name: "شهر" });
  await user.click(city);
  expect(
    screen.getByRole("status", { name: "در حال دریافت شهرها" }),
  ).toHaveTextContent("در حال دریافت شهرها");
  expect(await screen.findByText("شهری پیدا نشد.")).toBeVisible();

  response = "failure";
  await queryClient.invalidateQueries({
    queryKey: ["catalog", "supported-cities"],
  });
  expect(
    await screen.findByRole("alert", {
      name: "دریافت شهرها ممکن نشد. دوباره تلاش کنید.",
    }),
  ).toBeVisible();

  response = "success";
  await user.click(screen.getByRole("button", { name: "تلاش دوباره" }));
  expect(await screen.findByRole("option", { name: "تهران" })).toBeVisible();
});

test("presents All Properties, both categories, and all seven Property Types", async () => {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderHomeShell(queryClient);

  await user.click(screen.getByRole("button", { name: "همه ملک‌ها" }));
  for (const label of [
    "همه ملک‌ها",
    "مسکونی",
    "آپارتمان",
    "خانه",
    "ویلا",
    "تجاری",
    "دفتر اداری",
    "مغازه",
    "انبار",
    "کارگاه",
  ]) {
    expect(screen.getByRole("checkbox", { name: label })).toBeVisible();
  }
});

test("selects Property Type categories and shares mixed selections as repeated parameters", async () => {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchLocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("button", { name: "همه ملک‌ها" }));
  await user.click(screen.getByRole("checkbox", { name: "مسکونی" }));
  expect(screen.getByRole("checkbox", { name: "آپارتمان" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "خانه" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "ویلا" })).toBeChecked();

  await user.click(screen.getByRole("checkbox", { name: "دفتر اداری" }));
  expect(
    screen.getByRole("button", { name: "مسکونی، دفتر اداری" }),
  ).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "تجاری" })).toHaveAttribute(
    "data-state",
    "indeterminate",
  );

  await user.click(screen.getByRole("button", { name: "جست‌وجوی ملک" }));
  expect(screen.getByText(/\|apartment,house,villa,office$/)).toBeVisible();
});

test.each(["clear the last selected type", "select All Properties"])(
  "%s produces an unfiltered Results URL",
  async (action) => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/"]}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchLocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "همه ملک‌ها" }));
    await user.click(screen.getByRole("checkbox", { name: "آپارتمان" }));
    await user.click(
      screen.getByRole("checkbox", {
        name: action === "select All Properties" ? "همه ملک‌ها" : "آپارتمان",
      }),
    );
    await user.click(screen.getByRole("button", { name: "جست‌وجوی ملک" }));

    expect(screen.getByText("/search|تهران|تهران|")).toBeVisible();
  },
);

test("shows only domain-grounded trust claims and live catalog statistics", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderHomeShell(queryClient);

  const trust = screen.getByRole("region", {
    name: "چرا به اطلاعات اعتماد کنیم؟",
  });
  expect(within(trust).getByText("بازبینی پیش از انتشار")).toBeVisible();
  expect(within(trust).getByText("موجودی جاری")).toBeVisible();
  expect(within(trust).getByText("منابع شفاف و جدا")).toBeVisible();

  const statistics = screen.getByRole("region", { name: "آمار زندهٔ کاتالوگ" });
  expect(await within(statistics).findByText("۱۲")).toBeVisible();
  expect(within(statistics).getByText("۱۸")).toBeVisible();
  expect(within(statistics).getByText("۵")).toBeVisible();
  expect(within(statistics).getByText("ملک قابل جست‌وجو")).toBeVisible();
  expect(within(statistics).getByText("آگهی فعال")).toBeVisible();
  expect(within(statistics).getByText("محلهٔ تحت پوشش")).toBeVisible();

  expect(screen.queryByText("ملک‌های به‌روزشده در تهران")).toBeNull();
  expect(screen.queryByText("نمونه‌های تازه")).toBeNull();
});

test("keeps live statistics honest while loading, unavailable, and empty", async () => {
  let state: "loading" | "error" | "zero" = "loading";
  server.use(
    http.get("*/api/v1/catalog/statistics/", async () => {
      if (state === "loading") await delay(100);
      if (state === "error") {
        return HttpResponse.json({ detail: "unavailable" }, { status: 503 });
      }
      return HttpResponse.json({
        searchable_property_count: 0,
        active_listing_count: 0,
        covered_neighborhood_count: 0,
      });
    }),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderHomeShell(queryClient);

  expect(
    screen.getByRole("status", { name: "در حال دریافت آمار زنده" }),
  ).toBeVisible();
  await screen.findByText("هنوز ملک قابل جست‌وجویی منتشر نشده است.");

  state = "error";
  await queryClient.invalidateQueries({ queryKey: ["catalog", "statistics"] });
  expect(
    await screen.findByRole("alert", {
      name: "آمار زنده اکنون در دسترس نیست.",
    }),
  ).toBeVisible();

  state = "zero";
  await userEvent.click(screen.getByRole("button", { name: "تلاش دوباره" }));
  expect(
    await screen.findByText("هنوز ملک قابل جست‌وجویی منتشر نشده است."),
  ).toBeVisible();
});

test("answers the agreed FAQ questions with keyboard-operable disclosures", async () => {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderHomeShell(queryClient);

  const faq = screen.getByRole("region", { name: "پرسش‌های پرتکرار" });
  const questions = within(faq).getAllByRole("button");
  expect(questions).toHaveLength(6);
  expect(questions.map((question) => question.textContent)).toEqual([
    "چطور ملک جست‌وجو کنم؟",
    "چه نوع ملک‌هایی در ترب‌رنت پشتیبانی می‌شوند؟",
    "ترب‌رنت در چه شهرهایی فعال است؟",
    "آگهی‌ها چقدر تازه‌اند؟",
    "چرا ممکن است یک ملک چند آگهی داشته باشد؟",
    "چطور اطلاعات نادرست را گزارش کنم؟",
  ]);

  questions[0]?.focus();
  await user.keyboard("{Enter}");
  expect(questions[0]).toHaveAttribute("aria-expanded", "true");
  expect(
    within(faq).getByRole("link", { name: "راهنمای جست‌وجو" }),
  ).toHaveAttribute("href", "/guide");

  await user.click(questions[5]!);
  expect(within(faq).getByText(/درخواست پشتیبانی/)).toBeVisible();
  expect(
    within(faq).getByRole("link", { name: "تماس با پشتیبانی" }),
  ).toHaveAttribute("href", "/contact");
});

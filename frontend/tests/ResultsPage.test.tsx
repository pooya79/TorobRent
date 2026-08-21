import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { ResultsPage } from "@/pages/ResultsPage";
import { propertySearchPage } from "./fixtures/catalog";
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
  expect(requestedLocation).toBe("سعادت‌آباد");
  expect(screen.getByText("۲ آگهی فعال")).toBeVisible();
  expect(screen.getByText("۱۱۰ متر · ۲ خواب · ساخت ۱٬۴۰۰")).toBeVisible();
  expect(screen.getByText("ودیعه ۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان")).toBeVisible();
  expect(screen.getByText("اجاره ماهانه ۲۵٬۰۰۰٬۰۰۰ تومان")).toBeVisible();
});

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

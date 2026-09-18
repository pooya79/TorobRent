import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";

import { FavoritesPage } from "@/pages/FavoritesPage";
import { RenterAccessProvider } from "@/features/session/RenterAccessDialog";
import { propertySearchPage } from "./fixtures/catalog";
import { server } from "./server";

test("separates active and unavailable Favorites and removes either without reopening stale facts", async () => {
  const active = {
    ...propertySearchPage.results[0]!,
    is_favorite: true,
    saved_at: "2026-08-26T10:00:00Z",
  };
  const unavailable = {
    id: "17837713-bf6a-4c2e-8249-6ccb3cce7af2",
    title: "خانه در ونک",
    location: active.location,
    property_category: "residential" as const,
    property_category_label: "مسکونی",
    property_type: "house" as const,
    property_type_label: "خانه",
    area_sqm: 95,
    room_count: 2,
    saved_at: "2026-08-25T10:00:00Z",
  };
  const removed: string[] = [];
  server.use(
    http.get("*/api/v1/auth/session/", () =>
      HttpResponse.json({ authenticated: true, csrf_token: "favorite-token" }),
    ),
    http.get("*/api/v1/catalog/favorites/", () =>
      HttpResponse.json({ active: [active], unavailable: [unavailable] }),
    ),
    http.delete(
      "*/api/v1/catalog/properties/:propertyId/favorite/",
      ({ params }) => {
        removed.push(String(params.propertyId));
        return new HttpResponse(null, { status: 204 });
      },
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <RenterAccessProvider>
          <FavoritesPage />
        </RenterAccessProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const user = userEvent.setup();

  const activeSection = await screen.findByRole("region", {
    name: "ملک‌های در دسترس",
  });
  const unavailableSection = screen.getByRole("region", {
    name: "فعلاً آگهی فعال ندارند",
  });
  expect(
    within(activeSection).getByRole("link", { name: active.title }),
  ).toHaveAttribute("href", `/properties/${active.id}`);
  expect(within(activeSection).getByText(/اجاره ماهانه/)).toBeInTheDocument();
  expect(
    within(unavailableSection).queryByRole("link", { name: unavailable.title }),
  ).not.toBeInTheDocument();
  expect(
    within(unavailableSection).queryByText(/رهن|اجاره ماهانه/),
  ).not.toBeInTheDocument();

  await user.click(
    within(unavailableSection).getByRole("button", {
      name: `حذف ${unavailable.title} از علاقه‌مندی‌ها`,
    }),
  );
  expect(
    screen.queryByRole("region", { name: "فعلاً آگهی فعال ندارند" }),
  ).not.toBeInTheDocument();

  await user.click(
    within(activeSection).getByRole("button", {
      name: `حذف ${active.title} از علاقه‌مندی‌ها`,
    }),
  );
  expect(
    await screen.findByText("هنوز ملکی ذخیره نکرده‌اید"),
  ).toBeInTheDocument();
  expect(removed).toEqual([unavailable.id, active.id]);
});

function renderFavorites() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/favorites"]}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <RenterAccessProvider>
          <FavoritesPage />
        </RenterAccessProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

test("shows a useful empty state inside the account dashboard", async () => {
  server.use(
    http.get("*/api/v1/catalog/favorites/", () =>
      HttpResponse.json({ active: [], unavailable: [] }),
    ),
  );
  renderFavorites();
  expect(
    await screen.findByRole("heading", { name: "هنوز ملکی ذخیره نکرده‌اید" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "دیدن ملک‌ها" })).toHaveAttribute(
    "href",
    "/search",
  );
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
  const navigation = screen.getAllByRole("navigation", {
    name: "منوی حساب کاربری",
  })[0]!;
  expect(
    within(navigation).getByRole("link", { name: "علاقه‌مندی‌ها" }),
  ).toHaveAttribute("aria-current", "page");
});

test("retries a failed favorites request", async () => {
  let failed = true;
  server.use(
    http.get("*/api/v1/catalog/favorites/", () =>
      failed
        ? new HttpResponse(null, { status: 500 })
        : HttpResponse.json({ active: [], unavailable: [] }),
    ),
  );
  renderFavorites();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "علاقه‌مندی‌ها بارگذاری نشد.",
  );
  failed = false;
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "تلاش دوباره" }));
  expect(
    await screen.findByRole("heading", { name: "هنوز ملکی ذخیره نکرده‌اید" }),
  ).toBeInTheDocument();
});

test("keeps unavailable saves visible without claiming the collection is empty", async () => {
  server.use(
    http.get("*/api/v1/catalog/favorites/", () =>
      HttpResponse.json({
        active: [],
        unavailable: [
          {
            ...propertySearchPage.results[0]!,
            saved_at: "2026-09-18T10:00:00Z",
          },
        ],
      }),
    ),
  );
  renderFavorites();
  const section = await screen.findByRole("region", {
    name: "فعلاً آگهی فعال ندارند",
  });
  expect(within(section).getByRole("article")).toBeInTheDocument();
  expect(within(section).queryByRole("link")).not.toBeInTheDocument();
  expect(within(section).queryByText(/تومان/)).not.toBeInTheDocument();
  expect(
    screen.queryByText("هنوز ملکی ذخیره نکرده‌اید"),
  ).not.toBeInTheDocument();
});

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
    name: "فعلاً در دسترس نیست",
  });
  expect(
    within(activeSection).getByRole("link", { name: active.title }),
  ).toHaveAttribute("href", `/properties/${active.id}`);
  expect(within(activeSection).getByText(/اجاره ماهانه/)).toBeInTheDocument();
  expect(
    within(unavailableSection).queryByRole("link", { name: unavailable.title }),
  ).not.toBeInTheDocument();
  expect(
    within(unavailableSection).queryByText(/ودیعه|اجاره ماهانه/),
  ).not.toBeInTheDocument();

  await user.click(
    within(unavailableSection).getByRole("button", {
      name: `حذف ${unavailable.title} از علاقه‌مندی‌ها`,
    }),
  );
  expect(
    await screen.findByText("ملک ذخیره‌شده ناموجودی ندارید."),
  ).toBeInTheDocument();

  await user.click(
    within(activeSection).getByRole("button", {
      name: `حذف ${active.title} از علاقه‌مندی‌ها`,
    }),
  );
  expect(
    await screen.findByText("هنوز ملکی ذخیره نکرده‌اید."),
  ).toBeInTheDocument();
  expect(removed).toEqual([unavailable.id, active.id]);
});

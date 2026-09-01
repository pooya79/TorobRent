import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";

import {
  createFakeMapAdapter,
  type MapCluster,
  type MapMarker,
} from "@/features/map/adapter";
import { SearchMapPanel } from "@/features/map/SearchMapPanel";
import { RenterAccessProvider } from "@/features/session/RenterAccessDialog";

afterEach(() => vi.useRealTimers());

test("degrades compactly and retries the provider", async () => {
  const user = userEvent.setup();
  const onAvailabilityChange = vi.fn();
  const FakeMapAdapter = createFakeMapAdapter({ failAttempts: 1 });

  render(
    <SearchMapPanel
      adapter={FakeMapAdapter}
      markers={[]}
      clusters={[]}
      onAvailabilityChange={onAvailabilityChange}
    />,
  );

  expect(await screen.findByText("نقشه موقتاً در دسترس نیست")).toBeVisible();
  expect(onAvailabilityChange).toHaveBeenLastCalledWith(false);
  await user.click(
    screen.getByRole("button", { name: "تلاش دوباره برای نقشه" }),
  );

  expect(
    await screen.findByRole("application", { name: "نقشه تعاملی ملک‌ها" }),
  ).toBeVisible();
  expect(onAvailabilityChange).toHaveBeenLastCalledWith(true);
});

test("offers a keyboard-operable textual fallback for mapped Properties", async () => {
  const user = userEvent.setup();
  const FakeMapAdapter = createFakeMapAdapter();
  const marker: MapMarker = {
    propertyId: "property-1",
    label: "ودیعه و اجاره یک Active Listing",
    approximateLocation: {
      center: { latitude: 35.7665, longitude: 51.4749 },
      radiusMeters: 50,
      precision: "approximate",
    },
    preview: {
      title: "آپارتمان در سعادت‌آباد",
      locationLabel: "سعادت‌آباد، تهران",
      facts: ["آپارتمان", "۱۱۰ متر", "۲ خواب"],
      listingCountLabel: "۲ آگهی فعال",
      isFavorite: false,
      rentalTerms: {
        depositLabel: "۱٬۰۰۰٬۰۰۰٬۰۰۰ تومان",
        monthlyRentLabel: "۲۵٬۰۰۰٬۰۰۰ تومان",
      },
      detailHref: "/properties/property-1",
    },
  };

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <RenterAccessProvider>
          <SearchMapPanel
            adapter={FakeMapAdapter}
            markers={[marker]}
            clusters={[]}
          />
        </RenterAccessProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  await user.click(screen.getByText("فهرست دسترس‌پذیر نقشه"));
  await user.click(
    screen.getByRole("button", {
      name: "آپارتمان در سعادت‌آباد: ودیعه و اجاره یک Active Listing",
    }),
  );

  expect(
    screen.getByRole("link", { name: "مشاهده آپارتمان در سعادت‌آباد" }),
  ).toHaveAttribute("href", "/properties/property-1");
});

test("offers keyboard-operable cluster selection in the textual fallback", async () => {
  const user = userEvent.setup();
  const onSelectCluster = vi.fn();
  const FakeMapAdapter = createFakeMapAdapter();
  const cluster: MapCluster = {
    id: "cluster-1",
    center: { latitude: 35.7665, longitude: 51.4749 },
    bounds: {
      north: 35.77,
      east: 51.48,
      south: 35.76,
      west: 51.47,
    },
    propertyCount: 3,
    propertyIds: ["property-1", "property-2", "property-3"],
  };

  render(
    <SearchMapPanel
      adapter={FakeMapAdapter}
      markers={[]}
      clusters={[cluster]}
      onSelectCluster={onSelectCluster}
    />,
  );

  await user.click(screen.getByText("فهرست دسترس‌پذیر نقشه"));
  await user.click(screen.getByRole("button", { name: "نمایش خوشه ۳ ملک" }));

  expect(onSelectCluster).toHaveBeenCalledWith("cluster-1");
});

test("automatically retries without requiring Renter action", () => {
  vi.useFakeTimers();
  const FakeMapAdapter = createFakeMapAdapter({ failAttempts: 1 });

  render(
    <SearchMapPanel adapter={FakeMapAdapter} markers={[]} clusters={[]} />,
  );

  expect(screen.getByText("نقشه موقتاً در دسترس نیست")).toBeVisible();

  void act(() => vi.advanceTimersByTime(5_000));

  expect(
    screen.getByRole("application", { name: "نقشه تعاملی ملک‌ها" }),
  ).toBeVisible();
});

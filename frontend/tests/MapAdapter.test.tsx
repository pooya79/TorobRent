import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import {
  createFakeMapAdapter,
  formatMapPrice,
  type MapMarker,
} from "@/features/map/adapter";
import { NeshanMapAdapter } from "@/features/map/NeshanMapAdapter";
import { OpenStreetMapAdapter } from "@/features/map/OpenStreetMapAdapter";

const marker: MapMarker = {
  propertyId: "property-1",
  label: "ودیعه ۱ میلیارد، اجاره ۲۵ میلیون تومان",
  mapPrices: { deposit: "۱", monthlyRent: "۲۵" },
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

test.each([
  [25_000_000, "۲۵"],
  [950_000_000, "۹۵۰"],
  [1_000_000_000, "۱"],
  [3_500_000_000, "۳٫۵"],
])("formats %i toman as a compact map price", (value, expected) => {
  expect(formatMapPrice(value)).toBe(expected);
});

test("the fake adapter deterministically exposes the TorobRent map contract", async () => {
  const user = userEvent.setup();
  const onReady = vi.fn();
  const onViewportChange = vi.fn();
  const onSelectProperty = vi.fn();
  const onPreviewProperty = vi.fn();
  const onSelectCluster = vi.fn();
  const FakeMapAdapter = createFakeMapAdapter();

  render(
    <FakeMapAdapter
      initialViewport={{
        north: 35.82,
        east: 51.52,
        south: 35.65,
        west: 51.25,
        zoom: 11,
      }}
      markers={[marker]}
      clusters={[
        {
          id: "cluster-1",
          center: { latitude: 35.75, longitude: 51.4 },
          bounds: {
            north: 35.76,
            east: 51.41,
            south: 35.74,
            west: 51.39,
          },
          propertyCount: 7,
          propertyIds: ["property-1"],
        },
      ]}
      selectedPropertyId={null}
      retryToken={0}
      onReady={onReady}
      onError={vi.fn()}
      onViewportChange={onViewportChange}
      onSelectProperty={onSelectProperty}
      onPreviewProperty={onPreviewProperty}
      onSelectCluster={onSelectCluster}
    />,
  );

  expect(onReady).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("application", { name: "نقشه تعاملی ملک‌ها" }),
  ).toBeVisible();
  expect(screen.getByText("محدوده تقریبی ۵۰ متر")).toBeVisible();
  expect(screen.getByText("۱", { exact: false })).toHaveTextContent("۱|۲۵");

  await user.click(
    screen.getByRole("button", {
      name: `انتخاب ${marker.preview.title}، ${marker.label}`,
    }),
  );
  expect(onSelectProperty).toHaveBeenCalledWith("property-1");
  expect(onPreviewProperty).toHaveBeenCalledWith("property-1");
  expect(onViewportChange).toHaveBeenCalledWith(
    expect.objectContaining({ zoom: 11 }),
    "programmatic",
  );

  await user.click(screen.getByRole("button", { name: "خوشه ۷ ملک" }));
  expect(onSelectCluster).toHaveBeenCalledWith("cluster-1");
  expect(onViewportChange).toHaveBeenCalledWith(
    expect.objectContaining({ zoom: 13 }),
    "user",
  );

  await user.click(
    screen.getByRole("button", { name: "تغییر محدوده آزمایشی" }),
  );
  expect(onViewportChange).toHaveBeenCalledWith(
    expect.objectContaining({ zoom: 12 }),
    "user",
  );
});

test("the fake adapter can reproduce a provider initialization failure", () => {
  const onError = vi.fn();
  const FakeMapAdapter = createFakeMapAdapter({ failAttempts: 1 });

  render(
    <FakeMapAdapter
      initialViewport={{
        north: 35.82,
        east: 51.52,
        south: 35.65,
        west: 51.25,
        zoom: 11,
      }}
      markers={[]}
      clusters={[]}
      selectedPropertyId={null}
      retryToken={0}
      onReady={vi.fn()}
      onError={onError}
      onViewportChange={vi.fn()}
      onSelectProperty={vi.fn()}
      onPreviewProperty={vi.fn()}
      onSelectCluster={vi.fn()}
    />,
  );

  expect(onError).toHaveBeenCalledWith(
    expect.objectContaining({ code: "provider-unavailable" }),
  );
});

test("the fake adapter constrains user and programmatic viewport movement", async () => {
  const user = userEvent.setup();
  const onViewportChange = vi.fn();
  const FakeMapAdapter = createFakeMapAdapter();

  render(
    <FakeMapAdapter
      initialViewport={{
        north: 36.5,
        east: 52.4,
        south: 36.1,
        west: 52,
        zoom: 8,
      }}
      viewConstraints={{
        bounds: { north: 36, east: 52, south: 35, west: 51 },
        minZoom: 10,
      }}
      markers={[marker]}
      clusters={[
        {
          id: "outside-cluster",
          center: { latitude: 36.9, longitude: 52.9 },
          bounds: { north: 37, east: 53, south: 36.8, west: 52.8 },
          propertyCount: 3,
          propertyIds: ["property-1", "property-2", "property-3"],
        },
      ]}
      selectedPropertyId={null}
      retryToken={0}
      onReady={vi.fn()}
      onError={vi.fn()}
      onViewportChange={onViewportChange}
      onSelectProperty={vi.fn()}
      onPreviewProperty={vi.fn()}
      onSelectCluster={vi.fn()}
    />,
  );

  await user.click(
    screen.getByRole("button", {
      name: `انتخاب ${marker.preview.title}، ${marker.label}`,
    }),
  );
  expect(onViewportChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      north: 36.2,
      east: 52.2,
      south: 35.8,
      west: 51.8,
      zoom: 10,
    }),
    "programmatic",
  );

  await user.click(
    screen.getByRole("button", { name: "تغییر محدوده آزمایشی" }),
  );
  expect(onViewportChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ zoom: 11 }),
    "user",
  );

  await user.click(screen.getByRole("button", { name: "خوشه ۳ ملک" }));
  expect(onViewportChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      north: 36.1,
      east: 52.1,
      south: 35.9,
      west: 51.9,
      zoom: 12,
    }),
    "user",
  );
});

test("the production adapter owns and preserves Neshan attribution", () => {
  render(
    <NeshanMapAdapter
      initialViewport={{
        north: 35.82,
        east: 51.52,
        south: 35.65,
        west: 51.25,
        zoom: 11,
      }}
      markers={[]}
      clusters={[]}
      selectedPropertyId={null}
      retryToken={0}
      onReady={vi.fn()}
      onError={vi.fn()}
      onViewportChange={vi.fn()}
      onSelectProperty={vi.fn()}
      onPreviewProperty={vi.fn()}
      onSelectCluster={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("link", { name: "داده‌های نقشه © نشان" }),
  ).toBeVisible();
});

test("the open-source adapter owns and preserves OpenStreetMap attribution", () => {
  render(
    <OpenStreetMapAdapter
      initialViewport={{
        north: 35.82,
        east: 51.52,
        south: 35.65,
        west: 51.25,
        zoom: 11,
      }}
      markers={[]}
      clusters={[]}
      selectedPropertyId={null}
      retryToken={0}
      onReady={vi.fn()}
      onError={vi.fn()}
      onViewportChange={vi.fn()}
      onSelectProperty={vi.fn()}
      onPreviewProperty={vi.fn()}
      onSelectCluster={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("link", { name: "داده‌های نقشه © OpenStreetMap" }),
  ).toBeVisible();
});

test("the production adapter exposes keyboard-selectable Property markers", async () => {
  const user = userEvent.setup();
  const onSelectProperty = vi.fn();
  const onPreviewProperty = vi.fn();

  render(
    <NeshanMapAdapter
      initialViewport={{
        north: 35.82,
        east: 51.52,
        south: 35.65,
        west: 51.25,
        zoom: 14,
      }}
      markers={[marker]}
      clusters={[]}
      selectedPropertyId={null}
      retryToken={0}
      onReady={vi.fn()}
      onError={vi.fn()}
      onViewportChange={vi.fn()}
      onSelectProperty={onSelectProperty}
      onPreviewProperty={onPreviewProperty}
      onSelectCluster={vi.fn()}
    />,
  );

  expect(screen.getByText("انتخاب ملک از فهرست نقشه")).toBeVisible();
  await user.click(
    screen.getByRole("button", {
      name: `انتخاب ${marker.preview.title} با صفحه‌کلید`,
    }),
  );
  expect(onSelectProperty).toHaveBeenCalledWith(marker.propertyId);
  expect(onPreviewProperty).toHaveBeenCalledWith(marker.propertyId);
});

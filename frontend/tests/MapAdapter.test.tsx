import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import {
  createFakeMapAdapter,
  type MapMarker,
} from "@/features/map/adapter";
import { NeshanMapAdapter } from "@/features/map/NeshanMapAdapter";
import { OpenStreetMapAdapter } from "@/features/map/OpenStreetMapAdapter";

const marker: MapMarker = {
  propertyId: "property-1",
  label: "ودیعه ۱ میلیارد، اجاره ۲۵ میلیون تومان",
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

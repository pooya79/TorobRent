import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import {
  createFakeMapAdapter,
  type MapAdapterProps,
} from "@/features/map/adapter";
import { PropertyLocationMap } from "@/features/map/PropertyLocationMap";
import { propertyDetail } from "./fixtures/catalog";

const FakeMap = createFakeMapAdapter();
test("centers and selects the public approximate location and can recenter", async () => {
  const calls: MapAdapterProps[] = [];
  function InspectMap(props: MapAdapterProps) {
    calls.push(props);
    return <FakeMap {...props} />;
  }
  render(
    <PropertyLocationMap property={propertyDetail} adapter={InspectMap} />,
  );
  const initial = calls[0]!;
  expect(initial.markers).toHaveLength(1);
  expect(initial.selectedPropertyId).toBe(propertyDetail.id);
  expect(initial.markers[0]!.approximateLocation).toEqual({
    center: { latitude: 35.7718, longitude: 51.3812 },
    radiusMeters: 50,
    precision: "approximate",
  });
  expect(
    (initial.initialViewport.north + initial.initialViewport.south) / 2,
  ).toBeCloseTo(35.7718);
  expect(
    (initial.initialViewport.east + initial.initialViewport.west) / 2,
  ).toBeCloseTo(51.3812);
  expect(screen.getByText(/نشانگر، نشانی دقیق ساختمان نیست/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "بازگشت به ملک" }));
  expect(calls.at(-1)!.retryToken).toBe(1);
});

test("keeps missing coordinates explicit without rendering an invented marker", () => {
  render(
    <PropertyLocationMap
      property={{ ...propertyDetail, approximate_location: null }}
      adapter={FakeMap}
    />,
  );
  expect(screen.queryByRole("application")).not.toBeInTheDocument();
  expect(
    screen.getByText(/موقعیت این ملک هنوز روی نقشه ثبت نشده است/),
  ).toBeVisible();
});

test("identifies neighborhood precision and uses a wider view", () => {
  let zoom = 0;
  function InspectMap(props: MapAdapterProps) {
    zoom = props.initialViewport.zoom;
    return <FakeMap {...props} />;
  }
  render(
    <PropertyLocationMap
      property={{
        ...propertyDetail,
        approximate_location: {
          ...propertyDetail.approximate_location!,
          precision: "neighborhood",
          radius_meters: 1000,
        },
      }}
      adapter={InspectMap}
    />,
  );
  expect(screen.getByText(/موقعیت ساختمان مشخص نیست/)).toBeVisible();
  expect(zoom).toBeLessThan(16);
});

test("recovers from a provider failure with a manual retry", async () => {
  const FailingMap = createFakeMapAdapter({ failAttempts: 1 });
  render(
    <PropertyLocationMap property={propertyDetail} adapter={FailingMap} />,
  );
  expect(screen.getByText("نقشه موقتاً در دسترس نیست")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "تلاش دوباره برای نقشه" }),
  );
  expect(await screen.findByRole("application")).toBeVisible();
});

import { render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { MapAdapterProps } from "@/features/map/adapter";

const viewConstructors = vi.hoisted(() => ({
  neshan: vi.fn<(options: unknown) => void>(),
  openStreetMap: vi.fn<(options: unknown) => void>(),
}));

vi.mock("@/features/map/environment", () => ({
  neshanMapKey: "test-neshan-key",
  openStreetMapTileUrl: "https://tiles.invalid/{z}/{x}/{y}.png",
}));
vi.mock("ol/View.js", () => ({
  default: class OpenStreetMapView {
    constructor(options: unknown) {
      viewConstructors.openStreetMap(options);
    }
  },
}));
vi.mock("@neshan-maps-platform/ol/View", () => ({
  default: class NeshanView {
    constructor(options: unknown) {
      viewConstructors.neshan(options);
    }
  },
}));

import { NeshanMapAdapter } from "@/features/map/NeshanMapAdapter";
import { OpenStreetMapAdapter } from "@/features/map/OpenStreetMapAdapter";

const adapterProps: MapAdapterProps = {
  initialViewport: {
    north: 35.82,
    east: 51.52,
    south: 35.65,
    west: 51.25,
    zoom: 8,
  },
  viewConstraints: {
    bounds: { north: 36, east: 52, south: 35, west: 51 },
    minZoom: 10,
  },
  markers: [],
  clusters: [],
  selectedPropertyId: null,
  retryToken: 0,
  onReady: vi.fn(),
  onError: vi.fn(),
  onViewportChange: vi.fn(),
  onSelectProperty: vi.fn(),
  onPreviewProperty: vi.fn(),
  onSelectCluster: vi.fn(),
};

test("both real adapters give their provider an equivalent constrained view", async () => {
  render(
    <>
      <OpenStreetMapAdapter {...adapterProps} />
      <NeshanMapAdapter {...adapterProps} />
    </>,
  );

  await waitFor(() => {
    expect(viewConstructors.openStreetMap).toHaveBeenCalledOnce();
    expect(viewConstructors.neshan).toHaveBeenCalledOnce();
  });
  const openStreetMapOptions =
    viewConstructors.openStreetMap.mock.calls[0]?.[0];
  const neshanOptions = viewConstructors.neshan.mock.calls[0]?.[0];
  expect(openStreetMapOptions).toMatchObject({
    minZoom: 10,
    constrainOnlyCenter: true,
    smoothExtentConstraint: false,
    smoothResolutionConstraint: false,
    multiWorld: false,
  });
  expect(neshanOptions).toEqual(openStreetMapOptions);
});

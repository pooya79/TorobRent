import { expect, test } from "vitest";

import {
  constrainMapViewport,
  mapViewportCanBeConstrained,
  isValidMapViewport,
  tehranSearchViewConstraints,
} from "@/features/map/view-constraints";

test("clamps an outside map center and zoom to the Tehran Search Boundary", () => {
  const constrained = constrainMapViewport(
    {
      north: 36.5,
      east: 52.4,
      south: 36.1,
      west: 52,
      zoom: 8,
    },
    {
      bounds: { north: 36, east: 52, south: 35, west: 51 },
      minZoom: 10,
    },
  );

  expect(constrained.north).toBeCloseTo(36.2);
  expect(constrained.east).toBeCloseTo(52.2);
  expect(constrained.south).toBeCloseTo(35.8);
  expect(constrained.west).toBeCloseTo(51.8);
  expect(constrained.zoom).toBe(10);
});

test("preserves a valid viewport whose center and zoom satisfy the constraints", () => {
  const viewport = {
    north: 35.8,
    east: 51.5,
    south: 35.7,
    west: 51.3,
    zoom: 13,
  };

  expect(constrainMapViewport(viewport, tehranSearchViewConstraints)).toEqual(
    viewport,
  );
});

test.each([
  { north: 91, east: 51.5, south: 35.7, west: 51.3, zoom: 13 },
  { north: 35.8, east: 181, south: 35.7, west: 51.3, zoom: 13 },
  { north: 35.7, east: 51.5, south: 35.8, west: 51.3, zoom: 13 },
  { north: 35.8, east: 51.3, south: 35.7, west: 51.5, zoom: 13 },
  { north: 35.8, east: 51.5, south: 35.7, west: 51.3, zoom: -1 },
] as const)("rejects an invalid map viewport: $north,$east", (viewport) => {
  expect(isValidMapViewport(viewport)).toBe(false);
});

test("rejects a world-scale viewport whose span cannot be preserved around Tehran", () => {
  expect(
    mapViewportCanBeConstrained(
      {
        north: 90,
        east: 180,
        south: -80,
        west: -170,
        zoom: 0,
      },
      tehranSearchViewConstraints,
    ),
  ).toBe(false);
});

export type MapViewport = {
  north: number;
  east: number;
  south: number;
  west: number;
  zoom: number;
};

export type MapViewConstraints = {
  bounds: Omit<MapViewport, "zoom">;
  minZoom: number;
};

export const tehranInitialViewport: MapViewport = {
  north: 35.82,
  east: 51.52,
  south: 35.65,
  west: 51.25,
  zoom: 10,
};

export const tehranSearchViewConstraints: MapViewConstraints = {
  bounds: {
    north: 35.846495,
    east: 51.628331,
    south: 35.550177,
    west: 51.066861,
  },
  minZoom: 10,
};

type CoordinateProjector = (coordinates: [number, number]) => number[];

type MapViewOptions = {
  center: number[];
  zoom: number;
  extent?: [number, number, number, number];
  minZoom?: number;
  constrainOnlyCenter?: boolean;
  smoothExtentConstraint?: boolean;
  smoothResolutionConstraint?: boolean;
  multiWorld?: boolean;
};

export function mapViewOptions(
  initialViewport: MapViewport,
  constraints: MapViewConstraints | undefined,
  project: CoordinateProjector,
): MapViewOptions {
  const center = project([
    (initialViewport.east + initialViewport.west) / 2,
    (initialViewport.north + initialViewport.south) / 2,
  ]);
  if (!constraints) return { center, zoom: initialViewport.zoom };

  const southWest = project([
    constraints.bounds.west,
    constraints.bounds.south,
  ]);
  const northEast = project([
    constraints.bounds.east,
    constraints.bounds.north,
  ]);
  const [west, south] = southWest;
  const [east, north] = northEast;
  if (
    west === undefined ||
    south === undefined ||
    east === undefined ||
    north === undefined
  ) {
    throw new TypeError(
      "The map coordinate projector returned an invalid extent",
    );
  }

  return {
    center,
    zoom: Math.max(initialViewport.zoom, constraints.minZoom),
    extent: [west, south, east, north],
    minZoom: constraints.minZoom,
    constrainOnlyCenter: true,
    smoothExtentConstraint: false,
    smoothResolutionConstraint: false,
    multiWorld: false,
  };
}

export function isValidMapViewport(viewport: MapViewport) {
  return (
    Object.values(viewport).every(Number.isFinite) &&
    viewport.north <= 90 &&
    viewport.south >= -90 &&
    viewport.east <= 180 &&
    viewport.west >= -180 &&
    viewport.north > viewport.south &&
    viewport.east > viewport.west &&
    viewport.zoom >= 0
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function mapViewportCanBeConstrained(
  viewport: MapViewport,
  constraints: MapViewConstraints,
) {
  if (!isValidMapViewport(viewport)) return false;
  const halfLatitudeSpan = (viewport.north - viewport.south) / 2;
  const halfLongitudeSpan = (viewport.east - viewport.west) / 2;
  const minimumLatitudeCenter = Math.max(
    constraints.bounds.south,
    -90 + halfLatitudeSpan,
  );
  const maximumLatitudeCenter = Math.min(
    constraints.bounds.north,
    90 - halfLatitudeSpan,
  );
  const minimumLongitudeCenter = Math.max(
    constraints.bounds.west,
    -180 + halfLongitudeSpan,
  );
  const maximumLongitudeCenter = Math.min(
    constraints.bounds.east,
    180 - halfLongitudeSpan,
  );
  return (
    minimumLatitudeCenter <= maximumLatitudeCenter &&
    minimumLongitudeCenter <= maximumLongitudeCenter
  );
}

export function constrainMapViewport(
  viewport: MapViewport,
  constraints: MapViewConstraints,
): MapViewport {
  if (!mapViewportCanBeConstrained(viewport, constraints)) {
    throw new RangeError(
      "The map viewport span cannot be preserved inside the constraints",
    );
  }
  const halfLatitudeSpan = (viewport.north - viewport.south) / 2;
  const halfLongitudeSpan = (viewport.east - viewport.west) / 2;
  const latitudeCenter = clamp(
    (viewport.north + viewport.south) / 2,
    Math.max(constraints.bounds.south, -90 + halfLatitudeSpan),
    Math.min(constraints.bounds.north, 90 - halfLatitudeSpan),
  );
  const longitudeCenter = clamp(
    (viewport.east + viewport.west) / 2,
    Math.max(constraints.bounds.west, -180 + halfLongitudeSpan),
    Math.min(constraints.bounds.east, 180 - halfLongitudeSpan),
  );

  return {
    north: latitudeCenter + halfLatitudeSpan,
    east: longitudeCenter + halfLongitudeSpan,
    south: latitudeCenter - halfLatitudeSpan,
    west: longitudeCenter - halfLongitudeSpan,
    zoom: Math.max(viewport.zoom, constraints.minZoom),
  };
}

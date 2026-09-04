import { useEffect, type ComponentType } from "react";

import {
  constrainMapViewport,
  type MapViewConstraints,
  type MapViewport,
} from "./view-constraints";

export type { MapViewConstraints, MapViewport } from "./view-constraints";

export type MapCoordinates = {
  latitude: number;
  longitude: number;
};

export type ApproximateLocation = {
  center: MapCoordinates;
  radiusMeters: number;
  precision: "approximate" | "neighborhood";
};

export type MapPropertyPreview = {
  title: string;
  locationLabel: string;
  facts: readonly string[];
  image?: { url: string; width: number; height: number };
  listingCountLabel: string;
  isFavorite: boolean;
  rentalTerms: {
    depositLabel: string;
    monthlyRentLabel: string;
  };
  detailHref: string;
};

export type MapMarker = {
  propertyId: string;
  label: string;
  mapPrices: {
    deposit: string;
    monthlyRent: string;
  };
  approximateLocation: ApproximateLocation;
  preview: MapPropertyPreview;
};

export type MapCluster = {
  id: string;
  center: MapCoordinates;
  bounds: Omit<MapViewport, "zoom">;
  propertyCount: number;
  propertyIds: readonly string[];
};

export function markerLabelIsVisible() {
  return true;
}

export class MapProviderError extends Error {
  readonly code = "provider-unavailable";

  constructor(message = "Map provider unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "MapProviderError";
  }
}

export type MapAdapterProps = {
  initialViewport: MapViewport;
  viewConstraints?: MapViewConstraints;
  markers: readonly MapMarker[];
  clusters: readonly MapCluster[];
  selectedPropertyId: string | null;
  retryToken: number;
  onReady: () => void;
  onError: (error: MapProviderError) => void;
  onViewportChange: (
    viewport: MapViewport,
    origin: "user" | "programmatic",
  ) => void;
  onSelectProperty: (propertyId: string) => void;
  onPreviewProperty: (propertyId: string) => void;
  onSelectCluster: (clusterId: string) => void;
};

export type MapAdapter = ComponentType<MapAdapterProps>;

type FakeMapAdapterOptions = {
  failAttempts?: number;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

export function formatMapPrice(valueInToman: number) {
  const divisor = valueInToman >= 1_000_000_000 ? 1_000_000_000 : 1_000_000;
  return new Intl.NumberFormat("fa-IR", {
    maximumFractionDigits: 1,
  }).format(valueInToman / divisor);
}

export function createFakeMapAdapter({
  failAttempts = 0,
}: FakeMapAdapterOptions = {}): MapAdapter {
  function FakeMapAdapter({
    initialViewport,
    viewConstraints,
    markers,
    clusters,
    selectedPropertyId,
    retryToken,
    onReady,
    onError,
    onViewportChange,
    onSelectProperty,
    onPreviewProperty,
    onSelectCluster,
  }: MapAdapterProps) {
    const effectiveInitialViewport = viewConstraints
      ? constrainMapViewport(initialViewport, viewConstraints)
      : initialViewport;
    const moveEast = () => {
      const shiftedViewport = {
        ...effectiveInitialViewport,
        east: effectiveInitialViewport.east + 1,
        west: effectiveInitialViewport.west + 1,
      };
      onViewportChange(
        viewConstraints
          ? constrainMapViewport(shiftedViewport, viewConstraints)
          : shiftedViewport,
        "user",
      );
    };
    useEffect(() => {
      if (retryToken < failAttempts) {
        onError(new MapProviderError("Deterministic fake provider failure"));
        return;
      }
      onReady();
    }, [onError, onReady, retryToken]);

    if (retryToken < failAttempts) return null;

    return (
      <div
        role="application"
        aria-label="نقشه تعاملی ملک‌ها"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            moveEast();
          }
        }}
        className="bg-muted relative h-full min-h-80 overflow-hidden rounded-xl p-4"
      >
        <button
          type="button"
          className="sr-only"
          onClick={() =>
            onViewportChange(
              {
                ...effectiveInitialViewport,
                zoom: effectiveInitialViewport.zoom + 1,
              },
              "user",
            )
          }
        >
          تغییر محدوده آزمایشی
        </button>
        {markers.map((marker) => (
          <div key={marker.propertyId}>
            <button
              type="button"
              className="relative flex h-7 items-center justify-center rounded-md bg-[#e00b41] px-2 text-[11px] font-bold text-white after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-x-4 after:border-t-4 after:border-x-transparent after:border-t-[#e00b41] after:content-['']"
              aria-label={`انتخاب ${marker.preview.title}، ${marker.label.replace("\n", "، ")}`}
              aria-pressed={selectedPropertyId === marker.propertyId}
              onClick={() => {
                onSelectProperty(marker.propertyId);
                onPreviewProperty(marker.propertyId);
                onViewportChange(effectiveInitialViewport, "programmatic");
              }}
            >
              <span aria-hidden="true" dir="ltr">
                {marker.mapPrices.deposit}
                <span className="mx-1 opacity-60">|</span>
                {marker.mapPrices.monthlyRent}
              </span>
            </button>
            <p>
              {marker.approximateLocation.precision === "approximate"
                ? `محدوده تقریبی ${formatNumber(marker.approximateLocation.radiusMeters)} متر`
                : "موقعیت تقریبی در سطح محله"}
            </p>
          </div>
        ))}
        {clusters.map((cluster) => (
          <button
            key={cluster.id}
            type="button"
            onClick={() => {
              onSelectCluster(cluster.id);
              const clusterViewport = {
                ...cluster.bounds,
                zoom: effectiveInitialViewport.zoom + 2,
              };
              onViewportChange(
                viewConstraints
                  ? constrainMapViewport(clusterViewport, viewConstraints)
                  : clusterViewport,
                "user",
              );
            }}
          >
            خوشه {formatNumber(cluster.propertyCount)} ملک
          </button>
        ))}
      </div>
    );
  }

  FakeMapAdapter.displayName = "FakeMapAdapter";
  return FakeMapAdapter;
}

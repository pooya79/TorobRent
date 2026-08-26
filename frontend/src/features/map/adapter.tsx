import { useEffect, type ComponentType } from "react";

export type MapCoordinates = {
  latitude: number;
  longitude: number;
};

export type MapViewport = {
  north: number;
  east: number;
  south: number;
  west: number;
  zoom: number;
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
  approximateLocation: ApproximateLocation;
  preview: MapPropertyPreview;
};

export type MapCluster = {
  id: string;
  center: MapCoordinates;
  propertyCount: number;
  propertyIds: readonly string[];
};

export class MapProviderError extends Error {
  readonly code = "provider-unavailable";

  constructor(message = "Map provider unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "MapProviderError";
  }
}

export type MapAdapterProps = {
  initialViewport: MapViewport;
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

export function createFakeMapAdapter({
  failAttempts = 0,
}: FakeMapAdapterOptions = {}): MapAdapter {
  function FakeMapAdapter({
    initialViewport,
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
        className="bg-muted relative h-full min-h-80 overflow-hidden rounded-xl p-4"
      >
        <button
          type="button"
          className="sr-only"
          onClick={() =>
            onViewportChange(
              {
                ...initialViewport,
                zoom: initialViewport.zoom + 1,
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
              className="whitespace-pre-line"
              aria-label={`انتخاب ${marker.preview.title}، ${marker.label.replace("\n", "، ")}`}
              aria-pressed={selectedPropertyId === marker.propertyId}
              onClick={() => {
                onSelectProperty(marker.propertyId);
                onPreviewProperty(marker.propertyId);
                onViewportChange(initialViewport, "programmatic");
              }}
            >
              {marker.label}
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
              onViewportChange(
                {
                  ...initialViewport,
                  zoom: initialViewport.zoom + 2,
                },
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

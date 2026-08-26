import { MapPin } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  type MapAdapter,
  type MapCluster,
  type MapMarker,
  type MapViewport,
} from "./adapter";

const tehranViewport: MapViewport = {
  north: 35.82,
  east: 51.52,
  south: 35.65,
  west: 51.25,
  zoom: 11,
};

type SearchMapPanelProps = {
  adapter: MapAdapter;
  markers: readonly MapMarker[];
  clusters: readonly MapCluster[];
  initialViewport?: MapViewport;
  onViewportChange?: (viewport: MapViewport) => void;
  onSelectCluster?: (clusterId: string) => void;
  onAvailabilityChange?: (available: boolean) => void;
};

export function SearchMapPanel({
  adapter: Adapter,
  markers,
  clusters,
  initialViewport = tehranViewport,
  onViewportChange,
  onSelectCluster,
  onAvailabilityChange,
}: SearchMapPanelProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [retryToken, setRetryToken] = useState(0);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(
    null,
  );
  const [previewPropertyId, setPreviewPropertyId] = useState<string | null>(
    null,
  );
  const preview = useMemo(
    () =>
      markers.find((marker) => marker.propertyId === previewPropertyId)
        ?.preview,
    [markers, previewPropertyId],
  );

  useEffect(() => {
    if (status !== "loading") {
      onAvailabilityChange?.(status === "ready");
    }
  }, [onAvailabilityChange, status]);

  const retry = useCallback(() => {
    setStatus("loading");
    setRetryToken((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    if (status !== "error") return;
    const timer = window.setTimeout(retry, 5_000);
    return () => window.clearTimeout(timer);
  }, [retry, status]);

  const handleReady = useCallback(() => setStatus("ready"), []);
  const handleError = useCallback(() => setStatus("error"), []);
  const handleSelectProperty = useCallback(
    (propertyId: string) => setSelectedPropertyId(propertyId),
    [],
  );
  const handlePreviewProperty = useCallback(
    (propertyId: string) => setPreviewPropertyId(propertyId),
    [],
  );
  const handleSelectCluster = useCallback(
    (clusterId: string) => {
      setPreviewPropertyId(null);
      onSelectCluster?.(clusterId);
    },
    [onSelectCluster],
  );
  const handleViewportChange = useCallback(
    (viewport: MapViewport) => onViewportChange?.(viewport),
    [onViewportChange],
  );

  return (
    <section aria-label="نقشه ملک‌ها" className="relative">
      <h2 className="sr-only">نقشه ملک‌های پیدا شده</h2>
      {status === "error" ? (
        <Alert className="py-3" aria-live="polite">
          <MapPin aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>نقشه موقتاً در دسترس نیست</span>
            <Button type="button" size="sm" variant="outline" onClick={retry}>
              تلاش دوباره برای نقشه
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="relative min-h-80 overflow-hidden rounded-xl border">
          <Suspense fallback={null}>
            <Adapter
              initialViewport={initialViewport}
              markers={markers}
              clusters={clusters}
              selectedPropertyId={selectedPropertyId}
              retryToken={retryToken}
              onReady={handleReady}
              onError={handleError}
              onViewportChange={handleViewportChange}
              onSelectProperty={handleSelectProperty}
              onPreviewProperty={handlePreviewProperty}
              onSelectCluster={handleSelectCluster}
            />
          </Suspense>
          {status === "loading" && (
            <p
              className="bg-background/90 absolute inset-x-3 top-3 rounded-lg px-3 py-2 text-sm"
              aria-live="polite"
            >
              در حال آماده‌سازی نقشه
            </p>
          )}
          {preview && (
            <aside className="bg-card absolute inset-x-3 bottom-8 rounded-xl border p-4 shadow-lg">
              <Link className="font-semibold" to={preview.detailHref}>
                {preview.title}
              </Link>
              <p className="text-muted-foreground mt-1 text-sm">
                {preview.locationLabel}
              </p>
            </aside>
          )}
        </div>
      )}
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer">فهرست دسترس‌پذیر نقشه</summary>
        <div className="mt-2 space-y-2 rounded-lg border p-3">
          {markers.length === 0 && clusters.length === 0 ? (
            <p className="text-muted-foreground">
              ملکی دارای موقعیت برای نمایش روی نقشه نیست.
            </p>
          ) : (
            <>
              {markers.map((marker) => (
                <Button
                  key={marker.propertyId}
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-pressed={selectedPropertyId === marker.propertyId}
                  onClick={() => {
                    handleSelectProperty(marker.propertyId);
                    handlePreviewProperty(marker.propertyId);
                  }}
                >
                  {marker.preview.title}: {marker.label}
                </Button>
              ))}
              {clusters.map((cluster) => (
                <Button
                  key={cluster.id}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleSelectCluster(cluster.id)}
                >
                  نمایش خوشه{" "}
                  {new Intl.NumberFormat("fa-IR").format(cluster.propertyCount)}{" "}
                  ملک
                </Button>
              ))}
            </>
          )}
        </div>
      </details>
    </section>
  );
}

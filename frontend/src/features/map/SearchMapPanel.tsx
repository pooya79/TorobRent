import { Building2, MapPin, X } from "lucide-react";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FavoriteButton } from "@/features/catalog/FavoriteButton";
import {
  type MapAdapter,
  type MapCluster,
  type MapMarker,
  type MapViewport,
} from "./adapter";

export const tehranViewport: MapViewport = {
  north: 35.82,
  east: 51.52,
  south: 35.65,
  west: 51.25,
  zoom: 10,
};

type SearchMapPanelProps = {
  adapter: MapAdapter;
  markers: readonly MapMarker[];
  clusters: readonly MapCluster[];
  initialViewport?: MapViewport;
  onViewportChange?: (viewport: MapViewport) => void;
  onSelectCluster?: (clusterId: string) => void;
  selectedPropertyId?: string | null;
  onSelectProperty?: (propertyId: string) => void;
  onAvailabilityChange?: (available: boolean) => void;
};

export function SearchMapPanel({
  adapter: Adapter,
  markers,
  clusters,
  initialViewport = tehranViewport,
  onViewportChange,
  onSelectCluster,
  selectedPropertyId: controlledSelectedPropertyId,
  onSelectProperty,
  onAvailabilityChange,
}: SearchMapPanelProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [retryToken, setRetryToken] = useState(0);
  const [internalSelectedPropertyId, setInternalSelectedPropertyId] = useState<
    string | null
  >(null);
  const selectedPropertyId =
    controlledSelectedPropertyId === undefined
      ? internalSelectedPropertyId
      : controlledSelectedPropertyId;
  const [previewPropertyId, setPreviewPropertyId] = useState<string | null>(
    null,
  );
  const previewTrigger = useRef<HTMLElement | null>(null);
  const previewPanel = useRef<HTMLElement | null>(null);
  const preview = useMemo(
    () =>
      markers.find((marker) => marker.propertyId === previewPropertyId)
        ?.preview,
    [markers, previewPropertyId],
  );

  useEffect(() => {
    if (previewPropertyId) previewPanel.current?.focus();
  }, [previewPropertyId]);

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
    (propertyId: string) => {
      setInternalSelectedPropertyId(propertyId);
      onSelectProperty?.(propertyId);
    },
    [onSelectProperty],
  );
  const handlePreviewProperty = useCallback((propertyId: string) => {
    previewTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setPreviewPropertyId(propertyId);
  }, []);
  const closePreview = useCallback(() => {
    setPreviewPropertyId(null);
    previewTrigger.current?.focus();
  }, []);
  const handleSelectCluster = useCallback(
    (clusterId: string) => {
      setPreviewPropertyId(null);
      onSelectCluster?.(clusterId);
    },
    [onSelectCluster],
  );
  const handleViewportChange = useCallback(
    (viewport: MapViewport, origin: "user" | "programmatic") => {
      if (origin === "user") onViewportChange?.(viewport);
    },
    [onViewportChange],
  );

  return (
    <section aria-label="نقشه ملک‌ها" className="relative h-full">
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
        <div className="relative h-full min-h-80 overflow-hidden rounded-xl border">
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
            <aside
              ref={previewPanel}
              role="region"
              aria-label={`پیش‌نمایش ${preview.title}`}
              aria-live="polite"
              tabIndex={-1}
              className="bg-card absolute inset-x-3 bottom-3 z-10 max-h-[75%] overflow-y-auto rounded-t-2xl border p-4 shadow-xl sm:bottom-8 sm:rounded-xl"
            >
              <div className="relative grid gap-3 sm:grid-cols-[7rem_1fr]">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="absolute top-0 left-0 z-20"
                  aria-label="بستن پیش‌نمایش"
                  onClick={closePreview}
                >
                  <X aria-hidden="true" />
                </Button>
                <div className="bg-muted aspect-[4/3] overflow-hidden rounded-lg">
                  {preview.image ? (
                    <img
                      className="size-full object-cover"
                      src={preview.image.url}
                      width={preview.image.width}
                      height={preview.image.height}
                      alt={`تصویر ${preview.title}`}
                    />
                  ) : (
                    <div className="text-muted-foreground flex size-full items-center justify-center">
                      <Building2 aria-hidden="true" />
                    </div>
                  )}
                </div>
                <div className="relative min-w-0 pe-12">
                  <FavoriteButton
                    propertyId={previewPropertyId ?? ""}
                    propertyTitle={preview.title}
                    isFavorite={preview.isFavorite}
                  />
                  <h3 className="font-semibold">{preview.title}</h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {preview.locationLabel}
                  </p>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {preview.facts.join(" · ")}
                  </p>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-sm">
                <p className="font-semibold">
                  ودیعه {preview.rentalTerms.depositLabel}
                </p>
                <p>اجاره ماهانه {preview.rentalTerms.monthlyRentLabel}</p>
                <p className="text-muted-foreground text-xs">
                  {preview.listingCountLabel}
                </p>
              </div>
              <Button asChild className="mt-3 w-full">
                <Link to={preview.detailHref}>مشاهده {preview.title}</Link>
              </Button>
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

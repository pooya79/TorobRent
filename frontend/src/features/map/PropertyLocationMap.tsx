import { Suspense, useCallback, useMemo, useState } from "react";
import { LocateFixed, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { components } from "@/lib/api/schema";
import { type MapAdapter, type MapMarker } from "./adapter";
import { configuredMapAdapter } from "./configured-adapter";

type Property = components["schemas"]["PropertyDetail"];
const ignoreMapEvent = () => undefined;

export function PropertyLocationMap({
  property,
  adapter = configuredMapAdapter,
}: {
  property: Property;
  adapter?: MapAdapter;
}) {
  const location = property.approximate_location;
  const latitude = Number(location?.latitude);
  const longitude = Number(location?.longitude);
  const usable =
    location !== null &&
    location !== undefined &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) < 85 &&
    Math.abs(longitude) <= 180 &&
    location.radius_meters > 0;
  return (
    <section
      id="property-location"
      aria-labelledby="property-location-title"
      className="bg-card scroll-mt-6 overflow-hidden rounded-2xl border"
    >
      <div className="p-5 sm:p-7">
        <h2
          id="property-location-title"
          className="flex items-center gap-2 text-xl font-bold"
        >
          <MapPin className="text-primary size-5" aria-hidden="true" />
          موقعیت ملک روی نقشه
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-7">
          {property.location.neighborhood}، {property.location.district}،{" "}
          {property.location.city}
        </p>
      </div>
      {usable ? (
        <LocationCanvas
          key={`${property.id}-${latitude}-${longitude}-${location.radius_meters}-${location.precision}`}
          property={property}
          adapter={adapter}
        />
      ) : (
        <p className="bg-muted/30 mx-5 mb-5 rounded-xl border border-dashed p-5 text-sm leading-7 sm:mx-7 sm:mb-7">
          موقعیت این ملک هنوز روی نقشه ثبت نشده است. برای نشانی دقیق و هماهنگی
          بازدید، با ثبت‌کننده آگهی ارتباط بگیرید.
        </p>
      )}
    </section>
  );
}

function LocationCanvas({
  property,
  adapter: Adapter,
}: {
  property: Property;
  adapter: MapAdapter;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);
  const onReady = useCallback(() => setStatus("ready"), []);
  const onError = useCallback(() => setStatus("error"), []);
  const reset = () => {
    setStatus("loading");
    setAttempt((value) => value + 1);
  };
  const location = property.approximate_location!;
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const radius = new Intl.NumberFormat("fa-IR").format(location.radius_meters);
  const description =
    location.precision === "neighborhood"
      ? "این نشانگر محدوده محله را نشان می‌دهد؛ موقعیت ساختمان مشخص نیست."
      : `ملک در محدوده تقریبی ${radius} متری نشانگر قرار دارد؛ نشانگر، نشانی دقیق ساختمان نیست.`;
  const initialViewport = useMemo(
    () => ({
      north: latitude + 0.01,
      south: latitude - 0.01,
      east: longitude + 0.01,
      west: longitude - 0.01,
      zoom: Math.max(
        8,
        Math.min(
          16,
          Math.floor(
            Math.log2(
              (156543.03 * Math.cos((latitude * Math.PI) / 180) * 320) /
                (location.radius_meters * 5),
            ),
          ),
        ),
      ),
    }),
    [latitude, longitude, location.radius_meters],
  );
  const markers = useMemo<readonly MapMarker[]>(
    () => [
      {
        propertyId: property.id,
        label: description,
        pinLabel: "موقعیت تقریبی ملک",
        mapPrices: { deposit: "", monthlyRent: "" },
        approximateLocation: {
          center: { latitude, longitude },
          radiusMeters: location.radius_meters,
          precision: location.precision,
        },
        preview: {
          title: property.title,
          locationLabel: property.location.neighborhood,
          facts: [],
          listingCountLabel: "",
          isFavorite: false,
          rentalTerms: { depositLabel: "", monthlyRentLabel: "" },
          detailHref: `/properties/${property.id}/${property.canonical_slug}`,
        },
      },
    ],
    [
      property.id,
      property.title,
      property.location.neighborhood,
      property.canonical_slug,
      description,
      latitude,
      longitude,
      location.radius_meters,
      location.precision,
    ],
  );
  return (
    <>
      <div
        className="relative mx-5 mb-4 h-80 overflow-hidden rounded-xl border sm:mx-7 sm:h-96"
        aria-label="نقشه موقعیت تقریبی این ملک"
      >
        {status === "error" ? (
          <div
            className="bg-muted/30 flex h-full flex-col items-center justify-center gap-4 p-6 text-center"
            role="status"
          >
            <MapPin
              className="text-muted-foreground size-8"
              aria-hidden="true"
            />
            <p className="text-sm">نقشه موقتاً در دسترس نیست</p>
            <Button variant="outline" onClick={reset}>
              تلاش دوباره برای نقشه
            </Button>
          </div>
        ) : (
          <Suspense
            fallback={
              <p className="p-5 text-sm" role="status">
                در حال آماده‌سازی نقشه
              </p>
            }
          >
            <Adapter
              key={attempt}
              initialViewport={initialViewport}
              markers={markers}
              clusters={[]}
              selectedPropertyId={property.id}
              retryToken={attempt}
              onReady={onReady}
              onError={onError}
              onViewportChange={ignoreMapEvent}
              onSelectProperty={ignoreMapEvent}
              onPreviewProperty={ignoreMapEvent}
              onSelectCluster={ignoreMapEvent}
            />
          </Suspense>
        )}
        {status === "ready" && (
          <Button
            size="sm"
            variant="outline"
            className="bg-background absolute end-3 bottom-10 z-10 shadow-sm"
            onClick={reset}
          >
            <LocateFixed className="size-4" aria-hidden="true" />
            بازگشت به ملک
          </Button>
        )}
      </div>
      <p className="text-muted-foreground px-5 pb-5 text-sm leading-7 sm:px-7 sm:pb-7">
        {description}
      </p>
    </>
  );
}

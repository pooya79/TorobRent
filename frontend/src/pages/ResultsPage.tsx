import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Map as MapIcon, SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { PageMain } from "@/components/layout/PageMain";
import {
  PropertyCard,
  type PropertyCardData,
} from "@/components/properties/PropertyCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CatalogFilters,
  filterChoiceLabels,
  filterLabels,
  type FilterName,
} from "@/features/catalog/CatalogFilters";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  CatalogSearchError,
  propertySearchInfiniteQueryOptions,
  propertySearchQueryOptions,
} from "@/features/catalog/queries";
import {
  formatNumber,
  propertyAreaAndRoomFacts,
  rentalTermsCardData,
} from "@/features/catalog/property-card-data";
import { type PropertyType } from "@/features/catalog/property-taxonomy";
import {
  selectedPropertyTypes,
  summarizePropertyTypes,
} from "@/features/catalog/property-type-selection";
import { SearchToolbar } from "@/features/catalog/SearchToolbar";
import type {
  MapAdapter,
  MapCluster,
  MapMarker,
  MapViewport,
} from "@/features/map/adapter";
import { configuredMapAdapter } from "@/features/map/configured-adapter";
import { SearchMapPanel } from "@/features/map/SearchMapPanel";
import {
  constrainMapViewport,
  mapViewportCanBeConstrained,
  tehranInitialViewport,
  tehranSearchViewConstraints,
} from "@/features/map/view-constraints";
import type { components } from "@/lib/api/schema";

type PropertySummary = components["schemas"]["PropertySummary"];

const commercialResultsHeadings = {
  office: "دفترهای اداری اجاره‌ای",
  shop: "مغازه‌های اجاره‌ای",
  warehouse: "انبارهای اجاره‌ای",
  workshop: "کارگاه‌های اجاره‌ای",
} as const satisfies Partial<Record<PropertyType, string>>;

function isCommercialResultType(
  propertyType: string,
): propertyType is keyof typeof commercialResultsHeadings {
  return propertyType in commercialResultsHeadings;
}

function resultsPageCopy(propertyTypes: readonly PropertyType[]) {
  const propertyType = propertyTypes.length === 1 ? propertyTypes[0] : null;
  const commercialHeading =
    propertyType && isCommercialResultType(propertyType)
      ? commercialResultsHeadings[propertyType]
      : undefined;
  if (commercialHeading) {
    return {
      heading: commercialHeading,
      title: `${commercialHeading} در تهران | ترب‌رنت`,
      description: `جست‌وجو، فیلتر و مقایسه ${commercialHeading} در تهران.`,
    };
  }
  if (propertyType) {
    return {
      heading: "خانه‌های اجاره‌ای",
      title: "خانه‌های اجاره‌ای در تهران | ترب‌رنت",
      description: "جست‌وجو، فیلتر و مقایسه آگهی‌های اجاره خانه در تهران.",
    };
  }
  return {
    heading: "ملک‌های اجاره‌ای",
    title: "ملک‌های اجاره‌ای در تهران | ترب‌رنت",
    description: "جست‌وجو، فیلتر و مقایسه ملک‌های اجاره‌ای در تهران.",
  };
}

export function meta({ location }: { location?: { search: string } } = {}) {
  const copy = resultsPageCopy(
    selectedPropertyTypes(new URLSearchParams(location?.search)),
  );
  return [
    { title: copy.title },
    { name: "description", content: copy.description },
    ...(location?.search
      ? [{ name: "robots", content: "noindex, follow" }]
      : []),
  ];
}

function toCardData(
  property: PropertySummary,
  searchParams: URLSearchParams,
): PropertyCardData {
  const facts = [
    property.property_type_label,
    ...propertyAreaAndRoomFacts(property),
  ].filter((fact): fact is string => fact !== null);
  return {
    id: property.id,
    title: property.title,
    location: property.location.neighborhood,
    propertyTypeLabel: property.property_type_label,
    facts,
    image: property.primary_image ?? undefined,
    isFavorite: property.is_favorite ?? false,
    listingCountLabel: `${formatNumber(property.listing_count)} آگهی فعال`,
    otherOffersLabel:
      property.listing_count > 1
        ? `${formatNumber(property.listing_count - 1)} پیشنهاد دیگر`
        : undefined,
    rentalTerms: rentalTermsCardData(property.rental_terms),
    navigation: {
      kind: "property-detail",
      href: `/properties/${property.id}?${new URLSearchParams({
        returnTo: `/search?${searchParams.toString()}`,
      }).toString()}`,
    },
  };
}

function toMapMarker(
  property: PropertySummary,
  searchParams: URLSearchParams,
): MapMarker | null {
  const location = property.approximate_location;
  if (!location) return null;
  const card = toCardData(property, searchParams);
  if (!card.rentalTerms) return null;
  return {
    propertyId: property.id,
    label: `ودیعه ${card.rentalTerms.depositLabel}\nاجاره ماهانه ${card.rentalTerms.monthlyRentLabel}`,
    approximateLocation: {
      center: {
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
      },
      radiusMeters: location.radius_meters,
      precision: location.precision,
    },
    preview: {
      title: property.title,
      locationLabel: card.location,
      facts: card.facts,
      image: card.image,
      listingCountLabel: card.listingCountLabel ?? "",
      isFavorite: card.isFavorite,
      rentalTerms: card.rentalTerms,
      detailHref:
        card.navigation.kind === "property-detail"
          ? card.navigation.href
          : `/properties/${property.id}`,
    },
  };
}

const viewportParameterNames = [
  "viewport_north",
  "viewport_east",
  "viewport_south",
  "viewport_west",
  "viewport_zoom",
] as const;

function parsedViewportFromSearchParams(
  searchParams: URLSearchParams,
): MapViewport | null {
  const values = viewportParameterNames.map((name) =>
    Number(searchParams.get(name)),
  );
  if (
    viewportParameterNames.every((name) => searchParams.has(name)) &&
    values.every(Number.isFinite)
  ) {
    const [north, east, south, west, zoom] = values;
    if (
      north !== undefined &&
      east !== undefined &&
      south !== undefined &&
      west !== undefined &&
      zoom !== undefined
    ) {
      const viewport = { north, east, south, west, zoom };
      return mapViewportCanBeConstrained(viewport, tehranSearchViewConstraints)
        ? viewport
        : null;
    }
  }
  return null;
}

function viewportFromSearchParams(searchParams: URLSearchParams): MapViewport {
  const viewport = parsedViewportFromSearchParams(searchParams);
  return viewport
    ? constrainMapViewport(viewport, tehranSearchViewConstraints)
    : tehranInitialViewport;
}

function viewportValue(value: number) {
  return String(Number(value.toFixed(6)));
}

function ResultsLoading() {
  return (
    <section
      className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3"
      aria-label="در حال بارگذاری ملک‌ها"
      aria-live="polite"
    >
      {[1, 2, 3].map((item) => (
        <div className="space-y-4" key={item}>
          <Skeleton className="aspect-[4/3] rounded-xl" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </section>
  );
}

function searchContextParams(searchParams: URLSearchParams) {
  const next = new URLSearchParams();
  for (const name of ["location", "location_label", "property_category"]) {
    const value = searchParams.get(name);
    if (value) next.set(name, value);
  }
  return next;
}

function AdvancedFiltersSheet({
  open,
  onOpenChange,
  searchParams,
  setSearchParams,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  searchParams: URLSearchParams;
  setSearchParams: (next: URLSearchParams) => void;
}) {
  const [draftParams, setDraftParams] = useState(
    () => new URLSearchParams(searchParams),
  );
  const [formVersion, setFormVersion] = useState(0);
  const preview = useQuery(propertySearchQueryOptions(draftParams, open));
  const changeOpen = (nextOpen: boolean) => {
    setDraftParams(new URLSearchParams(searchParams));
    setFormVersion((version) => version + 1);
    onOpenChange(nextOpen);
  };

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <SlidersHorizontal aria-hidden="true" /> فیلترهای پیشرفته
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-full max-w-none flex-col overflow-hidden pt-14 sm:max-w-none lg:w-[30rem] lg:max-w-[calc(100vw-2rem)]"
      >
        <SheetHeader>
          <SheetTitle>فیلترهای پیشرفته</SheetTitle>
          <SheetDescription>
            تغییرها را بررسی کنید و سپس همه را یک‌جا اعمال کنید.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 min-h-0 flex-1">
          <CatalogFilters
            key={formVersion}
            prefix="advanced"
            searchParams={draftParams}
            facets={
              preview.isPlaceholderData ? undefined : preview.data?.facets
            }
            onDraftChange={setDraftParams}
            onApply={() => {
              setSearchParams(draftParams);
              onOpenChange(false);
            }}
            onCancel={() => changeOpen(false)}
            onClear={() => {
              setDraftParams(searchContextParams(searchParams));
              setFormVersion((version) => version + 1);
            }}
            previewCount={preview.data?.count}
            previewPending={preview.isPending || preview.isFetching}
            previewError={preview.isError}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ResultsPage({ mapAdapter }: { mapAdapter?: MapAdapter }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileMapOpen, setMobileMapOpen] = useState(false);
  const [mapAvailable, setMapAvailable] = useState(true);
  const [desktopMapEnabled, setDesktopMapEnabled] = useState(false);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(
    null,
  );
  const viewportTimer = useRef<number | undefined>(undefined);
  const loadMoreSentinel = useRef<HTMLDivElement>(null);
  const search = useInfiniteQuery(
    propertySearchInfiniteQueryOptions(searchParams),
  );
  const searchData = search.data?.pages[0];
  const properties = useMemo(() => {
    const byId = new Map<string, PropertySummary>();
    for (const page of search.data?.pages ?? []) {
      for (const property of page.results) byId.set(property.id, property);
    }
    return [...byId.values()];
  }, [search.data?.pages]);
  const latestSearchParamsRef = useRef(searchParams);
  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia("(min-width: 1280px)");
    const sync = () => setDesktopMapEnabled(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    latestSearchParamsRef.current = searchParams;
  }, [searchParams]);
  const resultSearchParams = useMemo(() => {
    const result = new URLSearchParams(
      searchData?.requestSearchParams ?? searchParams,
    );
    const requestedPage = Math.max(
      1,
      Number(searchParams.get("page") ?? "1") || 1,
    );
    const loadedPage = Math.max(requestedPage, search.data?.pages.length ?? 1);
    if (loadedPage > 1) result.set("page", String(loadedPage));
    return result;
  }, [
    search.data?.pages.length,
    searchData?.requestSearchParams,
    searchParams,
  ]);
  const MapAdapterComponent = mapAdapter ?? configuredMapAdapter;
  const location =
    resultSearchParams.get("location_label") ||
    resultSearchParams.get("location") ||
    "تهران";
  const resultsCopy = resultsPageCopy(
    selectedPropertyTypes(resultSearchParams),
  );
  const count = searchData?.count ?? 0;
  const initialViewport = useMemo(
    () => viewportFromSearchParams(searchParams),
    [searchParams],
  );
  useEffect(() => {
    if (!viewportParameterNames.some((name) => searchParams.has(name))) return;
    const parsedViewport = parsedViewportFromSearchParams(searchParams);
    const next = new URLSearchParams(searchParams);
    if (!parsedViewport) {
      for (const name of viewportParameterNames) next.delete(name);
    } else {
      const constrainedViewport = constrainMapViewport(
        parsedViewport,
        tehranSearchViewConstraints,
      );
      const canonicalViewportParameters = [
        ["viewport_north", constrainedViewport.north],
        ["viewport_east", constrainedViewport.east],
        ["viewport_south", constrainedViewport.south],
        ["viewport_west", constrainedViewport.west],
        ["viewport_zoom", constrainedViewport.zoom],
      ] as const;
      if (
        canonicalViewportParameters.every(
          ([name, value]) => searchParams.get(name) === viewportValue(value),
        )
      ) {
        return;
      }
      for (const [name, value] of canonicalViewportParameters) {
        next.set(name, viewportValue(value));
      }
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const mapMarkers =
    searchData?.map.markers
      .map((property) => toMapMarker(property, resultSearchParams))
      .filter((marker): marker is MapMarker => marker !== null) ?? [];
  const mapClusters: MapCluster[] =
    searchData?.map.clusters.map((cluster) => ({
      id: cluster.id,
      center: {
        latitude: Number(cluster.latitude),
        longitude: Number(cluster.longitude),
      },
      bounds: {
        north: Number(cluster.north),
        east: Number(cluster.east),
        south: Number(cluster.south),
        west: Number(cluster.west),
      },
      propertyCount: cluster.property_count,
      propertyIds: cluster.property_ids,
    })) ?? [];
  const requestedPageCount = Math.max(
    1,
    Number(searchParams.get("page") ?? "1") || 1,
  );
  const loadMore = useCallback(async () => {
    if (!search.hasNextPage || search.isFetchingNextPage) return;
    const result = await search.fetchNextPage({ cancelRefetch: false });
    if (result.isError || !result.data) return;
    const loadedPageCount = result.data.pages.length;
    if (loadedPageCount >= requestedPageCount) {
      const current = latestSearchParamsRef.current;
      const next = new URLSearchParams(current);
      if (loadedPageCount > 1) next.set("page", String(loadedPageCount));
      if (next.toString() !== current.toString()) {
        setSearchParams(next, { replace: true });
      }
    }
  }, [requestedPageCount, search, setSearchParams]);
  useEffect(() => {
    if (
      search.data &&
      search.data.pages.length < requestedPageCount &&
      search.hasNextPage &&
      !search.isFetchingNextPage
    ) {
      void loadMore();
    }
  }, [
    loadMore,
    requestedPageCount,
    search.data,
    search.hasNextPage,
    search.isFetchingNextPage,
  ]);
  useEffect(() => {
    const sentinel = loadMoreSentinel.current;
    if (
      !sentinel ||
      !search.hasNextPage ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, search.hasNextPage]);
  const isReplacingResults =
    search.isFetching && !search.isPending && !search.isFetchingNextPage;
  const handleViewportChange = useCallback(
    (viewport: MapViewport) => {
      window.clearTimeout(viewportTimer.current);
      viewportTimer.current = window.setTimeout(() => {
        const next = new URLSearchParams(latestSearchParamsRef.current);
        next.set("viewport_north", viewportValue(viewport.north));
        next.set("viewport_east", viewportValue(viewport.east));
        next.set("viewport_south", viewportValue(viewport.south));
        next.set("viewport_west", viewportValue(viewport.west));
        next.set("viewport_zoom", viewportValue(viewport.zoom));
        next.delete("page");
        setSearchParams(next, { replace: true });
      }, 500);
    },
    [setSearchParams],
  );
  useEffect(() => () => window.clearTimeout(viewportTimer.current), []);
  const activeFilters = Object.entries(filterLabels).filter(([name]) =>
    resultSearchParams.has(name),
  ) as [FilterName, string][];
  const displayFilterValue = (name: FilterName) => {
    if (name === "property_type") {
      return summarizePropertyTypes(selectedPropertyTypes(resultSearchParams));
    }
    if (name === "district" || name === "neighborhood") {
      return (
        resultSearchParams.getAll(`${name}_label`).join("، ") ||
        resultSearchParams.getAll(name).join("، ")
      );
    }
    const value = resultSearchParams.get(name) ?? "";
    if (value in filterChoiceLabels) {
      return filterChoiceLabels[value as keyof typeof filterChoiceLabels];
    }
    const number = Number(value);
    return Number.isFinite(number) ? formatNumber(number) : value;
  };
  const removeFilter = (name: FilterName) => {
    const next = new URLSearchParams(searchParams);
    next.delete(name);
    if (name === "district" || name === "neighborhood") {
      next.delete(`${name}_label`);
    }
    next.delete("page");
    setSearchParams(next);
  };
  const mapPanelProps = {
    adapter: MapAdapterComponent,
    markers: mapMarkers,
    clusters: mapClusters,
    initialViewport,
    viewConstraints: tehranSearchViewConstraints,
    onViewportChange: handleViewportChange,
    selectedPropertyId,
    onSelectProperty: setSelectedPropertyId,
  };

  return (
    <PageMain className="flex h-full min-h-0 flex-col py-3 sm:py-4">
      <header className="shrink-0">
        <SearchToolbar
          searchParams={searchParams}
          setSearchParams={setSearchParams}
          facets={searchData?.facets}
        />
        <h1 className="mb-3 text-2xl font-semibold tracking-tight">
          {resultsCopy.heading} در {location}
        </h1>
      </header>
      {activeFilters.length > 0 && (
        <div
          className="mb-3 flex shrink-0 flex-nowrap gap-2 overflow-x-auto pb-1"
          aria-label="فیلترهای اعمال‌شده"
        >
          {activeFilters.map(([name, label]) => (
            <Button
              key={name}
              className="shrink-0"
              type="button"
              size="sm"
              variant="outline"
              aria-label={`حذف فیلتر ${label}`}
              onClick={() => removeFilter(name)}
            >
              {label}: {displayFilterValue(name)}
              <X aria-hidden="true" />
            </Button>
          ))}
          <Button
            className="shrink-0"
            type="button"
            size="sm"
            variant="ghost"
            aria-label="پاک کردن همه فیلترها"
            onClick={() => setSearchParams(searchContextParams(searchParams))}
          >
            پاک کردن همه
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {searchData ? (
              resultSearchParams.has("viewport_north") ? (
                `${formatNumber(count)} ملک در این محدوده پیدا شد`
              ) : (
                <>
                  <span>{formatNumber(count)} ملک پیدا شد</span>
                  <span className="ms-1 hidden sm:inline">
                    از این تعداد،{" "}
                    {formatNumber(searchData.map.mappable_property_count)} ملک
                    روی نقشه است
                  </span>
                </>
              )
            ) : (
              "جست‌وجوی ملک‌ها"
            )}
          </p>
          <div className="flex items-center gap-2">
            {mapAvailable ? (
              search.data ? (
                <Sheet open={mobileMapOpen} onOpenChange={setMobileMapOpen}>
                  <SheetTrigger asChild>
                    <Button className="xl:hidden" size="sm">
                      <MapIcon aria-hidden="true" /> نمایش نقشه تمام‌صفحه
                    </Button>
                  </SheetTrigger>
                  <SheetContent
                    side="bottom"
                    className="inset-0 h-dvh w-full max-w-none p-0 xl:hidden"
                  >
                    <SheetHeader className="sr-only">
                      <SheetTitle>نقشه تمام‌صفحه ملک‌ها</SheetTitle>
                      <SheetDescription>
                        انتخاب ملک‌ها از روی موقعیت تقریبی آن‌ها
                      </SheetDescription>
                    </SheetHeader>
                    <div className="h-full pt-16">
                      <SearchMapPanel {...mapPanelProps} />
                    </div>
                  </SheetContent>
                </Sheet>
              ) : (
                <Button className="xl:hidden" size="sm" disabled>
                  <MapIcon aria-hidden="true" /> نمایش نقشه تمام‌صفحه
                </Button>
              )
            ) : null}
            <AdvancedFiltersSheet
              open={filtersOpen}
              onOpenChange={setFiltersOpen}
              searchParams={searchParams}
              setSearchParams={setSearchParams}
            />
          </div>
        </div>
        <div
          role="region"
          aria-label="نتایج و نقشه جاری"
          aria-busy={isReplacingResults}
          className={`min-h-0 flex-1 ${
            mapAvailable
              ? "grid gap-5 xl:grid-cols-2 xl:[direction:ltr]"
              : "block"
          } ${isReplacingResults ? "opacity-60" : ""}`}
        >
          <div
            className={
              mapAvailable
                ? "hidden xl:block xl:h-full xl:min-h-0 xl:[direction:rtl]"
                : ""
            }
          >
            {(mapAdapter || desktopMapEnabled) && (
              <SearchMapPanel
                {...mapPanelProps}
                onAvailabilityChange={setMapAvailable}
              />
            )}
          </div>
          <div className="h-full min-h-0 overflow-y-auto overscroll-contain pe-1 pb-8 xl:[direction:rtl]">
            {search.isPending ? (
              <ResultsLoading />
            ) : search.isError && !searchData ? (
              search.error instanceof CatalogSearchError &&
              search.error.status === 503 ? (
                <Alert variant="destructive">
                  <AlertTitle>نتایج فعلاً در دسترس نیست</AlertTitle>
                  <AlertDescription>
                    اطلاعات ملک‌ها موقتاً بارگذاری نمی‌شود. چند دقیقه دیگر
                    دوباره تلاش کنید.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert>
                  <AlertTitle>بارگذاری نتایج کامل نشد</AlertTitle>
                  <AlertDescription className="mt-3">
                    اتصال خود را بررسی کنید.
                    <Button
                      className="ms-3"
                      size="sm"
                      variant="outline"
                      type="button"
                      onClick={() => void search.refetch()}
                    >
                      تلاش دوباره
                    </Button>
                  </AlertDescription>
                </Alert>
              )
            ) : properties.length === 0 ? (
              <section className="bg-muted flex min-h-80 flex-col items-center justify-center rounded-xl p-8 text-center">
                <h2 className="text-xl font-semibold">
                  ملکی در این محدوده پیدا نشد
                </h2>
                <p className="text-muted-foreground mt-3 max-w-md text-sm leading-7">
                  نام شهر، منطقه یا محله دیگری را جست‌وجو کنید.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <Button asChild variant="outline">
                    <Link to="/">جست‌وجوی دوباره</Link>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      for (const name of Object.keys(filterLabels)) {
                        next.delete(name);
                      }
                      next.delete("page");
                      setSearchParams(next);
                    }}
                  >
                    پاک کردن فیلترها
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      window.clearTimeout(viewportTimer.current);
                      const next = new URLSearchParams(searchParams);
                      for (const name of viewportParameterNames) {
                        next.delete(name);
                      }
                      next.delete("page");
                      setSearchParams(next);
                    }}
                  >
                    بازنشانی به تهران
                  </Button>
                </div>
              </section>
            ) : (
              <section
                className={
                  mapAvailable
                    ? "grid gap-x-4 gap-y-7 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))]"
                    : "grid gap-x-4 gap-y-7 sm:grid-cols-2 xl:grid-cols-3"
                }
                aria-label="ملک‌های پیدا شده"
              >
                {properties.map((property) => (
                  <PropertyCard
                    key={property.id}
                    property={toCardData(property, resultSearchParams)}
                    selected={selectedPropertyId === property.id}
                  />
                ))}
              </section>
            )}

            {searchData && properties.length > 0 && (
              <div className="mt-12 flex flex-col items-center gap-3">
                <div ref={loadMoreSentinel} aria-hidden="true" />
                {search.isFetchNextPageError ? (
                  <Alert>
                    <AlertTitle>بارگذاری ملک‌های بیشتر کامل نشد</AlertTitle>
                    <AlertDescription className="mt-3">
                      اتصال خود را بررسی کنید.
                      <Button
                        className="ms-3"
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() => void loadMore()}
                      >
                        تلاش دوباره
                      </Button>
                    </AlertDescription>
                  </Alert>
                ) : search.hasNextPage ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={search.isFetchingNextPage}
                    onClick={() => void loadMore()}
                  >
                    {search.isFetchingNextPage
                      ? "در حال بارگذاری ملک‌های بیشتر…"
                      : "نمایش ملک‌های بیشتر"}
                  </Button>
                ) : (
                  <p
                    role="status"
                    aria-live="polite"
                    className="text-muted-foreground text-sm"
                  >
                    به پایان نتایج رسیدید
                  </p>
                )}
                {search.isFetchingNextPage && (
                  <p role="status" aria-live="polite" className="sr-only">
                    در حال بارگذاری ملک‌های بیشتر
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </PageMain>
  );
}

export default ResultsPage;

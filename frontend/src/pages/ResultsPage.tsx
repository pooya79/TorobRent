import { useQuery } from "@tanstack/react-query";
import { SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import { PageMain } from "@/components/layout/PageMain";
import {
  PropertyCard,
  type PropertyCardData,
} from "@/components/properties/PropertyCard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
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
  propertySearchQueryOptions,
} from "@/features/catalog/queries";
import {
  roomCountLabels,
  type PropertyType,
} from "@/features/catalog/property-taxonomy";
import {
  selectedPropertyTypes,
  summarizePropertyTypes,
} from "@/features/catalog/property-type-selection";
import { SearchToolbar } from "@/features/catalog/SearchToolbar";
import type { MapAdapter, MapMarker } from "@/features/map/adapter";
import { configuredMapAdapter } from "@/features/map/configured-adapter";
import { SearchMapPanel } from "@/features/map/SearchMapPanel";
import type { components } from "@/lib/api/schema";

type PropertySummary = components["schemas"]["PropertySummary"];

function formatNumber(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

function formatFreshness(value: string) {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    dateStyle: "medium",
  }).format(new Date(value));
}

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
    `${formatNumber(property.area_sqm)} متر`,
    property.room_count === null || property.room_count === undefined
      ? null
      : `${formatNumber(property.room_count)} ${roomCountLabels[property.property_category].fact}`,
    property.construction_year === null
      ? null
      : `ساخت ${formatNumber(property.construction_year)}`,
  ].filter((fact): fact is string => fact !== null);
  return {
    id: property.id,
    title: property.title,
    location: [
      property.location.neighborhood,
      property.location.district,
      property.location.city,
    ].join("، "),
    facts,
    listingCountLabel: `${formatNumber(property.listing_count)} آگهی فعال`,
    rentalTerms: {
      depositLabel: `${formatNumber(property.rental_terms.deposit_toman)} تومان`,
      monthlyRentLabel: `${formatNumber(property.rental_terms.monthly_rent_toman)} تومان`,
    },
    freshnessLabel: `آخرین تأیید موجودی: ${formatFreshness(property.availability_confirmed_at)}`,
    detailHref: `/properties/${property.id}?${new URLSearchParams({
      returnTo: `/search?${searchParams.toString()}`,
    }).toString()}`,
  };
}

function toMapMarker(
  property: PropertySummary,
  searchParams: URLSearchParams,
): MapMarker | null {
  const location = property.approximate_location;
  if (!location) return null;
  const card = toCardData(property, searchParams);
  return {
    propertyId: property.id,
    label: `موقعیت تقریبی ${property.title}`,
    approximateLocation: {
      center: {
        latitude: location.latitude,
        longitude: location.longitude,
      },
      radiusMeters: location.radius_meters,
      precision: location.precision,
    },
    preview: {
      title: property.title,
      locationLabel: card.location,
      detailHref: card.detailHref ?? `/properties/${property.id}`,
    },
  };
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

export function ResultsPage({ mapAdapter }: { mapAdapter?: MapAdapter }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mapAvailable, setMapAvailable] = useState(true);
  const search = useQuery(propertySearchQueryOptions(searchParams));
  const MapAdapterComponent = mapAdapter ?? configuredMapAdapter;
  const currentPage = Number(searchParams.get("page") ?? "1");
  const location =
    searchParams.get("location_label") ||
    searchParams.get("location") ||
    "تهران";
  const resultsCopy = resultsPageCopy(selectedPropertyTypes(searchParams));
  const hrefForPage = (page: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(page));
    return `/search?${next.toString()}`;
  };
  const count = search.data?.count ?? 0;
  const pageCount = Math.ceil(count / 25);
  const mapMarkers =
    search.data?.results
      .map((property) => toMapMarker(property, searchParams))
      .filter((marker): marker is MapMarker => marker !== null) ?? [];
  const activeFilters = Object.entries(filterLabels).filter(([name]) =>
    searchParams.has(name),
  ) as [FilterName, string][];
  const displayFilterValue = (name: FilterName) => {
    if (name === "property_type") {
      return summarizePropertyTypes(selectedPropertyTypes(searchParams));
    }
    const value = searchParams.get(name) ?? "";
    if (value in filterChoiceLabels) {
      return filterChoiceLabels[value as keyof typeof filterChoiceLabels];
    }
    const number = Number(value);
    return Number.isFinite(number) ? formatNumber(number) : value;
  };
  const removeFilter = (name: FilterName) => {
    const next = new URLSearchParams(searchParams);
    next.delete(name);
    next.delete("page");
    setSearchParams(next);
  };

  return (
    <PageMain>
      <header>
        <SearchToolbar
          searchParams={searchParams}
          setSearchParams={setSearchParams}
        />
        <h1 className="sr-only">
          {resultsCopy.heading} در {location}
        </h1>
      </header>
      <div className="mb-6 flex justify-end lg:hidden">
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button className="lg:hidden" variant="outline">
              <SlidersHorizontal aria-hidden="true" /> فیلترها
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="flex w-[min(92vw,24rem)] flex-col overflow-hidden pt-14"
          >
            <SheetHeader>
              <SheetTitle>فیلتر نتایج</SheetTitle>
              <SheetDescription>
                فیلترها را انتخاب کنید و نتایج را به‌روز کنید.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 min-h-0 flex-1 overflow-y-auto pb-8">
              <CatalogFilters
                key={`mobile-${searchParams.toString()}`}
                prefix="mobile"
                searchParams={searchParams}
                setSearchParams={(next) => {
                  setSearchParams(next);
                  setFiltersOpen(false);
                }}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {activeFilters.length > 0 && (
        <div
          className="mb-6 flex flex-wrap gap-2"
          aria-label="فیلترهای اعمال‌شده"
        >
          {activeFilters.map(([name, label]) => (
            <Button
              key={name}
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
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="hidden lg:block" aria-label="فیلترهای جست‌وجو">
          <div className="sticky top-6 rounded-xl border p-5">
            <h2 className="mb-5 text-lg font-semibold">فیلتر نتایج</h2>
            <CatalogFilters
              key={`desktop-${searchParams.toString()}`}
              prefix="desktop"
              searchParams={searchParams}
              setSearchParams={setSearchParams}
            />
          </div>
        </aside>
        <div>
          <p className="text-muted-foreground mb-5 text-sm" aria-live="polite">
            {search.data
              ? `${formatNumber(count)} ملک پیدا شد`
              : "جست‌وجوی ملک‌ها"}
          </p>
          <div
            className={
              mapAvailable
                ? "grid gap-8 xl:grid-cols-[minmax(20rem,0.85fr)_minmax(0,1.4fr)]"
                : "space-y-5"
            }
          >
            <div
              className={mapAvailable ? "xl:sticky xl:top-6 xl:self-start" : ""}
            >
              <SearchMapPanel
                adapter={MapAdapterComponent}
                markers={mapMarkers}
                clusters={[]}
                onAvailabilityChange={setMapAvailable}
              />
            </div>
            <div>
              {search.isPending ? (
                <ResultsLoading />
              ) : search.isError ? (
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
              ) : search.data.results.length === 0 ? (
                <section className="bg-muted flex min-h-80 flex-col items-center justify-center rounded-xl p-8 text-center">
                  <h2 className="text-xl font-semibold">
                    ملکی در این محدوده پیدا نشد
                  </h2>
                  <p className="text-muted-foreground mt-3 max-w-md text-sm leading-7">
                    نام شهر، منطقه یا محله دیگری را جست‌وجو کنید.
                  </p>
                  <Button asChild className="mt-5" variant="outline">
                    <Link to="/">جست‌وجوی دوباره</Link>
                  </Button>
                </section>
              ) : (
                <section
                  className={
                    mapAvailable
                      ? "grid gap-x-5 gap-y-10 sm:grid-cols-2"
                      : "grid gap-x-5 gap-y-10 sm:grid-cols-2 xl:grid-cols-3"
                  }
                  aria-label="ملک‌های پیدا شده"
                >
                  {search.data.results.map((property) => (
                    <PropertyCard
                      key={property.id}
                      property={toCardData(property, searchParams)}
                    />
                  ))}
                </section>
              )}

              {search.data && pageCount > 1 && (
                <Pagination
                  className="mt-12"
                  dir="ltr"
                  aria-label="صفحه‌بندی نتایج"
                >
                  <PaginationContent>
                    {currentPage > 1 && (
                      <PaginationItem>
                        <PaginationPrevious
                          href={hrefForPage(currentPage - 1)}
                        />
                      </PaginationItem>
                    )}
                    {Array.from(
                      { length: pageCount },
                      (_, index) => index + 1,
                    ).map((page) => (
                      <PaginationItem key={page}>
                        <PaginationLink
                          href={hrefForPage(page)}
                          isActive={currentPage === page}
                        >
                          {formatNumber(page)}
                        </PaginationLink>
                      </PaginationItem>
                    ))}
                    {currentPage < pageCount && (
                      <PaginationItem>
                        <PaginationNext href={hrefForPage(currentPage + 1)} />
                      </PaginationItem>
                    )}
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          </div>
        </div>
      </div>
    </PageMain>
  );
}

export default ResultsPage;

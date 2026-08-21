import { useQuery } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
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

function toCardData(property: PropertySummary): PropertyCardData {
  const facts = [
    `${formatNumber(property.area_sqm)} متر`,
    `${formatNumber(property.room_count)} خواب`,
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

export function ResultsPage() {
  const [searchParams] = useSearchParams();
  const search = useQuery(propertySearchQueryOptions(searchParams));
  const currentPage = Number(searchParams.get("page") ?? "1");
  const location = searchParams.get("location") || "تهران";
  const hrefForPage = (page: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("page", String(page));
    return `/search?${next.toString()}`;
  };
  const count = search.data?.count ?? 0;
  const pageCount = Math.ceil(count / 25);

  return (
    <PageMain>
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground mb-2 text-sm" aria-live="polite">
            {search.data
              ? `${formatNumber(count)} ملک پیدا شد`
              : "جست‌وجوی ملک‌ها"}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            خانه‌های اجاره‌ای در {location}
          </h1>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button className="lg:hidden" variant="outline">
              <SlidersHorizontal aria-hidden="true" /> فیلترها
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[min(92vw,24rem)] pt-14">
            <SheetHeader>
              <SheetTitle>فیلتر نتایج</SheetTitle>
              <SheetDescription>
                برای تغییر شهر، منطقه یا محله به جست‌وجوی خانه برگردید.
              </SheetDescription>
            </SheetHeader>
            <Button asChild className="mt-6 w-full" variant="outline">
              <Link to="/">تغییر محدوده جست‌وجو</Link>
            </Button>
          </SheetContent>
        </Sheet>
      </header>

      {search.isPending ? (
        <ResultsLoading />
      ) : search.isError ? (
        search.error instanceof CatalogSearchError &&
        search.error.status === 503 ? (
          <Alert variant="destructive">
            <AlertTitle>نتایج فعلاً در دسترس نیست</AlertTitle>
            <AlertDescription>
              اطلاعات ملک‌ها موقتاً بارگذاری نمی‌شود. چند دقیقه دیگر دوباره تلاش
              کنید.
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
          <h2 className="text-xl font-semibold">ملکی در این محدوده پیدا نشد</h2>
          <p className="text-muted-foreground mt-3 max-w-md text-sm leading-7">
            نام شهر، منطقه یا محله دیگری را جست‌وجو کنید.
          </p>
          <Button asChild className="mt-5" variant="outline">
            <Link to="/">جست‌وجوی دوباره</Link>
          </Button>
        </section>
      ) : (
        <section
          className="grid gap-x-5 gap-y-10 sm:grid-cols-2 xl:grid-cols-3"
          aria-label="ملک‌های پیدا شده"
        >
          {search.data.results.map((property) => (
            <PropertyCard key={property.id} property={toCardData(property)} />
          ))}
        </section>
      )}

      {search.data && pageCount > 1 && (
        <Pagination className="mt-12" dir="ltr" aria-label="صفحه‌بندی نتایج">
          <PaginationContent>
            {currentPage > 1 && (
              <PaginationItem>
                <PaginationPrevious href={hrefForPage(currentPage - 1)} />
              </PaginationItem>
            )}
            {Array.from({ length: pageCount }, (_, index) => index + 1).map(
              (page) => (
                <PaginationItem key={page}>
                  <PaginationLink
                    href={hrefForPage(page)}
                    isActive={currentPage === page}
                  >
                    {formatNumber(page)}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            {currentPage < pageCount && (
              <PaginationItem>
                <PaginationNext href={hrefForPage(currentPage + 1)} />
              </PaginationItem>
            )}
          </PaginationContent>
        </Pagination>
      )}
    </PageMain>
  );
}

export default ResultsPage;

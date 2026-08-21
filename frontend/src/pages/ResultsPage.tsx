import { SlidersHorizontal } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { PageMain } from "@/components/layout/PageMain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PropertyCard } from "@/components/properties/PropertyCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { prototypeRepository } from "@/features/prototype/fixtures";

const features = [
  ["parking", "پارکینگ"],
  ["elevator", "آسانسور"],
  ["storage", "انباری"],
] as const;

function FilterPanel({ searchParams }: { searchParams: URLSearchParams }) {
  return (
    <form className="space-y-7" action="/search" method="get">
      <div>
        <h2 className="font-semibold">فیلترها</h2>
        <p className="text-muted-foreground mt-2 text-sm">
          شرایط اجاره و ویژگی‌های ملک
        </p>
      </div>
      <fieldset>
        <legend className="mb-3 text-sm font-semibold">ودیعه، تومان</legend>
        <div className="grid grid-cols-2 gap-2">
          <Label className="space-y-2">
            <span className="text-muted-foreground text-xs">از</span>
            <Input
              inputMode="numeric"
              name="deposit_min"
              aria-label="حداقل ودیعه"
              defaultValue={searchParams.get("deposit_min") ?? ""}
              placeholder="۵۰۰ میلیون"
            />
          </Label>
          <Label className="space-y-2">
            <span className="text-muted-foreground text-xs">تا</span>
            <Input
              inputMode="numeric"
              name="deposit_max"
              aria-label="حداکثر ودیعه"
              defaultValue={searchParams.get("deposit_max") ?? ""}
              placeholder="۲ میلیارد"
            />
          </Label>
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-3 text-sm font-semibold">
          اجاره ماهانه، تومان
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <Label className="space-y-2">
            <span className="text-muted-foreground text-xs">از</span>
            <Input
              inputMode="numeric"
              name="rent_min"
              aria-label="حداقل اجاره ماهانه"
              defaultValue={searchParams.get("rent_min") ?? ""}
              placeholder="۱۰ میلیون"
            />
          </Label>
          <Label className="space-y-2">
            <span className="text-muted-foreground text-xs">تا</span>
            <Input
              inputMode="numeric"
              name="rent_max"
              aria-label="حداکثر اجاره ماهانه"
              defaultValue={searchParams.get("rent_max") ?? ""}
              placeholder="۴۰ میلیون"
            />
          </Label>
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-3 text-sm font-semibold">ویژگی‌ها</legend>
        <div className="grid gap-3">
          {features.map(([value, label]) => (
            <Label className="flex min-h-11 items-center gap-3" key={value}>
              <Checkbox
                name="feature"
                value={value}
                defaultChecked={searchParams.getAll("feature").includes(value)}
              />{" "}
              {label}
            </Label>
          ))}
        </div>
      </fieldset>
      {searchParams.get("location") && (
        <input
          type="hidden"
          name="location"
          value={searchParams.get("location") ?? ""}
        />
      )}
      {searchParams.get("property_type") && (
        <input
          type="hidden"
          name="property_type"
          value={searchParams.get("property_type") ?? ""}
        />
      )}
      <Button className="w-full rounded-full" type="submit">
        نمایش ۱۲۴ ملک
      </Button>
    </form>
  );
}

export function ResultsPage() {
  const [searchParams] = useSearchParams();
  const prototypeState = searchParams.get("prototypeState");
  const properties = prototypeRepository.getProperties();
  const currentPage = Number(searchParams.get("page") ?? "1");
  const location = searchParams.get("location");
  const propertyType = searchParams.get("property_type");
  const hrefWith = (name: string, value?: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(name, value);
    } else {
      next.delete(name);
    }
    const query = next.toString();
    return query ? `/search?${query}` : "/search";
  };
  const hrefWithout = (name: string, value?: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === undefined) {
      next.delete(name);
    } else {
      const remaining = next.getAll(name).filter((item) => item !== value);
      next.delete(name);
      remaining.forEach((item) => next.append(name, item));
    }
    const query = next.toString();
    return query ? `/search?${query}` : "/search";
  };
  const appliedFilters = [
    ...(location
      ? [{ key: "location", label: location, value: undefined }]
      : []),
    ...(propertyType
      ? [
          {
            key: "property_type",
            label: propertyType === "apartment" ? "آپارتمان" : "خانه",
            value: undefined,
          },
        ]
      : []),
    ...[
      ["deposit_min", "ودیعه از"],
      ["deposit_max", "ودیعه تا"],
      ["rent_min", "اجاره از"],
      ["rent_max", "اجاره تا"],
    ].flatMap(([key, label]) => {
      const value = searchParams.get(key!);
      return value
        ? [{ key: key!, label: `${label} ${value}`, value: undefined }]
        : [];
    }),
    ...searchParams.getAll("feature").map((value) => ({
      key: "feature",
      label: features.find(([feature]) => feature === value)?.[1] ?? value,
      value,
    })),
  ];

  return (
    <PageMain>
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-muted-foreground mb-2 text-sm">۱۲۴ ملک پیدا شد</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            خانه‌های اجاره‌ای در تهران
          </h1>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button className="lg:hidden" variant="outline">
              <SlidersHorizontal aria-hidden="true" /> فیلترها
            </Button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-[min(92vw,24rem)] overflow-y-auto pt-14"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>فیلتر نتایج</SheetTitle>
              <SheetDescription>
                نتایج را بر اساس بودجه و ویژگی‌ها محدود کنید.
              </SheetDescription>
            </SheetHeader>
            <FilterPanel searchParams={searchParams} />
          </SheetContent>
        </Sheet>
      </header>
      <div
        className="mb-6 flex flex-wrap gap-2"
        aria-label="فیلترهای اعمال‌شده"
      >
        {appliedFilters.map(({ key, label, value }) => (
          <Button
            asChild
            size="sm"
            variant="secondary"
            key={`${key}-${value ?? ""}`}
          >
            <Link to={hrefWithout(key, value)}>{label} ×</Link>
          </Button>
        ))}
        {searchParams.size > 0 && (
          <Button asChild size="sm" variant="ghost">
            <Link to="/search">پاک کردن همه</Link>
          </Button>
        )}
      </div>
      <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside
          className="border-border hidden rounded-xl border p-5 lg:block"
          aria-label="فیلتر نتایج"
        >
          <FilterPanel searchParams={searchParams} />
        </aside>
        {prototypeState === "loading" ? (
          <section
            className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3"
            aria-label="در حال بارگذاری ملک‌ها"
          >
            {[1, 2, 3].map((item) => (
              <div className="space-y-4" key={item}>
                <Skeleton className="aspect-[4/3] rounded-xl" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            ))}
          </section>
        ) : prototypeState === "empty" ? (
          <section className="bg-muted flex min-h-80 flex-col items-center justify-center rounded-xl p-8 text-center">
            <h2 className="text-xl font-semibold">
              ملکی با این فیلترها پیدا نشد
            </h2>
            <p className="text-muted-foreground mt-3 max-w-md text-sm leading-7">
              محدوده جست‌وجو یا بودجه را تغییر دهید تا گزینه‌های بیشتری ببینید.
            </p>
            <Button asChild className="mt-5" variant="outline">
              <Link to="/search">پاک کردن فیلترها</Link>
            </Button>
          </section>
        ) : prototypeState === "unavailable" ? (
          <Alert variant="destructive">
            <AlertTitle>نتایج فعلاً در دسترس نیست</AlertTitle>
            <AlertDescription>
              اطلاعات ملک‌ها موقتاً بارگذاری نمی‌شود. چند دقیقه دیگر دوباره تلاش
              کنید.
            </AlertDescription>
          </Alert>
        ) : prototypeState === "error" ? (
          <Alert>
            <AlertTitle>بارگذاری نتایج کامل نشد</AlertTitle>
            <AlertDescription className="mt-3">
              اتصال خود را بررسی کنید.
              <Button asChild className="ms-3" size="sm" variant="outline">
                <Link to={hrefWith("prototypeState")}>تلاش دوباره</Link>
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <section
            className="grid gap-x-5 gap-y-10 sm:grid-cols-2 xl:grid-cols-3"
            aria-label="ملک‌های پیدا شده"
          >
            {properties.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
          </section>
        )}
      </div>
      <Pagination className="mt-12" dir="ltr" aria-label="صفحه‌بندی نتایج">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href={hrefWith("page", String(Math.max(1, currentPage - 1)))}
            />
          </PaginationItem>
          <PaginationItem>
            <PaginationLink
              href={hrefWith("page", "1")}
              isActive={currentPage === 1}
            >
              ۱
            </PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationLink
              href={hrefWith("page", "2")}
              isActive={currentPage === 2}
            >
              ۲
            </PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationEllipsis />
          </PaginationItem>
          <PaginationItem>
            <PaginationNext href={hrefWith("page", String(currentPage + 1))} />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </PageMain>
  );
}

export default ResultsPage;

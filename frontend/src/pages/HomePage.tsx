import {
  ArrowLeft,
  Building2,
  MapPin,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { PropertyCard } from "@/components/properties/PropertyCard";
import { Button } from "@/components/ui/button";
import { prototypeRepository } from "@/features/prototype/fixtures";
import { PropertyTypeSelector } from "@/features/catalog/PropertyTypeSelector";
import { PopularCities } from "@/features/cities/PopularCities";
import {
  SupportedCityCombobox,
  type SelectedSupportedCity,
} from "@/features/catalog/SupportedCityCombobox";

export function HomePage() {
  const properties = prototypeRepository.getProperties();
  const navigate = useNavigate();
  const [selectedCity, setSelectedCity] =
    useState<SelectedSupportedCity | null>(null);

  return (
    <main id="main-content" tabIndex={-1}>
      <section className="via-primary/5 relative isolate overflow-hidden bg-gradient-to-b from-transparent to-transparent">
        <div
          className="pointer-events-none absolute inset-0 -z-20 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:linear-gradient(to_bottom,black,transparent)] [background-size:3rem_3rem] opacity-35"
          aria-hidden="true"
        />
        <div
          className="bg-primary/10 pointer-events-none absolute start-1/4 -top-40 -z-10 size-96 rounded-full blur-3xl"
          aria-hidden="true"
        />
        <div className="mx-auto w-full max-w-360 px-4 pt-10 pb-16 sm:px-6 sm:pt-16 lg:px-10 lg:pt-24">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-muted-foreground mb-4 text-sm font-medium">
              آگهی‌های چند منبع، یک‌جا و قابل مقایسه
            </p>
            <h1 className="text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
              اجارهٔ ملک مسکونی و تجاری در تهران
            </h1>
            <p className="text-muted-foreground mx-auto mt-5 max-w-2xl leading-8">
              آپارتمان، خانه، ویلا و فضای تجاری را با اطلاعات یکدست جست‌وجو کنید
              و آگهی‌های هر منبع را جداگانه مقایسه کنید.
            </p>
          </div>

          <form
            className="border-border bg-card shadow-subtle mx-auto mt-10 grid max-w-4xl gap-2 rounded-3xl border p-2 sm:grid-cols-[minmax(0,1.35fr)_minmax(12rem,.65fr)_auto] sm:rounded-full"
            action="/search"
            method="get"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              const params = new URLSearchParams(
                new FormData(event.currentTarget) as unknown as Record<
                  string,
                  string
                >,
              );
              for (const [name, value] of [...params.entries()]) {
                if (!value) params.delete(name);
              }
              params.set("location", selectedCity?.id ?? "تهران");
              params.set("location_label", selectedCity?.name ?? "تهران");
              void navigate(
                `/search${params.size ? `?${params.toString()}` : ""}`,
              );
            }}
          >
            <label className="focus-within:ring-ring relative flex min-h-15 items-center gap-3 rounded-full px-4 focus-within:ring-2">
              <MapPin
                className="text-muted-foreground size-5 shrink-0"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 text-start">
                <span className="block text-xs font-semibold">شهر</span>
                <SupportedCityCombobox onSelectionChange={setSelectedCity} />
              </span>
            </label>
            <div className="border-border flex min-h-15 items-center gap-3 rounded-full border-t px-4 sm:border-s sm:border-t-0">
              <Building2
                className="text-muted-foreground size-5 shrink-0"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 text-start">
                <span
                  className="block text-xs font-semibold"
                  id="property-type-label"
                >
                  نوع ملک
                </span>
                <PropertyTypeSelector compact />
              </span>
            </div>
            <Button className="min-h-15 rounded-full px-7" type="submit">
              <Search aria-hidden="true" /> جست‌وجوی ملک
            </Button>
          </form>
        </div>
      </section>

      <PopularCities />

      <section
        className="bg-muted/70 border-border border-y"
        aria-labelledby="featured-properties-title"
      >
        <div className="mx-auto w-full max-w-360 px-4 py-14 sm:px-6 lg:px-10">
          <header className="mb-7 flex items-end justify-between gap-4">
            <div>
              <p className="text-muted-foreground mb-2 text-sm">
                نمونه‌های تازه
              </p>
              <h2
                id="featured-properties-title"
                className="text-2xl font-semibold tracking-tight sm:text-3xl"
              >
                ملک‌های به‌روزشده در تهران
              </h2>
            </div>
            <Button asChild variant="ghost">
              <Link to="/search">
                مشاهده همه <ArrowLeft aria-hidden="true" />
              </Link>
            </Button>
          </header>
          <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {properties.map((property) => (
              <PropertyCard key={property.id} property={property} />
            ))}
            <div className="border-border bg-card flex min-h-80 flex-col justify-end rounded-xl border p-7">
              <ShieldCheck
                className="text-primary mb-auto size-10"
                aria-hidden="true"
              />
              <h3 className="text-xl font-semibold">
                اطلاعات منابع را جدا ببینید
              </h3>
              <p className="text-muted-foreground mt-3 text-sm leading-7">
                ترب‌رنت اختلاف شرایط آگهی‌ها را پنهان نمی‌کند و زمان به‌روزرسانی
                هر منبع را نشان می‌دهد.
              </p>
              <Button asChild variant="outline" className="mt-5 w-fit">
                <Link to="/guide">روش کار ترب‌رنت</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

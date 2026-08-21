import {
  ArrowLeft,
  Building2,
  MapPin,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Link } from "react-router";

import { PropertyCard } from "@/components/properties/PropertyCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { prototypeRepository } from "@/features/prototype/fixtures";

const popularPlaces = ["تهران", "کرج", "مشهد", "شیراز"] as const;

export function HomePage() {
  const properties = prototypeRepository.getProperties();

  return (
    <main id="main-content" tabIndex={-1}>
      <section className="mx-auto w-full max-w-360 px-4 pt-10 pb-16 sm:px-6 sm:pt-16 lg:px-10 lg:pt-24">
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-muted-foreground mb-4 text-sm font-medium">
            آگهی‌های چند منبع، یک‌جا و قابل مقایسه
          </p>
          <h1 className="text-4xl leading-tight font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            خانه‌ای برای اجاره پیدا کنید
          </h1>
          <p className="text-muted-foreground mx-auto mt-5 max-w-2xl leading-8">
            ملک‌ها را با اطلاعات یکدست ببینید، آگهی‌های هر منبع را جداگانه
            مقایسه کنید و با دید روشن‌تری ادامه دهید.
          </p>
        </div>

        <form
          className="border-border bg-card shadow-subtle mx-auto mt-10 grid max-w-4xl gap-2 rounded-3xl border p-2 sm:grid-cols-[minmax(0,1.35fr)_minmax(12rem,.65fr)_auto] sm:rounded-full"
          action="/search"
          method="get"
          role="search"
        >
          <label className="focus-within:ring-ring flex min-h-15 items-center gap-3 rounded-full px-4 focus-within:ring-2">
            <MapPin
              className="text-muted-foreground size-5 shrink-0"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 text-start">
              <span className="block text-xs font-semibold">شهر یا محله</span>
              <Input
                className="h-auto border-0 bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                type="search"
                name="location"
                list="prototype-locations"
                aria-label="شهر یا محله"
                placeholder="مثلاً تهران، سعادت‌آباد"
              />
              <datalist id="prototype-locations">
                <option value="تهران، سعادت‌آباد" />
                <option value="تهران، یوسف‌آباد" />
                <option value="تهران، تهران‌پارس" />
                <option value="کرج، عظیمیه" />
              </datalist>
            </span>
          </label>
          <label className="border-border focus-within:ring-ring flex min-h-15 items-center gap-3 rounded-full border-t px-4 focus-within:ring-2 sm:border-s sm:border-t-0">
            <Building2
              className="text-muted-foreground size-5 shrink-0"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 text-start">
              <span className="block text-xs font-semibold">نوع ملک</span>
              <Select name="property_type">
                <SelectTrigger className="h-auto w-full border-0 p-0 text-sm shadow-none focus:ring-0">
                  <SelectValue placeholder="همه ملک‌ها" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="apartment">آپارتمان</SelectItem>
                  <SelectItem value="house">خانه</SelectItem>
                </SelectContent>
              </Select>
            </span>
          </label>
          <Button className="min-h-15 rounded-full px-7" type="submit">
            <Search aria-hidden="true" /> جست‌وجوی خانه
          </Button>
        </form>

        <div
          className="text-muted-foreground mt-5 flex flex-wrap items-center justify-center gap-2 text-xs"
          aria-label="جست‌وجوهای پرطرفدار"
        >
          <span>پرطرفدار:</span>
          {popularPlaces.map((place) => (
            <Link
              className="hover:text-foreground min-h-11 rounded-full px-3 py-3 transition-colors"
              key={place}
              to={`/search?location=${encodeURIComponent(place)}`}
            >
              {place}
            </Link>
          ))}
        </div>
      </section>

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

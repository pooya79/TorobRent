import {
  BadgeCheck,
  Building2,
  ChevronDown,
  CircleCheckBig,
  Layers3,
  MapPin,
  Search,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { catalogStatisticsQueryOptions } from "@/features/catalog/queries";
import { PropertyTypeSelector } from "@/features/catalog/PropertyTypeSelector";
import { PopularCities } from "@/features/cities/PopularCities";
import {
  SupportedCityCombobox,
  type SelectedSupportedCity,
} from "@/features/catalog/SupportedCityCombobox";

export function HomePage() {
  const navigate = useNavigate();
  const [selectedCity, setSelectedCity] =
    useState<SelectedSupportedCity | null>(null);

  return (
    <main id="main-content" tabIndex={-1}>
      <section className="via-primary/5 relative isolate z-10 overflow-visible bg-gradient-to-b from-transparent to-transparent">
        <div
          className="pointer-events-none absolute inset-0 -z-20 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:linear-gradient(to_bottom,black,transparent)] [background-size:3rem_3rem] opacity-35"
          aria-hidden="true"
        />
        <div
          className="bg-primary/10 pointer-events-none absolute start-1/4 -top-40 -z-10 size-96 rounded-full blur-3xl"
          aria-hidden="true"
        />
        <div className="mx-auto w-full max-w-432 px-4 pt-10 pb-16 sm:px-6 sm:pt-16 lg:px-10 lg:pt-24">
          <div className="mx-auto max-w-4xl text-center">
            <p className="text-muted-foreground mb-4 text-sm font-medium">
              آگهی‌های چند منبع، یک‌جا و قابل مقایسه
            </p>
            <h1 className="text-4xl leading-tight font-semibold tracking-tight sm:text-5xl">
              اجاره ملک مسکونی و تجاری در تهران
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
            <label className="relative flex min-h-15 items-center gap-3 rounded-full px-4">
              <MapPin
                className="text-muted-foreground size-5 shrink-0"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 text-start">
                <span className="block text-xs font-semibold">شهر</span>
                <SupportedCityCombobox
                  onSelectionChange={setSelectedCity}
                  showPopularCities
                />
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
      <TrustSection />
      <CatalogStatisticsSection />
      <FaqSection />
    </main>
  );
}

const trustClaims = [
  {
    title: "بازبینی پیش از انتشار",
    description:
      "اطلاعات هر ملک پیش از انتشار در کاتالوگ به‌دست اپراتور بازبینی می‌شود.",
    icon: BadgeCheck,
  },
  {
    title: "موجودی جاری",
    description:
      "فقط ملک‌هایی در جست‌وجو دیده می‌شوند که دست‌کم یک آگهی فعال دارند.",
    icon: CircleCheckBig,
  },
  {
    title: "منابع شفاف و جدا",
    description:
      "آگهی‌های منابع مختلف با شرایط و زمان تأیید خودشان جدا می‌مانند و قابل مقایسه‌اند.",
    icon: Layers3,
  },
] as const;

function TrustSection() {
  return (
    <section
      className="mx-auto w-full max-w-432 px-4 py-16 sm:px-6 lg:px-10"
      aria-labelledby="trust-title"
    >
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-primary mb-2 text-sm font-semibold">مرزهای اعتماد</p>
        <h2 id="trust-title" className="text-2xl font-semibold sm:text-3xl">
          چرا به اطلاعات اعتماد کنیم؟
        </h2>
      </div>
      <div className="mt-9 grid gap-5 md:grid-cols-3">
        {trustClaims.map(({ title, description, icon: Icon }) => (
          <article
            key={title}
            className="border-border bg-card rounded-2xl border p-6"
          >
            <Icon className="text-primary size-8" aria-hidden="true" />
            <h3 className="mt-5 text-lg font-semibold">{title}</h3>
            <p className="text-muted-foreground mt-3 text-sm leading-7">
              {description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

const persianNumber = new Intl.NumberFormat("fa-IR");

function CatalogStatisticsSection() {
  const statistics = useQuery(catalogStatisticsQueryOptions());

  return (
    <section
      className="bg-muted/70 border-border border-y"
      aria-labelledby="statistics-title"
    >
      <div className="mx-auto w-full max-w-432 px-4 py-16 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-primary mb-2 text-sm font-semibold">
            نمای کلی بازار
          </p>
          <h2
            id="statistics-title"
            className="text-2xl font-semibold sm:text-3xl"
          >
            آمار زنده کاتالوگ
          </h2>
          <p className="text-muted-foreground mt-3 leading-7">
            این عددها مستقیم از ملک‌ها و آگهی‌های فعال قابل جست‌وجو در تهران
            محاسبه می‌شوند.
          </p>
        </div>

        {statistics.isPending ? (
          <div
            className="text-muted-foreground mx-auto mt-9 max-w-xl rounded-2xl border p-7 text-center"
            role="status"
            aria-label="در حال دریافت آمار زنده"
          >
            در حال دریافت آمار زنده…
          </div>
        ) : statistics.isError ? (
          <div
            className="border-border bg-card mx-auto mt-9 flex max-w-xl flex-col items-center rounded-2xl border p-7 text-center"
            role="alert"
            aria-label="آمار زنده اکنون در دسترس نیست."
          >
            <p>آمار زنده اکنون در دسترس نیست.</p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => void statistics.refetch()}
            >
              تلاش دوباره
            </Button>
          </div>
        ) : (
          <>
            <dl className="mx-auto mt-9 grid max-w-4xl gap-4 sm:grid-cols-3">
              {[
                [statistics.data.searchable_property_count, "ملک قابل جست‌وجو"],
                [statistics.data.active_listing_count, "آگهی فعال"],
                [statistics.data.covered_neighborhood_count, "محله تحت پوشش"],
              ].map(([value, label]) => (
                <div
                  key={label}
                  className="border-border bg-card flex flex-col rounded-2xl border p-6 text-center"
                >
                  <dt className="text-muted-foreground order-2 mt-2 text-sm">
                    {label}
                  </dt>
                  <dd className="text-primary order-1 text-4xl font-semibold tabular-nums">
                    {persianNumber.format(value as number)}
                  </dd>
                </div>
              ))}
            </dl>
            {statistics.data.searchable_property_count === 0 ? (
              <p
                className="text-muted-foreground mt-6 text-center"
                role="status"
              >
                هنوز ملک قابل جست‌وجویی منتشر نشده است.
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

const faqItems = [
  {
    question: "چطور ملک جست‌وجو کنم؟",
    answer: (
      <>
        شهر و نوع ملک را در بالای همین صفحه انتخاب کنید و دکمه جست‌وجو را بزنید.
        در صفحه نتایج می‌توانید فیلترهای دقیق‌تری اعمال کنید. جزئیات در
        <Link className="text-primary mx-1 underline" to="/guide">
          راهنمای جست‌وجو
        </Link>
        آمده است.
      </>
    ),
  },
  {
    question: "چه نوع ملک‌هایی در ترب‌رنت پشتیبانی می‌شوند؟",
    answer:
      "ملک‌های مسکونی شامل آپارتمان، خانه و ویلا و ملک‌های تجاری شامل دفتر اداری، مغازه، انبار و کارگاه هستند.",
  },
  {
    question: "ترب‌رنت در چه شهرهایی فعال است؟",
    answer:
      "در حال حاضر فقط ملک‌های تهران قابل جست‌وجو هستند. شهرهای دیگر تا زمان پشتیبانی واقعی به‌عنوان بازار فعال نمایش داده نمی‌شوند.",
  },
  {
    question: "آگهی‌ها چقدر تازه‌اند؟",
    answer:
      "فقط آگهی منتشرشده‌ای فعال است که منبعش فعال باشد، ناموجود نشده باشد و مهلت دسترس‌پذیری‌اش نگذشته باشد. زمان آخرین تأیید موجودی برای هر آگهی نمایش داده می‌شود.",
  },
  {
    question: "چرا ممکن است یک ملک چند آگهی داشته باشد؟",
    answer:
      "چند منبع می‌توانند همان ملک را با شرایط اجاره متفاوت آگهی کنند. ترب‌رنت آگهی‌های منابع را یکی نمی‌کند تا منبع و ادعای هرکدام شفاف بماند.",
  },
  {
    question: "چطور اطلاعات نادرست را گزارش کنم؟",
    answer: (
      <>
        از راه
        <Link className="text-primary mx-1 underline" to="/contact">
          تماس با پشتیبانی
        </Link>
        یک درخواست پشتیبانی ثبت کنید و نشانی ملک یا آگهی و مورد نادرست را توضیح
        دهید.
      </>
    ),
  },
] as const;

function FaqSection() {
  const [openQuestion, setOpenQuestion] = useState<number | null>(null);

  return (
    <section
      className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6 lg:px-10"
      aria-labelledby="faq-title"
    >
      <h2
        id="faq-title"
        className="text-center text-2xl font-semibold sm:text-3xl"
      >
        پرسش‌های پرتکرار
      </h2>
      <div className="mt-9 space-y-3">
        {faqItems.map((item, index) => {
          const isOpen = openQuestion === index;
          const panelId = `faq-answer-${index}`;
          return (
            <article
              key={item.question}
              className="border-border rounded-2xl border"
            >
              <h3>
                <button
                  type="button"
                  className="focus-visible:ring-ring flex min-h-14 w-full items-center justify-between gap-4 rounded-2xl px-5 py-4 text-start font-semibold focus-visible:ring-2 focus-visible:outline-none"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpenQuestion(isOpen ? null : index)}
                >
                  {item.question}
                  <ChevronDown
                    className={`text-muted-foreground size-5 shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              </h3>
              <div
                id={panelId}
                aria-hidden={!isOpen}
                className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
                  isOpen
                    ? "grid-rows-[1fr] opacity-100"
                    : "grid-rows-[0fr] opacity-0"
                }`}
                inert={!isOpen}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="text-muted-foreground px-5 pb-5 text-sm leading-7">
                    {item.answer}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

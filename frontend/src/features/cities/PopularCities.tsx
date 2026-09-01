import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

import cities from "./cities.json";

const tehranResults =
  "/search?location=%D8%AA%D9%87%D8%B1%D8%A7%D9%86&location_label=%D8%AA%D9%87%D8%B1%D8%A7%D9%86";

const postcardOrder = ["rasht", "isfahan", "tehran", "shiraz", "mashhad"];
const postcardCities = postcardOrder.map((slug) =>
  cities.find((city) => city.slug === slug)!,
);

const postcardHeights = [
  "lg:h-56",
  "lg:h-68",
  "lg:h-84",
  "lg:h-68",
  "lg:h-56",
] as const;

function CityPostcard({
  city,
  index,
}: {
  city: (typeof cities)[number];
  index: number;
}) {
  const content = (
    <>
      <img
        className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        src={city.image}
        alt={city.alt}
        width="640"
        height="427"
        loading={city.available ? "eager" : "lazy"}
      />
      <div
        className="absolute inset-0 bg-linear-to-t from-black/85 via-black/15 to-transparent"
        aria-hidden="true"
      />
      <div className="absolute inset-x-0 bottom-0 p-5 text-white">
        <h3 className="text-xl font-semibold">{city.name}</h3>
        <p className="mt-1 text-xs text-white/75">
          {city.available ? "جست‌وجو فعال است" : city.landmark}
        </p>
        <span
          className={`mt-3 inline-flex items-center gap-1.5 rounded-full bg-black/25 px-3 py-1.5 text-xs backdrop-blur-sm ${
            city.available ? "text-emerald-300" : "text-white/75"
          }`}
        >
          {city.available ? (
            <span
              className="size-1.5 rounded-full bg-current"
              aria-hidden="true"
            />
          ) : null}
          {city.available ? "مشاهده ملک‌ها" : "به‌زودی"}
        </span>
      </div>
    </>
  );

  return (
    <article
      className={`border-border bg-muted group relative h-72 w-[72vw] max-w-80 shrink-0 overflow-hidden rounded-3xl border shadow-lg shadow-black/10 sm:w-72 lg:w-auto lg:max-w-none ${postcardHeights[index]}`}
    >
      {city.available ? (
        <Link
          className="focus-visible:ring-ring block size-full rounded-3xl focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
          to={tehranResults}
          aria-label={`مشاهده ملک‌های ${city.name}`}
        >
          {content}
        </Link>
      ) : (
        content
      )}
    </article>
  );
}

const propertyPaths = [
  {
    category: "مسکونی",
    kicker: "خانه‌ای برای زندگی",
    description:
      "از آپارتمان‌های شهری تا خانه و ویلا، ملکی متناسب با سبک زندگی‌تان پیدا کنید.",
    ariaLabel: "انواع ملک مسکونی",
    types: [
      ["آپارتمان", "واحدهای آپارتمانی در محله‌های تهران", ["apartment"]],
      ["خانه", "خانه‌های مستقل و حیاط‌دار", ["house"]],
      ["ویلا", "خانه‌های ویلایی مناسب اجاره بلندمدت", ["villa"]],
    ],
  },
  {
    category: "تجاری",
    kicker: "فضایی برای کسب‌وکار",
    description:
      "دفتر، فروشگاه یا فضای عملیاتی متناسب با نیاز کسب‌وکارتان پیدا کنید.",
    ariaLabel: "انواع ملک تجاری",
    types: [
      ["دفتر اداری", "فضای حرفه‌ای برای دفتر و تیم", ["office"]],
      ["مغازه", "واحدهای تجاری در خیابان و پاساژ", ["shop"]],
      [
        "انبار و کارگاه",
        "فضای مناسب نگهداری و فعالیت عملیاتی",
        ["warehouse", "workshop"],
      ],
    ],
  },
] as const;

function propertyTypeResults(types: readonly string[]) {
  const params = new URLSearchParams("location=تهران&location_label=تهران");
  types.forEach((type) => params.append("property_type", type));
  return `/search?${params.toString()}`;
}

function PropertyTypePaths() {
  return (
    <section
      className="mx-auto w-full max-w-432 px-4 pt-18 pb-16 sm:px-6 lg:px-10 lg:pt-24"
      aria-labelledby="property-paths-title"
    >
      <header className="mb-9 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-primary mb-2 text-sm font-semibold">
            جست‌وجو بر اساس نوع ملک
          </p>
          <h2
            id="property-paths-title"
            className="text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            دنبال چه نوع ملکی هستید؟
          </h2>
        </div>
        <p className="text-muted-foreground max-w-xl leading-8">
          برای زندگی یا کسب‌وکار، نوع ملک را انتخاب کنید تا آگهی‌های مرتبط در
          تهران را ببینید.
        </p>
      </header>

      <div className="border-border grid border-y md:grid-cols-2">
        {propertyPaths.map((path) => (
          <div
            className="border-border py-9 first:border-b md:p-10 md:not-first:border-s md:first:border-s-0 md:first:border-b-0 lg:p-13"
            key={path.category}
          >
            <p className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
              <span
                className="bg-primary size-1.5 rounded-full"
                aria-hidden="true"
              />
              {path.kicker}
            </p>
            <h3 className="mt-4 text-5xl font-semibold tracking-tight sm:text-6xl">
              {path.category}
            </h3>
            <p className="text-muted-foreground mt-4 max-w-md text-sm leading-7">
              {path.description}
            </p>
            <nav
              className="border-border mt-8 border-t"
              aria-label={path.ariaLabel}
            >
              {path.types.map(([label, description, types]) => (
                <Link
                  className="border-border group/link hover:text-primary grid min-h-17 grid-cols-[minmax(6rem,.7fr)_1fr_auto] items-center gap-3 border-b py-3 transition-[color,padding] hover:px-2"
                  key={label}
                  to={propertyTypeResults(types)}
                >
                  <strong className="text-sm sm:text-base">{label}</strong>
                  <span className="text-muted-foreground text-xs leading-5">
                    {description}
                  </span>
                  <span className="border-border group-hover/link:border-primary group-hover/link:bg-primary group-hover/link:text-primary-foreground grid size-8 place-items-center rounded-full border transition-colors">
                    <ArrowLeft className="size-4" aria-hidden="true" />
                  </span>
                </Link>
              ))}
            </nav>
          </div>
        ))}
      </div>
    </section>
  );
}

export function PopularCities() {
  return (
    <>
      <section
        className="relative overflow-hidden"
        aria-labelledby="popular-cities-title"
      >
        <div
          className="bg-primary/10 pointer-events-none absolute top-1/2 left-1/2 -z-10 size-96 -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          aria-hidden="true"
        />
        <div className="mx-auto w-full max-w-432 px-4 pt-14 sm:px-6 lg:px-10">
          <header className="mx-auto mb-9 max-w-2xl text-center">
            <p className="text-muted-foreground mb-2 text-sm">کشف شهرها</p>
            <h2
              id="popular-cities-title"
              className="text-2xl font-semibold tracking-tight sm:text-3xl"
            >
              شهرهای محبوب
            </h2>
            <p className="text-muted-foreground mt-3 leading-7">
              جست‌وجوی تهران فعال است؛ پوشش شهرهای دیگر به‌تدریج اضافه می‌شود.
            </p>
          </header>
          <div className="-mx-4 flex items-end gap-3 overflow-x-auto px-4 pb-6 sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-[.85fr_1fr_1.3fr_1fr_.85fr] lg:overflow-visible lg:px-0 lg:pb-0">
            {postcardCities.map((city, index) => (
              <CityPostcard city={city} index={index} key={city.slug} />
            ))}
          </div>
        </div>
      </section>
      <PropertyTypePaths />
    </>
  );
}

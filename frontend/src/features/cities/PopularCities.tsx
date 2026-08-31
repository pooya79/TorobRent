import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

import cities from "./cities.json";

const tehranResults =
  "/search?location=%D8%AA%D9%87%D8%B1%D8%A7%D9%86&location_label=%D8%AA%D9%87%D8%B1%D8%A7%D9%86";

function CityCard({ city }: { city: (typeof cities)[number] }) {
  const content = (
    <>
      <div className="bg-muted aspect-3/2 overflow-hidden">
        <img
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          src={city.image}
          alt={city.alt}
          width="640"
          height="427"
          loading="lazy"
        />
      </div>
      <div className="flex min-h-24 items-center justify-between gap-3 p-4">
        <div>
          <h3 className="font-semibold">{city.name}</h3>
          <p className="text-muted-foreground mt-1 text-sm">{city.landmark}</p>
        </div>
        {city.available ? (
          <ArrowLeft
            className="text-primary size-5 shrink-0"
            aria-hidden="true"
          />
        ) : (
          <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-1 text-xs font-medium">
            به‌زودی
          </span>
        )}
      </div>
    </>
  );

  return (
    <article className="border-border bg-card group overflow-hidden rounded-2xl border shadow-sm">
      {city.available ? (
        <Link
          className="focus-visible:ring-ring block rounded-2xl focus-visible:ring-2 focus-visible:outline-none"
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

export function PopularCities() {
  return (
    <section
      className="mx-auto w-full max-w-432 px-4 py-14 sm:px-6 lg:px-10"
      aria-labelledby="popular-cities-title"
    >
      <header className="mb-7 max-w-2xl">
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
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {cities.map((city) => (
          <CityCard city={city} key={city.slug} />
        ))}
      </div>
    </section>
  );
}

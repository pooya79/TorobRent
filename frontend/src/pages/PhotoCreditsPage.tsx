import cities from "@/features/cities/cities.json";

export function PhotoCreditsPage() {
  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-16 lg:px-10"
      tabIndex={-1}
    >
      <header className="mb-10 max-w-3xl">
        <p className="text-primary mb-3 text-sm font-semibold">شفافیت رسانه</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          اعتبار عکس‌ها
        </h1>
        <p className="text-muted-foreground mt-4 leading-8">
          عکس‌های شهرها از ویکی‌انبار دریافت و برای نمایش در ترب‌رنت برش و بهینه
          شده‌اند. مشخصات اثر اصلی و شرایط مجوز هر عکس در ادامه آمده است.
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-2">
        {cities.map((city) => (
          <article
            className="border-border bg-card grid gap-4 rounded-2xl border p-5 sm:grid-cols-[8rem_1fr]"
            key={city.slug}
          >
            <img
              className="aspect-3/2 w-full rounded-xl object-cover"
              src={city.image}
              alt=""
              width="240"
              height="160"
              loading="lazy"
            />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">
                {city.name} — {city.landmark}
              </h2>
              <dl className="text-muted-foreground mt-3 space-y-2 text-sm leading-6">
                <div>
                  <dt className="text-foreground inline font-medium">عکاس: </dt>
                  <dd className="inline">{city.creator}</dd>
                </div>
                <div>
                  <dt className="text-foreground inline font-medium">مجوز: </dt>
                  <dd className="inline">
                    <a href={city.licenseUrl}>{city.licenseName}</a>
                  </dd>
                </div>
                <div>
                  <dt className="text-foreground inline font-medium">
                    نحوهٔ انتساب:{" "}
                  </dt>
                  <dd className="inline">{city.attribution}</dd>
                </div>
              </dl>
              <a
                className="text-primary mt-3 inline-flex min-h-11 items-center text-sm font-semibold"
                href={city.sourceUrl}
              >
                صفحهٔ منبع
              </a>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}

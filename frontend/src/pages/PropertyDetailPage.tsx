import { ArrowRight, Building2, Clock3, MapPin } from "lucide-react";

import { PageMain } from "@/components/layout/PageMain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { components } from "@/lib/api/schema";

type PropertyDetail = components["schemas"]["PropertyDetail"];
type FeatureState = components["schemas"]["FeatureStateEnum"];

const featureLabels = {
  parking: "پارکینگ",
  elevator: "آسانسور",
  storage: "انباری",
  balcony: "بالکن",
  furnished: "مبله",
} as const;

const featureStateLabels: Record<FeatureState, string> = {
  present: "دارد",
  absent: "ندارد",
  unknown: "نامشخص",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

function formatFreshness(value: string) {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    dateStyle: "medium",
  }).format(new Date(value));
}

export function PropertyDetailPage({
  property,
  returnTo,
}: {
  property: PropertyDetail;
  returnTo?: string | null;
}) {
  const safeReturnTo = returnTo?.startsWith("/search") ? returnTo : "/search";
  const location = [
    property.location.city,
    property.location.district,
    property.location.neighborhood,
  ].join("، ");
  const facts = [
    `${formatNumber(property.area_sqm)} متر`,
    `${formatNumber(property.room_count)} خواب`,
    property.floor === null ? null : `طبقه ${formatNumber(property.floor)}`,
    property.construction_year === null
      ? null
      : `سال ساخت ${formatNumber(property.construction_year)}`,
    property.total_floors === null
      ? null
      : `${formatNumber(property.total_floors)} طبقه`,
    property.units_per_floor === null
      ? null
      : `${formatNumber(property.units_per_floor)} واحد در هر طبقه`,
    property.heating ? `گرمایش: ${property.heating}` : null,
    property.cooling ? `سرمایش: ${property.cooling}` : null,
  ].filter((fact): fact is string => fact !== null);

  return (
    <PageMain>
      <Button asChild className="mb-6" variant="ghost">
        <a href={safeReturnTo}>
          <ArrowRight aria-hidden="true" /> بازگشت به نتایج
        </a>
      </Button>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,.65fr)]">
        <div>
          <div className="bg-muted text-muted-foreground flex aspect-[16/9] items-center justify-center rounded-xl">
            <div className="flex flex-col items-center gap-3 px-4 text-center text-sm">
              <Building2 className="size-12" aria-hidden="true" />
              تصویر مجازی برای این ملک منتشر نشده است
            </div>
          </div>
          <header className="py-7">
            <div className="text-muted-foreground mb-3 flex items-center gap-2 text-sm">
              <MapPin className="size-4" aria-hidden="true" />
              {location}
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {property.title}
            </h1>
            <ul className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          </header>

          <section aria-labelledby="normalized-facts-title">
            <h2
              id="normalized-facts-title"
              className="text-2xl font-semibold tracking-tight"
            >
              مشخصات تأییدشده ملک
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(featureLabels).map(([feature, label]) => {
                const state =
                  property.features[feature as keyof typeof featureLabels];
                return (
                  <Badge key={feature} variant="outline">
                    {label}: {featureStateLabels[state]}
                  </Badge>
                );
              })}
            </div>
          </section>
        </div>

        <section aria-labelledby="active-listings-title">
          <h2
            id="active-listings-title"
            className="mb-4 text-2xl font-semibold tracking-tight"
          >
            آگهی‌های فعال
          </h2>
          <div className="space-y-4">
            {property.listings.map((listing) => (
              <Card className="shadow-none" key={listing.id}>
                <article aria-label={`آگهی ${listing.source.display_name}`}>
                  <CardHeader>
                    <Badge variant="secondary" className="w-fit">
                      {listing.source.display_name}
                    </Badge>
                    <p className="text-lg font-semibold">
                      ودیعه {formatNumber(listing.rental_terms.deposit_toman)}{" "}
                      تومان
                    </p>
                    <p>
                      اجاره ماهانه{" "}
                      {formatNumber(listing.rental_terms.monthly_rent_toman)}{" "}
                      تومان
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {listing.description && <p>{listing.description}</p>}
                    <p className="text-muted-foreground flex items-center gap-2 text-sm">
                      <Clock3 className="size-4" aria-hidden="true" />
                      آخرین تأیید موجودی:{" "}
                      <time dateTime={listing.availability_confirmed_at}>
                        {formatFreshness(listing.availability_confirmed_at)}
                      </time>
                    </p>
                    {listing.source.outbound_policy === "external_link" &&
                      listing.external_url && (
                        <a
                          className="text-primary inline-flex min-h-11 items-center font-semibold"
                          href={listing.external_url}
                          rel="noopener noreferrer"
                        >
                          ادامه در منبع اصلی
                        </a>
                      )}
                  </CardContent>
                </article>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </PageMain>
  );
}

export default PropertyDetailPage;

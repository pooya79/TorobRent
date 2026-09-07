import { Building2, MapPin } from "lucide-react";
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { FavoriteButton } from "@/features/catalog/FavoriteButton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
export type PropertyCardData = {
  id: string;
  title: string;
  location: string;
  propertyTypeLabel: string;
  facts: readonly string[];
  image?: { url: string; width: number; height: number };
  listingCountLabel?: string;
  otherOffersLabel?: string;
  isFavorite: boolean;
  rentalTerms?: {
    depositLabel: string;
    monthlyRentLabel: string;
  };
  rentalTermsComparison?: {
    eligibility: "eligible" | "unavailable";
    isNegotiable: boolean;
    isConvertible: boolean;
    equivalentMonthlyCostLabel?: string;
  };
  navigation:
    | { kind: "property-detail"; href: string }
    | { kind: "temporarily-unavailable" };
};

export function PropertyCard({
  property,
  selected = false,
}: {
  property: PropertyCardData;
  selected?: boolean;
}) {
  return (
    <Card
      role="article"
      aria-label={property.title}
      data-selected={selected}
      className={cn(
        "group relative min-w-0 gap-0 overflow-hidden border-0 py-0 shadow-none",
        selected && "ring-primary rounded-xl ring-2 ring-offset-4",
      )}
    >
      <div className="bg-muted relative aspect-[4/3] overflow-hidden rounded-xl">
        <FavoriteButton
          propertyId={property.id}
          propertyTitle={property.title}
          isFavorite={property.isFavorite}
        />
        {property.image ? (
          <img
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
            src={property.image.url}
            width={property.image.width}
            height={property.image.height}
            alt=""
          />
        ) : (
          <div className="text-muted-foreground flex size-full flex-col items-center justify-center gap-3">
            <Building2 className="size-10" aria-hidden="true" />
            <span className="text-sm">
              تصویر {property.propertyTypeLabel} موجود نیست
            </span>
          </div>
        )}
        {property.listingCountLabel ? (
          <Badge className="bg-card text-foreground hover:bg-card absolute top-3 left-3 shadow-sm">
            {property.listingCountLabel}
          </Badge>
        ) : null}
      </div>
      <CardHeader className="gap-2 px-0 pt-3 pb-2">
        <div className="text-muted-foreground flex items-center gap-1 text-sm">
          <MapPin className="size-4" aria-hidden="true" />
          {property.location}
        </div>
        <h2 className="text-lg font-semibold tracking-tight">
          {property.navigation.kind === "temporarily-unavailable" ? (
            property.title
          ) : (
            <Link
              className="after:absolute after:inset-0 focus-visible:rounded-sm"
              to={property.navigation.href}
            >
              {property.title}
            </Link>
          )}
        </h2>
        <p className="text-muted-foreground text-sm">
          {property.facts.join(" · ")}
        </p>
      </CardHeader>
      {property.rentalTerms ? (
        <CardContent className="space-y-1 px-0 pb-3 text-sm">
          <div className="flex items-center gap-2 font-semibold">
            <p>ودیعه {property.rentalTerms.depositLabel}</p>
            {property.rentalTermsComparison &&
            (property.rentalTermsComparison.isNegotiable ||
              property.rentalTermsComparison.isConvertible) ? (
              <span className="text-muted-foreground text-xs font-normal">
                {[
                  property.rentalTermsComparison.isNegotiable && "قابل مذاکره",
                  property.rentalTermsComparison.isConvertible && "قابل تبدیل",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            ) : null}
          </div>
          <p>اجاره ماهانه {property.rentalTerms.monthlyRentLabel}</p>
          {property.rentalTermsComparison?.eligibility === "eligible" ? (
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-t pt-2">
              <span className="text-muted-foreground text-xs">
                برآورد ماهانه
              </span>
              <span className="font-semibold tabular-nums">
                {property.rentalTermsComparison.equivalentMonthlyCostLabel}
              </span>
            </div>
          ) : null}
          {property.otherOffersLabel ? (
            <p className="text-muted-foreground pt-1 text-xs">
              {property.otherOffersLabel}
            </p>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

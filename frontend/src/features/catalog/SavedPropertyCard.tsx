import { Building2 } from "lucide-react";
import { Link } from "react-router";

import { FavoriteButton } from "@/features/catalog/FavoriteButton";
import {
  propertyAreaAndRoomFacts,
  propertyLocationLabel,
  rentalTermsCardData,
} from "@/features/catalog/property-card-data";
import type { components } from "@/lib/api/schema";

type SavedPropertyCardProps =
  | {
      property: components["schemas"]["ActiveFavoriteSummary"];
      available: true;
    }
  | {
      property: components["schemas"]["UnavailableFavoriteSummary"];
      available: false;
    };

export function SavedPropertyCard(props: SavedPropertyCardProps) {
  const { property, available } = props;
  const image = props.available ? props.property.primary_image : null;
  const terms = props.available
    ? rentalTermsCardData(props.property.rental_terms)
    : null;

  return (
    <article
      aria-label={property.title}
      className="bg-card hover:border-primary/30 relative flex min-w-0 gap-3 rounded-2xl border p-3 transition-colors sm:gap-4 sm:p-4"
    >
      <div className="bg-muted text-muted-foreground flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl sm:w-24">
        {image ? (
          <img
            src={image.url}
            width={image.width}
            height={image.height}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <Building2 className="size-7" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="pe-9 text-sm leading-6 font-semibold">
          {available ? (
            <Link
              to={`/properties/${property.id}`}
              className="focus-visible:after:ring-ring line-clamp-2 after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2"
            >
              {property.title}
            </Link>
          ) : (
            <span className="line-clamp-2">{property.title}</span>
          )}
        </h3>
        <p
          className="text-muted-foreground mt-1 truncate text-xs"
          title={propertyLocationLabel(property)}
        >
          {propertyLocationLabel(property)}
        </p>
        <p className="text-muted-foreground mt-2 text-xs leading-5">
          {[
            property.property_type_label,
            ...propertyAreaAndRoomFacts(property),
          ].join(" · ")}
        </p>
        {terms ? (
          <dl className="mt-3 space-y-1 text-xs leading-5">
            <div className="flex flex-wrap justify-between gap-x-2">
              <dt className="text-muted-foreground">رهن</dt>
              <dd className="font-medium tabular-nums">{terms.depositLabel}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-2">
              <dt className="text-muted-foreground">اجاره ماهانه</dt>
              <dd className="font-medium tabular-nums">
                {terms.monthlyRentLabel}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-muted-foreground mt-3 text-xs">بدون آگهی فعال</p>
        )}
      </div>
      <FavoriteButton
        propertyId={property.id}
        propertyTitle={property.title}
        isFavorite
        className="top-2 right-auto left-2 bg-transparent shadow-none"
      />
    </article>
  );
}

import { useQuery } from "@tanstack/react-query";

import {
  PropertyCard,
  type PropertyCardData,
} from "@/components/properties/PropertyCard";
import { favoritesQueryOptions } from "@/features/catalog/queries";
import {
  formatNumber,
  propertyAreaAndRoomFacts,
  propertyLocationLabel,
  rentalTermsCardData,
} from "@/features/catalog/property-card-data";
import type { components } from "@/lib/api/schema";

type ActiveFavorite = components["schemas"]["ActiveFavoriteSummary"];
type UnavailableFavorite = components["schemas"]["UnavailableFavoriteSummary"];

function normalizedFacts(property: ActiveFavorite | UnavailableFavorite) {
  return [property.property_type_label, ...propertyAreaAndRoomFacts(property)];
}

function activeCard(property: ActiveFavorite): PropertyCardData {
  return {
    id: property.id,
    title: property.title,
    location: propertyLocationLabel(property),
    propertyTypeLabel: property.property_type_label,
    facts: normalizedFacts(property),
    image: property.primary_image ?? undefined,
    isFavorite: true,
    listingCountLabel: `${formatNumber(property.listing_count)} آگهی فعال`,
    otherOffersLabel:
      property.listing_count > 1
        ? `${formatNumber(property.listing_count - 1)} پیشنهاد دیگر`
        : undefined,
    rentalTerms: rentalTermsCardData(property.rental_terms),
    navigation: {
      kind: "property-detail",
      href: `/properties/${property.id}`,
    },
  };
}

function unavailableCard(property: UnavailableFavorite): PropertyCardData {
  return {
    id: property.id,
    title: property.title,
    location: propertyLocationLabel(property),
    propertyTypeLabel: property.property_type_label,
    facts: normalizedFacts(property),
    isFavorite: true,
    navigation: { kind: "temporarily-unavailable" },
  };
}

export function FavoritesPage() {
  const favorites = useQuery(favoritesQueryOptions());

  return (
    <main
      id="main-content"
      className="mx-auto w-full max-w-360 px-4 py-12 sm:px-6 lg:px-10"
      tabIndex={-1}
    >
      <h1 className="text-3xl font-semibold">علاقه‌مندی‌ها</h1>
      <p className="text-muted-foreground mt-4 leading-7">
        ملک‌های ذخیره‌شدهٔ شما با موجودی فعلی‌شان نمایش داده می‌شوند.
      </p>
      {favorites.isPending ? (
        <p className="text-muted-foreground mt-8" role="status">
          در حال بارگذاری علاقه‌مندی‌ها…
        </p>
      ) : favorites.isError ? (
        <p className="text-destructive mt-8" role="alert">
          بارگذاری علاقه‌مندی‌ها انجام نشد. دوباره تلاش کنید.
        </p>
      ) : (
        <div className="mt-10 space-y-14">
          <section aria-labelledby="active-favorites-heading" role="region">
            <h2
              id="active-favorites-heading"
              className="text-2xl font-semibold"
            >
              ملک‌های در دسترس
            </h2>
            {favorites.data.active.length ? (
              <div className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {favorites.data.active.map((property) => (
                  <PropertyCard
                    key={property.id}
                    property={activeCard(property)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground mt-4">
                هنوز ملکی ذخیره نکرده‌اید.
              </p>
            )}
          </section>
          <section
            aria-labelledby="unavailable-favorites-heading"
            role="region"
          >
            <h2
              id="unavailable-favorites-heading"
              className="text-2xl font-semibold"
            >
              فعلاً در دسترس نیست
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              این ملک‌ها ذخیره می‌مانند، اما تا انتشار آگهی فعال جدید قابل
              بازکردن نیستند.
            </p>
            {favorites.data.unavailable.length ? (
              <div className="mt-6 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
                {favorites.data.unavailable.map((property) => (
                  <PropertyCard
                    key={property.id}
                    property={unavailableCard(property)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground mt-4">
                ملک ذخیره‌شدهٔ ناموجودی ندارید.
              </p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

export default FavoritesPage;

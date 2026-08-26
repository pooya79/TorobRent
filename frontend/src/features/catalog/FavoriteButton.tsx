import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";

import { useRenterAccess } from "@/features/session/RenterAccessDialog";
import { sessionQuery } from "@/features/session/queries";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { cn } from "@/lib/utils";

type PropertySearchPage = components["schemas"]["PropertySearchPage"];
type FavoriteCollection = components["schemas"]["FavoriteCollection"];

function withFavoriteState(
  page: PropertySearchPage | undefined,
  propertyId: string,
  isFavorite: boolean,
) {
  if (!page) return page;
  const updateProperty = <Property extends { id: string }>(
    property: Property,
  ) =>
    property.id === propertyId
      ? { ...property, is_favorite: isFavorite }
      : property;
  return {
    ...page,
    results: page.results.map(updateProperty),
    map: {
      ...page.map,
      markers: page.map.markers.map(updateProperty),
    },
  };
}

export function FavoriteButton({
  propertyId,
  propertyTitle,
  isFavorite,
}: {
  propertyId: string;
  propertyTitle: string;
  isFavorite: boolean;
}) {
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery);
  const { requestRenterAccess } = useRenterAccess();
  const mutation = useMutation({
    mutationFn: async (nextFavorite: boolean) => {
      const params = { path: { property_id: propertyId } };
      const response = nextFavorite
        ? await api.PUT("/api/v1/catalog/properties/{property_id}/favorite/", {
            params,
          })
        : await api.DELETE(
            "/api/v1/catalog/properties/{property_id}/favorite/",
            { params },
          );
      if (response.error) throw new Error("Favorite mutation failed");
    },
    onMutate: async (nextFavorite) => {
      await queryClient.cancelQueries({
        queryKey: ["catalog", "properties"],
      });
      for (const [
        queryKey,
        page,
      ] of queryClient.getQueriesData<PropertySearchPage>({
        queryKey: ["catalog", "properties"],
      })) {
        queryClient.setQueryData(
          queryKey,
          withFavoriteState(page, propertyId, nextFavorite),
        );
      }
      await queryClient.cancelQueries({ queryKey: ["catalog", "favorites"] });
      const previousCollection = queryClient.getQueryData<FavoriteCollection>([
        "catalog",
        "favorites",
      ]);
      if (!nextFavorite && previousCollection) {
        queryClient.setQueryData<FavoriteCollection>(["catalog", "favorites"], {
          active: previousCollection.active.filter(
            (property) => property.id !== propertyId,
          ),
          unavailable: previousCollection.unavailable.filter(
            (property) => property.id !== propertyId,
          ),
        });
      }
      return { previousFavorite: isFavorite, previousCollection };
    },
    onError: (_error, _nextFavorite, context) => {
      for (const [
        queryKey,
        page,
      ] of queryClient.getQueriesData<PropertySearchPage>({
        queryKey: ["catalog", "properties"],
      })) {
        queryClient.setQueryData(
          queryKey,
          withFavoriteState(
            page,
            propertyId,
            context?.previousFavorite ?? isFavorite,
          ),
        );
      }
      if (context?.previousCollection) {
        queryClient.setQueryData(
          ["catalog", "favorites"],
          context.previousCollection,
        );
      }
    },
    onSuccess: (_data, nextFavorite) => {
      if (nextFavorite) {
        void queryClient.invalidateQueries({
          queryKey: ["catalog", "favorites"],
        });
      }
    },
  });
  const nextFavorite = !isFavorite;
  const accessibleName = isFavorite
    ? `حذف ${propertyTitle} از علاقه‌مندی‌ها`
    : `ذخیره ${propertyTitle} در علاقه‌مندی‌ها`;

  return (
    <>
      <button
        type="button"
        className="bg-card text-foreground focus-visible:ring-ring absolute top-3 right-3 z-10 flex size-10 items-center justify-center rounded-full shadow-sm focus-visible:ring-2 focus-visible:outline-none"
        aria-label={accessibleName}
        aria-pressed={isFavorite}
        aria-busy={!session.data}
        disabled={!session.data}
        onClick={() => {
          if (session.data?.authenticated) {
            mutation.mutate(nextFavorite);
            return;
          }
          requestRenterAccess(() => mutation.mutate(true));
        }}
      >
        <Heart
          aria-hidden="true"
          className={cn(
            "size-5 transition-all duration-200 motion-reduce:transition-none",
            isFavorite && "fill-destructive text-destructive scale-110",
          )}
        />
      </button>
      {mutation.isError ? (
        <p
          className="bg-destructive text-destructive-foreground absolute inset-x-3 bottom-3 z-10 rounded-md px-3 py-2 text-xs"
          role="alert"
          aria-label="ذخیره علاقه‌مندی انجام نشد. دوباره تلاش کنید."
        >
          ذخیره علاقه‌مندی انجام نشد. دوباره تلاش کنید.
        </p>
      ) : null}
    </>
  );
}

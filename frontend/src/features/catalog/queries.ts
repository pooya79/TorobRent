import { queryOptions } from "@tanstack/react-query";

import { createApiClient } from "@/lib/api/client";
import type { operations } from "@/lib/api/schema";
import { normalizeNumericEntry } from "./numeric-entry";
import {
  selectedPropertyCategory,
  selectedPropertyTypesForCategory,
} from "./property-type-selection";

type PropertySearchQuery = NonNullable<
  operations["v1_catalog_properties_list"]["parameters"]["query"]
>;

export class PropertyUnavailableError extends Error {
  constructor(readonly status: number) {
    super("Property is unavailable");
  }
}

export class CatalogSearchError extends Error {
  constructor(readonly status: number) {
    super("Catalog search failed");
  }
}

export function locationAutocompleteQueryOptions(query: string) {
  return queryOptions({
    queryKey: ["catalog", "locations", query] as const,
    enabled: query.trim().length >= 2,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const baseUrl =
        typeof window === "undefined" ? "" : window.location.origin;
      const { data, response } = await createApiClient(baseUrl).GET(
        "/api/v1/catalog/locations/",
        { params: { query: { q: query } } },
      );
      if (!data) throw new CatalogSearchError(response.status);
      return data;
    },
  });
}

export function supportedCitiesQueryOptions() {
  return queryOptions({
    queryKey: ["catalog", "supported-cities"] as const,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const baseUrl =
        typeof window === "undefined" ? "" : window.location.origin;
      const { data, response } = await createApiClient(baseUrl).GET(
        "/api/v1/catalog/supported-cities/",
      );
      if (!data) throw new CatalogSearchError(response.status);
      return data;
    },
  });
}

export function catalogStatisticsQueryOptions() {
  return queryOptions({
    queryKey: ["catalog", "statistics"] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const baseUrl =
        typeof window === "undefined" ? "" : window.location.origin;
      const { data, response } = await createApiClient(baseUrl).GET(
        "/api/v1/catalog/statistics/",
      );
      if (!data) throw new CatalogSearchError(response.status);
      return data;
    },
  });
}

export function propertySearchQueryOptions(searchParams: URLSearchParams) {
  const propertyCategory = selectedPropertyCategory(searchParams);
  const integerParameter = (name: string) => {
    const rawValue = searchParams.get(name);
    if (rawValue === null || rawValue === "") return undefined;
    const value = Number(normalizeNumericEntry(rawValue));
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  };
  const query = {
    location: searchParams.get("location") ?? undefined,
    property_category: propertyCategory,
    page: integerParameter("page"),
    deposit_min_toman: integerParameter("deposit_min_toman"),
    deposit_max_toman: integerParameter("deposit_max_toman"),
    monthly_rent_min_toman: integerParameter("monthly_rent_min_toman"),
    monthly_rent_max_toman: integerParameter("monthly_rent_max_toman"),
    area_min: integerParameter("area_min"),
    area_max: integerParameter("area_max"),
    room_count:
      searchParams.get("room_count") === "3_plus"
        ? "3_plus"
        : integerParameter("room_count"),
    property_type: searchParams.has("property_type")
      ? selectedPropertyTypesForCategory(searchParams, propertyCategory)
      : undefined,
    parking:
      (searchParams.get("parking") as PropertySearchQuery["parking"]) ??
      undefined,
    elevator:
      (searchParams.get("elevator") as PropertySearchQuery["elevator"]) ??
      undefined,
    storage:
      (searchParams.get("storage") as PropertySearchQuery["storage"]) ??
      undefined,
    balcony:
      (searchParams.get("balcony") as PropertySearchQuery["balcony"]) ??
      undefined,
    furnished:
      (searchParams.get("furnished") as PropertySearchQuery["furnished"]) ??
      undefined,
    ordering:
      (searchParams.get("ordering") as PropertySearchQuery["ordering"]) ??
      undefined,
  } satisfies PropertySearchQuery;
  return queryOptions({
    queryKey: ["catalog", "properties", query] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const baseUrl =
        typeof window === "undefined" ? "" : window.location.origin;
      const { data, response } = await createApiClient(baseUrl).GET(
        "/api/v1/catalog/properties/",
        { params: { query } },
      );
      if (!data) throw new CatalogSearchError(response.status);
      return data;
    },
  });
}

export function propertyDetailQueryOptions(
  baseUrl: string,
  propertyId: string,
) {
  return queryOptions({
    queryKey: ["catalog", "property", propertyId] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const client = createApiClient(baseUrl);
      const { data, response } = await client.GET(
        "/api/v1/catalog/properties/{property_id}/",
        { params: { path: { property_id: propertyId } } },
      );
      if (!data) throw new PropertyUnavailableError(response.status);
      return data;
    },
  });
}

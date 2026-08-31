import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
} from "@tanstack/react-query";

import { createApiClient } from "@/lib/api/client";
import type { components, operations } from "@/lib/api/schema";
import {
  BEDROOM_COUNT_PARAMETER,
  LEGACY_BEDROOM_COUNT_PARAMETER,
  THREE_OR_MORE_BEDROOMS,
} from "./bedroom-filter";
import { normalizeNumericEntry } from "./numeric-entry";
import {
  selectedPropertyCategory,
  selectedPropertyTypes,
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

async function fetchPropertySearchPage(
  query: PropertySearchQuery,
  signal: AbortSignal,
  baseUrl = typeof window === "undefined" ? "" : window.location.origin,
) {
  const { data, response } = await createApiClient(baseUrl).GET(
    "/api/v1/catalog/properties/",
    { params: { query }, signal },
  );
  if (!data) throw new CatalogSearchError(response.status);
  return data;
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

export function favoritesQueryOptions() {
  return queryOptions({
    queryKey: ["catalog", "favorites"] as const,
    queryFn: async () => {
      const baseUrl =
        typeof window === "undefined" ? "" : window.location.origin;
      const { data, response } = await createApiClient(baseUrl).GET(
        "/api/v1/catalog/favorites/",
      );
      if (!data) throw new CatalogSearchError(response.status);
      return data;
    },
  });
}

function propertySearchRequest(searchParams: URLSearchParams) {
  const propertyCategory = selectedPropertyCategory(searchParams);
  const propertyTypes = selectedPropertyTypes(searchParams);
  const hasSelectedPropertyTypes = propertyTypes.length > 0;
  const requestedCategory = searchParams.get("property_category");
  const hasExplicitPropertyCategory =
    requestedCategory === "residential" || requestedCategory === "commercial";
  const integerParameter = (name: string) => {
    const rawValue = searchParams.get(name);
    if (rawValue === null || rawValue === "") return undefined;
    const value = Number(normalizeNumericEntry(rawValue));
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  };
  const bedroomCountParameter = (
    name:
      typeof BEDROOM_COUNT_PARAMETER | typeof LEGACY_BEDROOM_COUNT_PARAMETER,
  ) =>
    searchParams.get(name) === THREE_OR_MORE_BEDROOMS
      ? THREE_OR_MORE_BEDROOMS
      : integerParameter(name);
  return {
    location: searchParams.get("location") ?? undefined,
    district: searchParams.has("district")
      ? searchParams.getAll("district")
      : undefined,
    neighborhood: searchParams.has("neighborhood")
      ? searchParams.getAll("neighborhood")
      : undefined,
    property_category:
      !hasSelectedPropertyTypes || hasExplicitPropertyCategory
        ? propertyCategory
        : undefined,
    page: integerParameter("page"),
    deposit_min_toman: integerParameter("deposit_min_toman"),
    deposit_max_toman: integerParameter("deposit_max_toman"),
    monthly_rent_min_toman: integerParameter("monthly_rent_min_toman"),
    monthly_rent_max_toman: integerParameter("monthly_rent_max_toman"),
    area_min: integerParameter("area_min"),
    area_max: integerParameter("area_max"),
    construction_year_min: integerParameter("construction_year_min"),
    construction_year_max: integerParameter("construction_year_max"),
    bedroom_count: bedroomCountParameter(BEDROOM_COUNT_PARAMETER),
    room_count: searchParams.has(BEDROOM_COUNT_PARAMETER)
      ? undefined
      : bedroomCountParameter(LEGACY_BEDROOM_COUNT_PARAMETER),
    property_type: hasSelectedPropertyTypes
      ? hasExplicitPropertyCategory
        ? selectedPropertyTypesForCategory(searchParams, propertyCategory)
        : propertyTypes
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
    viewport_north: searchParams.get("viewport_north") ?? undefined,
    viewport_east: searchParams.get("viewport_east") ?? undefined,
    viewport_south: searchParams.get("viewport_south") ?? undefined,
    viewport_west: searchParams.get("viewport_west") ?? undefined,
    viewport_zoom: integerParameter("viewport_zoom"),
  } satisfies PropertySearchQuery;
}

export function propertySearchQueryOptions(
  searchParams: URLSearchParams,
  enabled = true,
) {
  const requestSearchParams = searchParams.toString();
  const query = propertySearchRequest(searchParams);
  return queryOptions({
    queryKey: ["catalog", "properties", query] as const,
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => ({
      ...(await fetchPropertySearchPage(query, signal)),
      requestSearchParams,
    }),
  });
}

export function propertySearchInfiniteQueryOptions(
  searchParams: URLSearchParams,
  baseUrl?: string,
) {
  const firstPageSearchParams = new URLSearchParams(searchParams);
  firstPageSearchParams.delete("page");
  const requestSearchParams = firstPageSearchParams.toString();
  const query = propertySearchRequest(firstPageSearchParams);
  return infiniteQueryOptions({
    queryKey: ["catalog", "properties", "infinite", query] as const,
    initialPageParam: null as string | null,
    staleTime: 30_000,
    queryFn: async ({ pageParam, signal }) => {
      const requestBaseUrl =
        baseUrl ??
        (typeof window === "undefined" ? "" : window.location.origin);
      if (pageParam) {
        const serverContinuation = new URL(pageParam, requestBaseUrl);
        const sameOriginContinuation = new URL(
          `${serverContinuation.pathname}${serverContinuation.search}`,
          requestBaseUrl,
        );
        const response = await fetch(sameOriginContinuation, {
          credentials: "include",
          signal,
        });
        if (!response.ok) throw new CatalogSearchError(response.status);
        const data =
          (await response.json()) as components["schemas"]["PropertySearchPage"];
        return { ...data, requestSearchParams };
      }
      return {
        ...(await fetchPropertySearchPage(query, signal, requestBaseUrl)),
        requestSearchParams,
      };
    },
    getNextPageParam: (lastPage) => lastPage.next,
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

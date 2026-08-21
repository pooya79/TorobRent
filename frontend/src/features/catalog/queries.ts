import { queryOptions } from "@tanstack/react-query";

import { createApiClient } from "@/lib/api/client";

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

export function propertySearchQueryOptions(searchParams: URLSearchParams) {
  const location = searchParams.get("location") ?? undefined;
  const pageValue = Number(searchParams.get("page") ?? "1");
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  return queryOptions({
    queryKey: ["catalog", "properties", { location, page }] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const baseUrl =
        typeof window === "undefined" ? "" : window.location.origin;
      const { data, response } = await createApiClient(baseUrl).GET(
        "/api/v1/catalog/properties/",
        { params: { query: { location, page } } },
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

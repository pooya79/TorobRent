import { queryOptions } from "@tanstack/react-query";

import { createApiClient } from "@/lib/api/client";

export class PropertyUnavailableError extends Error {
  constructor(readonly status: number) {
    super("Property is unavailable");
  }
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

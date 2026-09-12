import { queryOptions } from "@tanstack/react-query";

import { api } from "@/lib/api/client";

export function catalogCurationSearchQuery(
  searchTerm: string | null,
  page: number,
) {
  return queryOptions({
    queryKey: ["catalog-curation", "properties", searchTerm, page],
    enabled: searchTerm !== null,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/operator/catalog-curation/properties/",
        { params: { query: { q: searchTerm ?? "", page } } },
      );
      if (error || !data) throw new Error("Could not search Properties");
      return data;
    },
  });
}

export function propertyComparisonQuery(propertyIds: readonly string[] | null) {
  return queryOptions({
    queryKey: ["catalog-curation", "comparison", propertyIds],
    enabled: propertyIds?.length === 2,
    queryFn: async () => {
      if (!propertyIds || propertyIds.length !== 2) {
        throw new Error("Two Properties are required");
      }
      const { data, error } = await api.GET(
        "/api/v1/operator/catalog-curation/comparison/",
        { params: { query: { property: [...propertyIds] } } },
      );
      if (error || !data) throw new Error("Could not compare Properties");
      return data;
    },
  });
}

export function propertyMatchSuggestionsQuery(
  page: number,
  band: "likely" | "possible" | "all",
  claim: "unclaimed" | "claimed" | "all",
  ordering: "confidence" | "oldest" | "newest_evidence",
) {
  return queryOptions({
    queryKey: ["catalog-curation", "suggestions", page, band, claim, ordering],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/operator/catalog-curation/suggestions/",
        {
          params: {
            query: {
              band,
              claim,
              ordering,
              page,
            },
          },
        },
      );
      if (error || !data)
        throw new Error("Could not load Property Match Suggestions");
      return data;
    },
  });
}

export function propertyMatchSuggestionDetailQuery(
  suggestionId: string | null,
) {
  return queryOptions({
    queryKey: ["catalog-curation", "suggestions", suggestionId],
    enabled: suggestionId !== null,
    queryFn: async () => {
      if (!suggestionId) throw new Error("A suggestion is required");
      const { data, error } = await api.GET(
        "/api/v1/operator/catalog-curation/suggestions/{suggestion_id}/",
        { params: { path: { suggestion_id: suggestionId } } },
      );
      if (error || !data) throw new Error("Could not load the suggestion");
      return data;
    },
  });
}

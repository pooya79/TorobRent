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

export function propertyMatchSuggestionsQuery(filters: {
  page: number;
  q: string;
  band: "likely" | "possible" | "below_threshold" | "all";
  claim: "unclaimed" | "claimed" | "mine" | "all";
  state: "pending" | "approved" | "rejected" | "snoozed" | "superseded" | "all";
  age: "all" | "older_than_24_hours" | "older_than_7_days";
  ownWork: "all" | "clear" | "conflict";
  ordering: "confidence" | "oldest" | "newest_evidence" | "status";
}) {
  return queryOptions({
    queryKey: ["catalog-curation", "suggestions", filters],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/operator/catalog-curation/suggestions/",
        {
          params: {
            query: {
              q: filters.q,
              band: filters.band,
              claim: filters.claim,
              state: filters.state,
              age: filters.age,
              own_work: filters.ownWork,
              ordering: filters.ordering,
              page: filters.page,
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

export function groupedPropertiesQuery(filters: {
  page: number;
  q: string;
  attention: "all" | "needs_attention";
  changed: "all" | "recent";
  stability: "all" | "stable";
  measurementStatus: "all" | "measured" | "stale" | "not_measured";
  scoringVersion: string;
  ordering:
    "needs_attention" | "recent_change" | "stability" | "measurement_status";
}) {
  return queryOptions({
    queryKey: ["catalog-curation", "grouped-properties", filters],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/operator/catalog-curation/grouped-properties/",
        {
          params: {
            query: {
              page: filters.page,
              q: filters.q,
              attention: filters.attention,
              changed: filters.changed,
              stability: filters.stability,
              measurement_status: filters.measurementStatus,
              scoring_version: filters.scoringVersion,
              ordering: filters.ordering,
            },
          },
        },
      );
      if (error || !data) throw new Error("Could not load grouped Properties");
      return data;
    },
  });
}

export function catalogCurationSummaryQuery(enabled = true) {
  return queryOptions({
    queryKey: ["catalog-curation", "summary"],
    enabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/operator/catalog-curation/summary/",
      );
      if (error || !data)
        throw new Error("Could not load Catalog Curation summary");
      return data;
    },
  });
}

export function catalogCurationMetricsQuery() {
  return queryOptions({
    queryKey: ["catalog-curation", "metrics"],
    queryFn: async () => {
      const { data, error } = await api.GET(
        "/api/v1/operator/catalog-curation/metrics/",
      );
      if (error || !data)
        throw new Error("Could not load Catalog Curation metrics");
      return data;
    },
  });
}

export function groupedPropertyDetailQuery(propertyId: string | null) {
  return queryOptions({
    queryKey: ["catalog-curation", "grouped-properties", propertyId],
    enabled: propertyId !== null,
    queryFn: async () => {
      if (!propertyId) throw new Error("A grouped Property is required");
      const { data, error } = await api.GET(
        "/api/v1/operator/catalog-curation/grouped-properties/{property_id}/",
        { params: { path: { property_id: propertyId } } },
      );
      if (error || !data) throw new Error("Could not load grouped Property");
      return data;
    },
  });
}

import type { components } from "@/lib/api/schema";
import type { PropertyType } from "./property-taxonomy";

export type CatalogFacetData = components["schemas"]["CatalogFacets"];

export function propertyTypeFacetCounts(facets?: CatalogFacetData) {
  return Object.fromEntries(
    (facets?.property_types ?? []).map(({ value, count }) => [value, count]),
  ) as Partial<Record<PropertyType, number>>;
}

import type { SetURLSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import type { components } from "@/lib/api/schema";
import { cn } from "@/lib/utils";
import type { PropertyCategory, PropertyType } from "./property-taxonomy";

export type CatalogFacetData = components["schemas"]["CatalogFacets"];

export function propertyTypeFacetCounts(facets?: CatalogFacetData) {
  return Object.fromEntries(
    (facets?.property_types ?? []).map(({ value, count }) => [value, count]),
  ) as Partial<Record<PropertyType, number>>;
}

const quickFilters = {
  residential: [
    {
      parameter: "room_count",
      value: "1",
      label: "یک خوابه",
      facet: "bedroom",
    },
    {
      parameter: "room_count",
      value: "2",
      label: "دو خوابه",
      facet: "bedroom",
    },
    {
      parameter: "room_count",
      value: "3_plus",
      label: "سه خواب و بیشتر",
      facet: "bedroom",
    },
    {
      parameter: "parking",
      value: "present",
      label: "پارکینگ",
      facet: "feature",
    },
    {
      parameter: "elevator",
      value: "present",
      label: "آسانسور",
      facet: "feature",
    },
    {
      parameter: "furnished",
      value: "present",
      label: "مبله",
      facet: "feature",
    },
  ],
  commercial: [
    {
      parameter: "parking",
      value: "present",
      label: "پارکینگ",
      facet: "feature",
    },
    {
      parameter: "elevator",
      value: "present",
      label: "آسانسور",
      facet: "feature",
    },
    {
      parameter: "storage",
      value: "present",
      label: "انباری",
      facet: "feature",
    },
  ],
} as const satisfies Record<
  PropertyCategory,
  readonly {
    parameter: "room_count" | "parking" | "elevator" | "storage" | "furnished";
    value: string;
    label: string;
    facet: "bedroom" | "feature";
  }[]
>;

export function QuickFilters({
  category,
  facets,
  searchParams,
  setSearchParams,
}: {
  category: PropertyCategory;
  facets?: CatalogFacetData;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
}) {
  const countFor = (
    filter: (typeof quickFilters)[PropertyCategory][number],
  ) => {
    if (!facets) return undefined;
    if (filter.facet === "bedroom") {
      return (
        facets.bedroom_counts.find(({ value }) => value === filter.value)
          ?.count ?? 0
      );
    }
    return facets.features[filter.parameter].present;
  };

  return (
    <fieldset className="mt-3 flex flex-wrap items-center gap-2">
      <legend className="sr-only">فیلترهای سریع</legend>
      {quickFilters[category].map((filter) => {
        const selected = searchParams.get(filter.parameter) === filter.value;
        const count = countFor(filter);
        return (
          <Button
            key={`${filter.parameter}-${filter.value}`}
            className={cn(
              selected && "border-primary bg-primary/10 text-primary",
            )}
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={selected}
            disabled={!selected && count === 0}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              if (selected) next.delete(filter.parameter);
              else next.set(filter.parameter, filter.value);
              next.delete("page");
              setSearchParams(next);
            }}
          >
            {filter.label}
            {count !== undefined && (
              <span aria-hidden="true">({count.toLocaleString("fa-IR")})</span>
            )}
          </Button>
        );
      })}
    </fieldset>
  );
}

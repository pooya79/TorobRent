import type { SetURLSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  BEDROOM_COUNT_PARAMETER,
  LEGACY_BEDROOM_COUNT_PARAMETER,
} from "./bedroom-filter";
import type { CatalogFacetData } from "./facets";
import type { PropertyCategory } from "./property-taxonomy";
import { quickFilterOptions } from "./quick-filter-options";

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
    filter: (typeof quickFilterOptions)[PropertyCategory][number],
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
    <fieldset className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
      <legend className="sr-only">فیلترهای سریع</legend>
      {quickFilterOptions[category].map((filter) => {
        const selectedValue =
          filter.parameter === BEDROOM_COUNT_PARAMETER
            ? (searchParams.get(BEDROOM_COUNT_PARAMETER) ??
              searchParams.get(LEGACY_BEDROOM_COUNT_PARAMETER))
            : searchParams.get(filter.parameter);
        const selected = selectedValue === filter.value;
        const count = countFor(filter);
        return (
          <Button
            key={`${filter.parameter}-${filter.value}`}
            className={cn(
              "shrink-0",
              selected && "border-primary bg-primary/10 text-primary",
            )}
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={selected}
            disabled={!selected && count === 0}
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              if (filter.parameter === BEDROOM_COUNT_PARAMETER) {
                next.delete(LEGACY_BEDROOM_COUNT_PARAMETER);
              }
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

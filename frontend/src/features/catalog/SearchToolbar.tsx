import { Building2, MapPin } from "lucide-react";
import type { SetURLSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type CatalogFacetData, propertyTypeFacetCounts } from "./facets";
import { PropertyTypeSelector } from "./PropertyTypeSelector";
import {
  selectedPropertyCategory,
  selectedPropertyTypesForCategory,
} from "./property-type-selection";
import { propertyTypeGroups, type PropertyCategory } from "./property-taxonomy";
import { SupportedCityCombobox } from "./SupportedCityCombobox";
import { QuickFilters } from "./QuickFilters";
import { categorySpecificQuickFilterParameters } from "./quick-filter-options";

export function SearchToolbar({
  searchParams,
  setSearchParams,
  facets,
}: {
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  facets?: CatalogFacetData;
}) {
  const category = selectedPropertyCategory(searchParams);
  const selectedTypes = selectedPropertyTypesForCategory(
    searchParams,
    category,
  );
  const cityName = searchParams.get("location_label") ?? "تهران";
  const locationValue = searchParams.get("location") ?? "تهران";

  const updateCategory = (nextCategory: PropertyCategory) => {
    if (nextCategory === category) return;
    const next = new URLSearchParams(searchParams);
    next.set("property_category", nextCategory);
    next.delete("property_type");
    for (const filter of categorySpecificQuickFilterParameters(category)) {
      next.delete(filter);
    }
    next.delete("page");
    setSearchParams(next);
  };

  return (
    <section
      className="border-border bg-background/95 sticky top-[4.75rem] z-20 -mx-4 mb-8 border-y px-4 py-3 shadow-sm backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10"
      role="search"
      aria-label="نوار جست‌وجوی ملک"
    >
      <div className="grid gap-3 md:grid-cols-[minmax(12rem,1fr)_auto_minmax(13rem,1fr)] md:items-end">
        <div className="border-border relative flex min-h-14 items-center gap-3 rounded-xl border px-4">
          <MapPin
            className="text-muted-foreground size-5 shrink-0"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1 text-start">
            <span className="block text-xs font-semibold">شهر</span>
            <SupportedCityCombobox
              key={`${locationValue}-${cityName}`}
              initialCity={{ id: locationValue, name: cityName }}
              showUpcoming
              onSelectionChange={(city) => {
                if (!city) return;
                const next = new URLSearchParams(searchParams);
                next.set("location", city.id);
                next.set("location_label", city.name);
                next.delete("page");
                setSearchParams(next);
              }}
            />
          </div>
        </div>

        <fieldset>
          <legend className="mb-1 text-xs font-semibold">دسته‌بندی ملک</legend>
          <div className="bg-muted grid grid-cols-2 rounded-xl p-1">
            {propertyTypeGroups.map((group) => (
              <Button
                key={group.category}
                className={cn(
                  "min-w-24 shadow-none",
                  category === group.category &&
                    "bg-background hover:bg-background",
                )}
                type="button"
                variant="ghost"
                aria-pressed={category === group.category}
                onClick={() => updateCategory(group.category)}
              >
                {group.label}
              </Button>
            ))}
          </div>
        </fieldset>

        <div className="border-border flex min-h-14 items-center gap-3 rounded-xl border px-4">
          <Building2
            className="text-muted-foreground size-5 shrink-0"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1 text-start">
            <span className="block text-xs font-semibold">نوع ملک</span>
            <PropertyTypeSelector
              key={`${category}-${searchParams.toString()}`}
              category={category}
              compact
              initialSelectedTypes={selectedTypes}
              facetCounts={propertyTypeFacetCounts(facets)}
              onSelectionChange={(propertyTypes) => {
                const next = new URLSearchParams(searchParams);
                next.set("property_category", category);
                next.delete("property_type");
                for (const propertyType of propertyTypes) {
                  next.append("property_type", propertyType);
                }
                next.delete("page");
                setSearchParams(next);
              }}
            />
          </div>
        </div>
      </div>
      <QuickFilters
        category={category}
        facets={facets}
        searchParams={searchParams}
        setSearchParams={setSearchParams}
      />
    </section>
  );
}

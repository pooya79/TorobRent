import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import {
  normalizePropertyTypes,
  summarizePropertyTypes,
} from "./property-type-selection";
import {
  propertyTypeGroups,
  propertyTypeLabels,
  type PropertyCategory,
  type PropertyType,
} from "./property-taxonomy";

function SelectionCheckbox({
  checked,
  count,
  disabled = false,
  indeterminate = false,
  label,
  name,
  value,
  onChange,
}: {
  checked: boolean;
  count?: number;
  disabled?: boolean;
  indeterminate?: boolean;
  label: string;
  name?: string;
  value?: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <label className="hover:bg-accent flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-50">
      <input
        ref={ref}
        type="checkbox"
        className="accent-primary size-4"
        checked={checked}
        aria-checked={indeterminate ? "mixed" : checked}
        data-state={
          indeterminate ? "indeterminate" : checked ? "checked" : "unchecked"
        }
        disabled={disabled}
        name={name}
        value={value}
        onChange={onChange}
      />
      <span>{label}</span>
      {count !== undefined && (
        <span className="text-muted-foreground ms-auto" aria-hidden="true">
          {count.toLocaleString("fa-IR")}
        </span>
      )}
    </label>
  );
}

export function PropertyTypeSelector({
  initialSelectedTypes = [],
  compact = false,
  category,
  onSelectionChange,
  facetCounts,
}: {
  initialSelectedTypes?: readonly PropertyType[];
  compact?: boolean;
  category?: PropertyCategory;
  onSelectionChange?: (types: readonly PropertyType[]) => void;
  facetCounts?: Partial<Record<PropertyType, number>>;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const visibleGroups = category
    ? propertyTypeGroups.filter((group) => group.category === category)
    : propertyTypeGroups;
  const visibleTypes = visibleGroups.flatMap(({ types }) => [...types]);
  const [selectedTypes, setSelectedTypes] = useState(() =>
    normalizePropertyTypes(initialSelectedTypes).filter((type) =>
      visibleTypes.includes(type),
    ),
  );
  const selected = new Set(selectedTypes);
  const setNormalizedSelection = (next: readonly PropertyType[]) => {
    const normalized = normalizePropertyTypes(next).filter((type) =>
      visibleTypes.includes(type),
    );
    const selection =
      normalized.length === visibleTypes.length ? [] : normalized;
    setSelectedTypes(selection);
    onSelectionChange?.(selection);
  };
  const toggleGroup = (types: readonly PropertyType[]) => {
    const everySelected = types.every((type) => selected.has(type));
    const next = new Set(selectedTypes);
    if (everySelected) types.forEach((type) => next.delete(type));
    else types.forEach((type) => next.add(type));
    setNormalizedSelection([...next]);
  };
  const toggleType = (type: PropertyType) => {
    const next = new Set(selectedTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setNormalizedSelection([...next]);
  };
  const summary = category
    ? selectedTypes.length === 0
      ? "همه نوع‌ها"
      : selectedTypes.map((type) => propertyTypeLabels[type]).join("، ")
    : summarizePropertyTypes(selectedTypes);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (
        details?.open &&
        event.target instanceof Node &&
        !details.contains(event.target)
      ) {
        details.open = false;
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  return (
    <details ref={detailsRef} className="relative">
      <summary
        role="button"
        aria-label={summary}
        className={cn(
          "focus-visible:ring-ring flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden",
          compact && "min-h-7 border-0 p-0 text-start",
        )}
      >
        <span>{summary}</span>
        <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
      </summary>
      <div className="border-border bg-popover absolute start-0 top-full z-30 mt-2 w-64 rounded-xl border p-2 text-start shadow-lg">
        <SelectionCheckbox
          checked={selectedTypes.length === 0}
          label={category ? "همه نوع‌ها" : "همه ملک‌ها"}
          onChange={() => setNormalizedSelection([])}
        />
        {visibleGroups.map((group) => {
          const selectedCount = group.types.filter((type) =>
            selected.has(type),
          ).length;
          return (
            <div className="mt-1 border-t pt-1" key={group.category}>
              {!category && (
                <SelectionCheckbox
                  checked={selectedCount === group.types.length}
                  indeterminate={
                    selectedCount > 0 && selectedCount < group.types.length
                  }
                  label={group.label}
                  onChange={() => toggleGroup(group.types)}
                />
              )}
              <div className={category ? undefined : "ms-5"}>
                {group.types.map((type) => (
                  <SelectionCheckbox
                    key={type}
                    checked={selected.has(type)}
                    count={facetCounts?.[type]}
                    disabled={!selected.has(type) && facetCounts?.[type] === 0}
                    label={propertyTypeLabels[type]}
                    name="property_type"
                    value={type}
                    onChange={() => toggleType(type)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

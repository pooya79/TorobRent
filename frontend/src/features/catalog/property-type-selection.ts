import {
  propertyTypeGroups,
  propertyTypeLabels,
  type PropertyType,
} from "./property-taxonomy";

export const allPropertyTypes = propertyTypeGroups.flatMap(({ types }) => [
  ...types,
]);

export function normalizePropertyTypes(types: readonly string[]) {
  const selected = new Set(types);
  return allPropertyTypes.filter((type) => selected.has(type));
}

export function selectedPropertyTypes(searchParams: URLSearchParams) {
  return normalizePropertyTypes(searchParams.getAll("property_type"));
}

export function summarizePropertyTypes(selectedTypes: readonly PropertyType[]) {
  if (
    selectedTypes.length === 0 ||
    selectedTypes.length === allPropertyTypes.length
  ) {
    return "همه ملک‌ها";
  }

  const selected = new Set(selectedTypes);
  const summary: string[] = [];
  for (const group of propertyTypeGroups) {
    const groupSelection = group.types.filter((type) => selected.has(type));
    if (groupSelection.length === group.types.length) summary.push(group.label);
    else
      summary.push(...groupSelection.map((type) => propertyTypeLabels[type]));
  }
  return summary.join("، ");
}

import {
  BEDROOM_COUNT_PARAMETER,
  bedroomCountQuickFilterLabels,
  LEGACY_BEDROOM_COUNT_PARAMETER,
  THREE_OR_MORE_BEDROOMS,
} from "./bedroom-filter";
import type { PropertyCategory } from "./property-taxonomy";

type QuickFilterParameter =
  | typeof BEDROOM_COUNT_PARAMETER
  | "parking"
  | "elevator"
  | "storage"
  | "furnished";

export const quickFilterOptions = {
  residential: [
    {
      parameter: BEDROOM_COUNT_PARAMETER,
      value: "1",
      label: bedroomCountQuickFilterLabels["1"],
      facet: "bedroom",
    },
    {
      parameter: BEDROOM_COUNT_PARAMETER,
      value: "2",
      label: bedroomCountQuickFilterLabels["2"],
      facet: "bedroom",
    },
    {
      parameter: BEDROOM_COUNT_PARAMETER,
      value: THREE_OR_MORE_BEDROOMS,
      label: bedroomCountQuickFilterLabels[THREE_OR_MORE_BEDROOMS],
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
    parameter: QuickFilterParameter;
    value: string;
    label: string;
    facet: "bedroom" | "feature";
  }[]
>;

const sharedQuickFilterParameters = new Set<QuickFilterParameter>([
  "parking",
  "elevator",
]);

export function categorySpecificQuickFilterParameters(
  category: PropertyCategory,
) {
  const parameters: (
    QuickFilterParameter | typeof LEGACY_BEDROOM_COUNT_PARAMETER
  )[] = [
    ...new Set(
      quickFilterOptions[category]
        .map(({ parameter }) => parameter)
        .filter((parameter) => !sharedQuickFilterParameters.has(parameter)),
    ),
  ];
  if (parameters.includes(BEDROOM_COUNT_PARAMETER)) {
    parameters.push(LEGACY_BEDROOM_COUNT_PARAMETER);
  }
  return parameters;
}

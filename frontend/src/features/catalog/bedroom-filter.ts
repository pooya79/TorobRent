import type { operations } from "@/lib/api/schema";

type PropertySearchQuery = NonNullable<
  operations["v1_catalog_properties_list"]["parameters"]["query"]
>;

export const BEDROOM_COUNT_PARAMETER = "bedroom_count" as const;
export const LEGACY_BEDROOM_COUNT_PARAMETER = "room_count" as const;
export const THREE_OR_MORE_BEDROOMS = "3_plus" satisfies NonNullable<
  PropertySearchQuery["bedroom_count"]
>;

export const bedroomCountQuickFilterLabels = {
  "1": "یک خوابه",
  "2": "دو خوابه",
  [THREE_OR_MORE_BEDROOMS]: "سه خواب و بیشتر",
} as const;

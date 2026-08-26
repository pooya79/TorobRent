import { roomCountLabels } from "./property-taxonomy";
import type { components } from "@/lib/api/schema";

type PropertySummary = components["schemas"]["PropertySummary"];
type PropertyCardFactsSource = Pick<
  PropertySummary,
  "area_sqm" | "location" | "property_category" | "room_count"
>;

export function formatNumber(value: number) {
  return new Intl.NumberFormat("fa-IR").format(value);
}

export function propertyLocationLabel(property: PropertyCardFactsSource) {
  return [
    property.location.neighborhood,
    property.location.district,
    property.location.city,
  ].join("، ");
}

export function propertyAreaAndRoomFacts(property: PropertyCardFactsSource) {
  return [
    `${formatNumber(property.area_sqm)} متر`,
    property.room_count === null || property.room_count === undefined
      ? null
      : `${formatNumber(property.room_count)} ${roomCountLabels[property.property_category].fact}`,
  ].filter((fact): fact is string => fact !== null);
}

export function rentalTermsCardData(
  rentalTerms: PropertySummary["rental_terms"],
) {
  return {
    depositLabel: `${formatNumber(rentalTerms.deposit_toman)} تومان`,
    monthlyRentLabel: `${formatNumber(rentalTerms.monthly_rent_toman)} تومان`,
  };
}

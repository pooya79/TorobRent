import type { components } from "@/lib/api/schema";

export const propertyDetail: components["schemas"]["PropertyDetail"] = {
  id: "8b294499-0f8d-45cb-8ec6-90ac3ca1669e",
  title: "آپارتمان در سعادت‌آباد",
  canonical_slug: "آپارتمان-در-سعادتآباد",
  location: {
    city: "تهران",
    district: "منطقه ۲",
    district_number: 2,
    neighborhood: "سعادت‌آباد",
  },
  property_type: "apartment",
  property_type_label: "آپارتمان",
  area_sqm: 110,
  room_count: 2,
  construction_year: 1400,
  floor: 4,
  total_floors: 6,
  units_per_floor: 2,
  heating: "پکیج",
  cooling: "کولر آبی",
  features: {
    parking: "present",
    elevator: "unknown",
    storage: "absent",
    balcony: "unknown",
    furnished: "unknown",
  },
  listings: [
    {
      id: "94837713-bf6a-4c2e-8249-6ccb3cce7af2",
      source: {
        id: "10000000-0000-4000-8000-000000000001",
        name: "ترب‌رنت",
        display_name: "منبع مستقیم ترب‌رنت",
        outbound_policy: "direct_contact",
      },
      rental_terms: {
        deposit_rial: 10_000_000_000,
        monthly_rent_rial: 250_000_000,
        currency: "IRR",
        deposit_toman: 1_000_000_000,
        monthly_rent_toman: 25_000_000,
      },
      description: "آپارتمان روشن و آرام",
      source_claims: {},
      external_url: "",
      is_negotiable: false,
      is_convertible: false,
      availability_confirmed_at: "2026-08-21T10:00:00Z",
      available_until: "2026-09-20T10:00:00Z",
    },
  ],
};

export const propertySearchPage: components["schemas"]["PaginatedPropertySummaryList"] =
  {
    count: 1,
    next: null,
    previous: null,
    results: [
      {
        id: propertyDetail.id,
        title: propertyDetail.title,
        canonical_slug: propertyDetail.canonical_slug,
        location: propertyDetail.location,
        property_type: propertyDetail.property_type,
        property_type_label: propertyDetail.property_type_label,
        area_sqm: propertyDetail.area_sqm,
        room_count: propertyDetail.room_count,
        construction_year: propertyDetail.construction_year,
        listing_count: 2,
        rental_terms: propertyDetail.listings[0]!.rental_terms,
        availability_confirmed_at:
          propertyDetail.listings[0]!.availability_confirmed_at,
      },
    ],
  };

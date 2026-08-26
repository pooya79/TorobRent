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
  property_category: "residential",
  property_category_label: "مسکونی",
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
      source_reference: "direct-1",
      source_claims: {},
      disagreements: [],
      continuation_url: null,
      media_url: null,
      is_negotiable: false,
      is_convertible: false,
      availability_confirmed_at: "2026-08-21T10:00:00Z",
      available_until: "2026-09-20T10:00:00Z",
    },
    {
      id: "89e88c26-5a44-4587-905b-08418c9e9346",
      source: {
        id: "d6797c59-a835-469e-844f-896954052127",
        name: "example-source",
        display_name: "منبع نمونه",
        outbound_policy: "external_link",
      },
      rental_terms: {
        deposit_rial: 8_000_000_000,
        monthly_rent_rial: 300_000_000,
        currency: "IRR",
        deposit_toman: 800_000_000,
        monthly_rent_toman: 30_000_000,
      },
      description: "ادعای ثبت‌شده در منبع",
      source_reference: "external-42",
      source_claims: {
        area_sqm: 108,
        parking: "absent",
        image_url: "https://third-party.example/hotlink.jpg",
      },
      disagreements: [
        { field: "area_sqm", normalized_value: 110, source_value: 108 },
        {
          field: "parking",
          normalized_value: "present",
          source_value: "absent",
        },
      ],
      continuation_url: "https://example-source.test/listings/42",
      media_url: "https://cdn.example-source.test/listings/42.jpg",
      is_negotiable: false,
      is_convertible: true,
      availability_confirmed_at: "2026-08-20T09:00:00Z",
      available_until: "2026-09-19T09:00:00Z",
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
        property_category: propertyDetail.property_category,
        property_category_label: propertyDetail.property_category_label,
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

export const officePropertyDetail: components["schemas"]["PropertyDetail"] = {
  ...propertyDetail,
  id: "7a294499-0f8d-45cb-8ec6-90ac3ca1669e",
  title: "دفتر اداری در سعادت‌آباد",
  canonical_slug: "دفتر-اداری-در-سعادتآباد",
  property_category: "commercial",
  property_category_label: "تجاری",
  property_type: "office",
  property_type_label: "دفتر اداری",
  room_count: undefined,
  listings: propertyDetail.listings.map((listing) => ({
    ...listing,
    description: "دفتر اداری مناسب شرکت",
  })),
};

export const officePropertySearchPage: components["schemas"]["PaginatedPropertySummaryList"] =
  {
    count: 1,
    next: null,
    previous: null,
    results: [
      {
        id: officePropertyDetail.id,
        title: officePropertyDetail.title,
        canonical_slug: officePropertyDetail.canonical_slug,
        location: officePropertyDetail.location,
        property_category: officePropertyDetail.property_category,
        property_category_label: officePropertyDetail.property_category_label,
        property_type: officePropertyDetail.property_type,
        property_type_label: officePropertyDetail.property_type_label,
        area_sqm: officePropertyDetail.area_sqm,
        room_count: officePropertyDetail.room_count,
        construction_year: officePropertyDetail.construction_year,
        listing_count: 2,
        rental_terms: officePropertyDetail.listings[0]!.rental_terms,
        availability_confirmed_at:
          officePropertyDetail.listings[0]!.availability_confirmed_at,
      },
    ],
  };

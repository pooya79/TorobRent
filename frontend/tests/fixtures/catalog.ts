import type { components } from "@/lib/api/schema";

const residentialFacets: components["schemas"]["CatalogFacets"] = {
  property_types: [
    { value: "apartment", count: 1 },
    { value: "house", count: 1 },
    { value: "villa", count: 1 },
  ],
  bedroom_counts: [
    { value: "1", count: 1 },
    { value: "2", count: 1 },
    { value: "3_plus", count: 1 },
  ],
  features: {
    parking: { present: 1, absent: 1, unknown: 1 },
    elevator: { present: 1, absent: 1, unknown: 1 },
    storage: { present: 1, absent: 1, unknown: 1 },
    balcony: { present: 1, absent: 1, unknown: 1 },
    furnished: { present: 1, absent: 1, unknown: 1 },
  },
};

const commercialFacets: components["schemas"]["CatalogFacets"] = {
  ...residentialFacets,
  property_types: [
    { value: "office", count: 1 },
    { value: "shop", count: 1 },
    { value: "warehouse", count: 1 },
    { value: "workshop", count: 1 },
  ],
  bedroom_counts: [],
};

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
  approximate_location: {
    latitude: "35.771800",
    longitude: "51.381200",
    precision: "approximate",
    radius_meters: 50,
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
      images: [],
      is_negotiable: false,
      is_convertible: false,
      availability_confirmed_at: "2026-08-21T10:00:00Z",
      available_until: "2026-09-20T10:00:00Z",
      can_message_submitter: true,
      is_responsible_submitter: false,
      contact_blocked: false,
      can_reveal_phone: true,
      phone_reveal_unavailable_reason: null,
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
      media_url: "/api/v1/catalog/media/image-42/",
      images: [
        {
          id: "image-42",
          is_primary: true,
          variants: [
            {
              kind: "medium",
              url: "/api/v1/catalog/media/image-42/",
              width: 960,
              height: 640,
            },
          ],
        },
      ],
      is_negotiable: false,
      is_convertible: true,
      availability_confirmed_at: "2026-08-20T09:00:00Z",
      available_until: "2026-09-19T09:00:00Z",
      can_message_submitter: false,
      is_responsible_submitter: false,
      contact_blocked: false,
      can_reveal_phone: false,
      phone_reveal_unavailable_reason: "external_listing",
    },
  ],
};

const reviewedPrimaryImage = {
  url: "/media/reviewed-media/property-primary.webp",
  width: 960,
  height: 720,
};

function searchSummary(
  detail: components["schemas"]["PropertyDetail"],
): components["schemas"]["PropertySummary"] {
  return {
    id: detail.id,
    title: detail.title,
    canonical_slug: detail.canonical_slug,
    location: detail.location,
    approximate_location: detail.approximate_location,
    property_category: detail.property_category,
    property_category_label: detail.property_category_label,
    property_type: detail.property_type,
    property_type_label: detail.property_type_label,
    area_sqm: detail.area_sqm,
    room_count: detail.room_count,
    construction_year: detail.construction_year,
    primary_image: reviewedPrimaryImage,
    listing_count: 2,
    is_favorite: false,
    rental_terms: detail.listings[0]!.rental_terms,
    availability_confirmed_at: detail.listings[0]!.availability_confirmed_at,
  };
}

const residentialPropertySummary = searchSummary(propertyDetail);

export const propertySearchPage: components["schemas"]["PropertySearchPage"] = {
  count: 1,
  next: null,
  previous: null,
  facets: residentialFacets,
  map: {
    total_property_count: 1,
    mappable_property_count: 1,
    clusters: [],
    markers: [residentialPropertySummary],
  },
  results: [residentialPropertySummary],
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

const officePropertySummary = searchSummary(officePropertyDetail);

export const officePropertySearchPage: components["schemas"]["PropertySearchPage"] =
  {
    count: 1,
    next: null,
    previous: null,
    facets: commercialFacets,
    map: {
      total_property_count: 1,
      mappable_property_count: 1,
      clusters: [],
      markers: [officePropertySummary],
    },
    results: [officePropertySummary],
  };

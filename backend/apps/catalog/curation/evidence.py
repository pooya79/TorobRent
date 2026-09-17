"""Retained Property evidence shared by curation decisions and presentation."""

from ..models import Listing, Property


def _source_data(listing: Listing) -> dict[str, object]:
    return {
        "id": listing.source_id,
        "name": listing.source.display_name,
        "domain": listing.source.domain,
    }


def property_evidence_data(property_: Property) -> dict[str, object]:
    return {
        "id": property_.id,
        "normalized_facts": {
            "city": property_.city.name_fa if property_.city else None,
            "district": property_.district.name_fa if property_.district else None,
            "neighborhood": (property_.neighborhood.name_fa if property_.neighborhood else None),
            "property_type": property_.property_type,
            "area_sqm": property_.area_sqm,
            "room_count": property_.room_count,
            "construction_year": property_.construction_year,
            "floor": property_.floor,
            "total_floors": property_.total_floors,
            "units_per_floor": property_.units_per_floor,
            "parking": property_.parking,
            "elevator": property_.elevator,
            "storage": property_.storage,
            "balcony": property_.balcony,
            "furnished": property_.furnished,
            "heating": property_.heating,
            "cooling": property_.cooling,
        },
        "provenance_note": property_.provenance_note,
        "exact_location": {
            "latitude": property_.latitude,
            "longitude": property_.longitude,
            "operator_notes": property_.operator_location_notes,
        },
        "listings": [
            {
                "id": listing.id,
                "source": _source_data(listing),
                "source_reference": listing.source_reference,
                "source_claims": listing.source_claims,
                "provenance_note": listing.provenance_note,
            }
            for listing in property_.listings.all()
        ],
    }

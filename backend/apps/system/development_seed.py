from dataclasses import dataclass

from django.db import transaction

from apps.accounts.development_seed import seed_development_personas
from apps.catalog.development_seed import seed_development_catalog
from apps.submissions.development_seed import seed_development_submissions


@dataclass(frozen=True)
class DevelopmentSeedResult:
    properties: int
    listings: int


@transaction.atomic
def seed_development_data() -> DevelopmentSeedResult:
    personas = seed_development_personas()
    catalog = seed_development_catalog()
    seed_development_submissions(
        submitter=personas.submitter,
        operator=personas.operator,
        property_=catalog.first_property,
        published_listing=catalog.published_listing,
        expired_listing=catalog.expired_listing,
    )
    return DevelopmentSeedResult(properties=catalog.properties, listings=catalog.listings)

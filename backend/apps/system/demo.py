from dataclasses import dataclass

from django.db import transaction

from apps.accounts.demo import seed_demo_personas
from apps.catalog.demo import seed_demo_catalog
from apps.submissions.demo import seed_demo_submissions


@dataclass(frozen=True)
class DemoSeedResult:
    properties: int
    listings: int


@transaction.atomic
def seed_demo() -> DemoSeedResult:
    personas = seed_demo_personas()
    catalog = seed_demo_catalog()
    seed_demo_submissions(
        submitter=personas.submitter,
        operator=personas.operator,
        property_=catalog.first_property,
        published_listing=catalog.published_listing,
        expired_listing=catalog.expired_listing,
    )
    return DemoSeedResult(properties=catalog.properties, listings=catalog.listings)

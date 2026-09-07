from dataclasses import dataclass

from django.db import transaction

from apps.accounts.development_seed import seed_development_personas
from apps.catalog.development_seed import seed_development_catalog
from apps.communications.development_seed import seed_development_communications
from apps.contact.development_seed import seed_development_support_requests
from apps.submissions.development_seed import seed_development_submissions


@dataclass(frozen=True)
class DevelopmentSeedResult:
    properties: int
    listings: int
    inquiries: int
    messages: int
    notifications: int
    support_requests: int


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
    communications = seed_development_communications(
        submitter=personas.submitter,
        renter=personas.renter,
        renter_two=personas.renter_two,
        published_listing=catalog.published_listing,
        expired_listing=catalog.expired_listing,
    )
    support = seed_development_support_requests(
        submitter=personas.submitter,
        support_operator=personas.support_operator,
    )
    return DevelopmentSeedResult(
        properties=catalog.properties,
        listings=catalog.listings,
        inquiries=communications.inquiries,
        messages=communications.messages + support.messages,
        notifications=communications.notifications,
        support_requests=support.requests,
    )

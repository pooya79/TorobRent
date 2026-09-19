from dataclasses import dataclass

from django.db import transaction

from apps.accounts.development_seed import seed_development_personas
from apps.catalog.development_seed import load_development_locations, seed_development_catalog
from apps.common.development_seed import DevelopmentFixtureKind, development_fixture_id
from apps.communications.development_seed import seed_development_communications
from apps.communications.models import SystemNotification
from apps.contact.development_seed import seed_development_support_requests
from apps.source_proposals.development_seed import (
    seed_development_demo_sources,
    seed_development_external_candidates,
    seed_development_sources,
)
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
    seed_development_demo_sources()
    load_development_locations()
    sources = seed_development_sources(
        representatives=(personas.source_one, personas.source_two), operator=personas.operator
    )
    catalog = seed_development_catalog(sources=sources)
    seed_development_external_candidates(
        listings=catalog.listings_for_submissions, operator=personas.operator
    )
    seed_development_submissions(
        submitter=personas.submitter,
        operator=personas.operator,
        property_=catalog.first_property,
        published_listing=catalog.published_listing,
        expired_listing=catalog.expired_listing,
        listings=catalog.listings_for_submissions,
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
    source_approval_notifications = SystemNotification.objects.filter(
        originating_source_proposal_event__proposal_id__in=[
            development_fixture_id(DevelopmentFixtureKind.SOURCE_PROPOSAL, index)
            for index in (1, 2)
        ],
        originating_source_proposal_event__sourceprofiledecision__version__number=1,
        originating_source_proposal_event__new_state="approved",
    ).count()
    return DevelopmentSeedResult(
        properties=catalog.properties,
        listings=catalog.listings,
        inquiries=communications.inquiries,
        messages=communications.messages + support.messages,
        notifications=communications.notifications + source_approval_notifications,
        support_requests=support.requests,
    )

"""Prepare fictional approved websites without any network or worker activity."""

from collections.abc import Sequence
from datetime import timedelta

from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Listing, OutboundPolicy, Source
from apps.common.development_seed import DevelopmentFixtureKind, development_fixture_id
from apps.source_extraction.contract import ExtractionContract
from apps.source_extraction.fetching import FetchBatch, FetchedPage, FetchRecord

from .models import (
    DiscoveryStage,
    ExternalListingCandidate,
    ExternalListingCandidateEvent,
    ProfileReviewMode,
    SourceProposal,
    SourceProposalEvent,
    SourceProposalState,
    SourceReservation,
)
from .services import claim_source_proposal_review
from .source_processing.profiles import approve_profile, retain_discovered_profile


class DevelopmentPageFetcher:
    """Serve synthetic review evidence in memory; never contact the .invalid hosts."""

    def __init__(self, website_url: str) -> None:
        self.pages = {
            website_url: "<h1>اجاره آپارتمان تهران</h1>"
            + "".join(
                f'<a href="{website_url}listings/{index}">اجاره آپارتمان تهران</a>'
                for index in range(1, 11)
            ),
            **{
                f"{website_url}listings/{index}": (
                    '<html><head><script type="application/ld+json">'
                    '{"@type":"Apartment","name":"اجاره آپارتمان در سعادت‌آباد",'
                    f'"floorSize":{{"value":{80 + index}}},"numberOfRooms":2,'
                    '"address":{"addressLocality":"سعادت‌آباد","addressRegion":"تهران"}}'
                    "</script></head><body><h1>اجاره آپارتمان در سعادت‌آباد</h1>"
                    f"<dl><dt>متراژ</dt><dd>{80 + index} متر</dd>"
                    "<dt>اتاق خواب</dt><dd>2</dd>"
                    "<dt>رهن (تومان)</dt><dd>۵۰۰ میلیون تومان</dd>"
                    "<dt>اجاره ماهانه (تومان)</dt><dd>۲۰ میلیون تومان</dd></dl>"
                    "<p>موقعیت در تهران، سعادت‌آباد</p></body></html>"
                )
                for index in range(1, 11)
            },
        }

    def fetch(self, urls: Sequence[str], *, render: bool = False) -> FetchBatch:
        return FetchBatch(
            tuple(
                FetchRecord(
                    requested_url=url,
                    page=FetchedPage(
                        url=url,
                        status_code=200,
                        body=self.pages[url].encode(),
                        headers={"content-type": "text/html; charset=utf-8"},
                    ),
                )
                for url in urls
            )
        )


def seed_development_sources(
    *, representatives: tuple[User, User], operator: User
) -> tuple[Source, Source, Source]:
    sources = [Source.objects.get(is_builtin=True)]
    for index, (suffix, representative) in enumerate(
        zip(("one", "two"), representatives, strict=True), 1
    ):
        source, _ = Source.objects.get_or_create(
            id=development_fixture_id(DevelopmentFixtureKind.SOURCE, index),
            defaults={
                "name": f"development-home-{suffix}",
                "domain": f"development-{suffix}.invalid",
                "display_name": "نمونه ساختگی یک" if index == 1 else "نمونه ساختگی دو",
                "is_active": True,
                "is_builtin": False,
                "outbound_policy": OutboundPolicy.EXTERNAL_LINK,
                "allows_external_media": index == 1,
            },
        )
        sources.append(source)
        proposal, created = SourceProposal.objects.get_or_create(
            id=development_fixture_id(DevelopmentFixtureKind.SOURCE_PROPOSAL, index),
            defaults={
                "submitter": representative,
                "source": source,
                "state": SourceProposalState.PENDING,
                "current_step": "preview",
                "website_name": source.display_name,
                "website_url": f"https://{source.domain}/",
                "normalized_domain": source.domain,
                "relationship": "website_owner",
                "inventory_range": "11_50",
                "authority_declared": True,
                "preview_confirmed": True,
                "pending_since": timezone.now(),
                "responsible_operator": operator,
                "responsibility_revision": 1,
            },
        )
        if not created:
            continue  # Preserve revocation, profile edits, and subsequent manual review.
        SourceProposalEvent.objects.create(
            proposal=proposal,
            actor=representative,
            revision=1,
            prior_state="draft",
            new_state="pending",
            reason="معرفی وب‌سایت ساختگی محیط توسعه",
        )
        proposal.preview = proposal.confirmation_summary()
        proposal.save(update_fields=("preview",))
        claim_source_proposal_review(proposal=proposal, actor=operator)
        reservation = SourceReservation.objects.create(
            source=source,
            proposal=proposal,
            revision=1,
            approved_url=proposal.website_url,
            expires_at=timezone.now() + timedelta(days=1),
            completed_at=timezone.now(),
            evidence={"development_seed": True, "page_count": 11},
        )
        SourceProposalEvent.objects.create(
            proposal=proposal,
            actor=operator,
            revision=1,
            prior_state="pending",
            new_state="pending",
            reason="تأیید نشانی و بررسی صفحات ساختگی محلی؛ بدون درخواست شبکه",
        )
        contract = ExtractionContract(fetcher=DevelopmentPageFetcher(proposal.website_url))
        discovery = contract.discover(proposal.website_url)
        profile = contract.propose_profile(discovery)
        retain_discovered_profile(reservation, discovery, profile, contract)
        proposal.discovery_stage = DiscoveryStage.COMPLETE
        proposal.save(update_fields=("discovery_stage",))
        version = reservation.profile_versions.get()
        approve_profile(
            proposal=proposal,
            actor=operator,
            reviewed_revision=1,
            reviewed_profile_version=version.pk,
            confirmed=True,
            review_mode=ProfileReviewMode.APPROVAL_REQUIRED,
            limitations_acknowledged=True,
            reason="تأیید پروفایل ساختگی برای مرور محیط توسعه",
        )
    return sources[0], sources[1], sources[2]


def seed_development_external_candidates(*, listings: Sequence[Listing], operator: User) -> None:
    for index, listing in enumerate(listings, 1):
        if listing.source.is_builtin:
            continue
        proposal = SourceProposal.objects.get(
            source=listing.source,
            id__in=[
                development_fixture_id(DevelopmentFixtureKind.SOURCE_PROPOSAL, number)
                for number in (1, 2)
            ],
        )
        property_ = listing.property
        state = {"draft": "pending", "pending": "pending", "rejected": "rejected"}.get(
            listing.state, "published"
        )
        candidate, created = ExternalListingCandidate.objects.get_or_create(
            id=development_fixture_id(DevelopmentFixtureKind.EXTERNAL_CANDIDATE, index),
            defaults={
                "source_proposal": proposal,
                "source": listing.source,
                "listing": listing,
                "state": state,
                "title": property_.title,
                "external_url": listing.external_url,
                "city": property_.city,
                "district": property_.district,
                "neighborhood": property_.neighborhood,
                "property_type": property_.property_type,
                "area_sqm": property_.area_sqm,
                "room_count": property_.room_count,
                "deposit_rial": listing.terms.deposit_rial,
                "monthly_rent_rial": listing.terms.monthly_rent_rial,
                "source_claims": listing.source_claims,
                "description": listing.description,
                "evidence": {"development_seed": True},
            },
        )
        if created and state != "pending":
            ExternalListingCandidateEvent.objects.create(
                id=development_fixture_id(DevelopmentFixtureKind.EXTERNAL_CANDIDATE_EVENT, index),
                candidate=candidate,
                actor=operator,
                revision=1,
                prior_state="pending",
                new_state=state,
                reason="بررسی آگهی ساختگی محیط توسعه",
            )

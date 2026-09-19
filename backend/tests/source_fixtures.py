"""Approved-source fixtures for catalog tests that do not exercise source review."""

from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.models import Source
from apps.source_proposals.models import (
    SourceAssignment,
    SourceProfile,
    SourceProfileDecision,
    SourceProfileVersion,
    SourceProposal,
    SourceProposalEvent,
    SourceReservation,
)


def approve_source_for_publication(
    source: Source, *, proposal: SourceProposal | None = None
) -> None:
    if source.outbound_policy != "external_link" or source.assignments.exists():
        return
    representative = (
        proposal.submitter
        if proposal
        else User.objects.create_user(
            email=f"rep-{source.pk}@example.com",
            email_verified_at=timezone.now(),
            is_submitter=True,
        )
    )
    operator, _ = User.objects.get_or_create(
        email="source-fixture-operator@example.com",
        defaults={"email_verified_at": timezone.now(), "is_staff": True, "is_superuser": True},
    )
    proposal = proposal or SourceProposal.objects.create(
        source=source,
        submitter=representative,
        state="approved",
        website_url=f"https://{source.domain}/",
        normalized_domain=source.domain,
    )
    reservation = SourceReservation.objects.create(
        source=source,
        proposal=proposal,
        revision=1,
        approved_url=proposal.website_url,
        expires_at=timezone.now(),
        released_at=timezone.now(),
        release_reason="approved",
    )
    profile = SourceProfile.objects.create(source=source)
    version = SourceProfileVersion.objects.create(
        profile=profile,
        reservation=reservation,
        number=1,
        rules={},
        structural_fingerprint="fixture",
        validation={
            "training_page_urls": [],
            "held_out_page_urls": [],
            "required_resolved": 0,
            "fields": {},
            "pages": [],
            "approval_enabled": True,
        },
        samples=[],
        exclusions=[],
        pipeline_version="fixture",
        provenance="discovery",
    )
    profile.active_version = version
    profile.save(update_fields=("active_version",))
    event = SourceProposalEvent.objects.create(
        proposal=proposal,
        actor=operator,
        revision=1,
        prior_state="pending",
        new_state="approved",
    )
    decision = SourceProfileDecision.objects.create(
        version=version,
        representative=representative,
        event=event,
        review_mode="approval_required",
    )
    SourceAssignment.objects.create(
        source=source,
        proposal=proposal,
        representative=representative,
        approval=decision,
    )

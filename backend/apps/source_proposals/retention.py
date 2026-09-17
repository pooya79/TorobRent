"""Keep one successful page payload while retaining compact review and run records."""

from django.db.models import F, Q, QuerySet
from django.utils import timezone

from apps.common.media import schedule_asset_cleanup

from .models import ExternalListingCandidate, ExtractionRun


def retire_results(candidates: QuerySet[ExternalListingCandidate]) -> None:
    """Called with the Source locked, including against image-processing workers."""
    from .models import CandidateImage, CandidateImageVariant, ExternalListingCandidateReviewClaim

    ids = list(candidates.values_list("pk", flat=True))
    if not ids:
        return
    variants = CandidateImageVariant.objects.filter(image__candidate_id__in=ids)
    assets = list(variants.exclude(asset=None).values_list("asset_id", flat=True))
    variants.update(asset=None)
    CandidateImage.objects.filter(candidate_id__in=ids).update(state="retired", is_primary=False)
    ExternalListingCandidateReviewClaim.objects.filter(
        candidate_id__in=ids, released_at__isnull=True
    ).update(released_at=timezone.now())
    ExternalListingCandidate.objects.filter(pk__in=ids).update(
        superseded=True,
        evidence={},
        source_claims={},
        conflicts={},
        validation_errors={},
        corrections={},
        description="",
        requested_urls=[],
        structural_drift=False,
        city=None,
        district=None,
        neighborhood=None,
        property_type="",
        area_sqm=None,
        room_count=None,
        deposit_rial=None,
        monthly_rent_rial=None,
        revision=F("revision") + 1,
    )
    for asset_id in set(assets):
        if asset_id is not None:
            schedule_asset_cleanup(asset_id)


def replace_obsolete_results(run: ExtractionRun) -> None:
    """A failed attempt has no candidates and never erases the previous success.

    Request ordering, rather than completion ordering, fences late older successes.
    Published catalog records own their content and media independently.
    """
    for incoming in run.candidates.all():
        others = ExternalListingCandidate.objects.filter(
            source=incoming.source,
            external_url=incoming.external_url,
            discovery_version__isnull=True,
            superseded=False,
        ).exclude(pk=incoming.pk)
        newer = Q(extraction_run__request__created_at__gt=run.request.created_at) | Q(
            extraction_run__request__created_at=run.request.created_at,
            extraction_run__request_id__gt=run.request_id,
        )
        if others.filter(newer).exists():
            retire_results(ExternalListingCandidate.objects.filter(pk=incoming.pk))
        else:
            retire_results(others)

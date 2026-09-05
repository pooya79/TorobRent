from typing import cast

from django.http import FileResponse
from drf_spectacular.utils import extend_schema
from rest_framework.generics import get_object_or_404
from rest_framework.request import Request
from rest_framework.views import APIView

from apps.accounts.models import User

from .models import CandidateImageVariant
from .operator_views import CanReviewSourceProposal


class CandidateImageView(APIView):
    permission_classes = (CanReviewSourceProposal,)

    @extend_schema(
        summary="Read a processed candidate image", responses={(200, "image/webp"): bytes}
    )
    def get(self, request: Request, candidate_id: str, variant_id: int) -> FileResponse:
        variant = get_object_or_404(
            CandidateImageVariant.objects.select_related("asset").exclude(
                image__candidate__source_proposal__submitter=cast(User, request.user)
            ),
            pk=variant_id,
            image__candidate_id=candidate_id,
            asset__isnull=False,
        )
        assert variant.asset is not None
        response = FileResponse(variant.asset.file.open("rb"), content_type="image/webp")
        response["Cache-Control"] = "private, no-store"
        return response

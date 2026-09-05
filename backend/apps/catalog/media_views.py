from django.db.models import Q
from django.http import FileResponse
from drf_spectacular.utils import extend_schema
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.views import APIView

from apps.common.models import MediaAsset

from .models import Listing


class CatalogMediaView(APIView):
    permission_classes = (AllowAny,)

    @extend_schema(
        summary="Read a published first-party image", responses={(200, "image/webp"): bytes}
    )
    def get(self, request: Request, asset_id: str) -> FileResponse:
        active = Listing.objects.active()
        asset = get_object_or_404(
            MediaAsset.objects.filter(
                Q(listing_variants__image__listing__in=active)
                | Q(property_variants__image__property__in=active.values("property_id"))
            ).distinct(),
            pk=asset_id,
        )
        response = FileResponse(asset.file.open("rb"), content_type="image/webp")
        response["Cache-Control"] = "no-cache"
        return response

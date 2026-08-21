import uuid

from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.exceptions import NotFound
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.serializers import ProblemSerializer

from .models import Listing, Property
from .serializers import PropertyDetailSerializer, property_detail_data


class PropertyDetailView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        summary="Get a publicly available Property",
        responses={
            200: PropertyDetailSerializer,
            (404, "application/problem+json"): OpenApiResponse(
                response=ProblemSerializer,
                description="No Property with an Active Listing was found",
            ),
        },
    )
    def get(self, request: Request, property_id: uuid.UUID) -> Response:
        listings = list(
            Listing.objects
            .active()
            .filter(property_id=property_id)
            .select_related("source", "terms")
        )
        if not listings:
            raise NotFound("این ملک در دسترس نیست.")
        try:
            property_ = Property.objects.select_related("city", "district", "neighborhood").get(
                id=property_id
            )
        except Property.DoesNotExist as exc:
            raise NotFound("این ملک در دسترس نیست.") from exc
        serializer = PropertyDetailSerializer(instance=property_detail_data(property_, listings))
        return Response(serializer.data)

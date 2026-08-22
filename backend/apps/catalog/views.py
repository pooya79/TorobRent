import uuid
from typing import cast

from django.db.models import QuerySet
from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
    extend_schema_view,
)
from rest_framework.exceptions import NotFound
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.pagination import StandardPageNumberPagination
from apps.common.serializers import ProblemSerializer

from .models import Listing, Property
from .selectors import autocomplete_locations, search_properties
from .serializers import (
    LocationSuggestionSerializer,
    PropertyDetailSerializer,
    PropertySearchQuerySerializer,
    PropertySummarySerializer,
    property_detail_data,
)


class LocationAutocompleteView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        summary="Autocomplete reviewed Tehran locations",
        parameters=[
            OpenApiParameter(
                name="q",
                type=str,
                location=OpenApiParameter.QUERY,
                description="Persian city, municipal district, or neighborhood name",
            )
        ],
        responses={200: LocationSuggestionSerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        suggestions = autocomplete_locations(request.query_params.get("q", ""))
        return Response(LocationSuggestionSerializer(suggestions, many=True).data)


class CatalogSearchPagination(StandardPageNumberPagination):
    page_size_query_param = cast(str, None)


@extend_schema_view(
    get=extend_schema(
        summary="Search Properties with an Active Listing",
        parameters=[
            PropertySearchQuerySerializer,
        ],
    )
)
class PropertySearchView(ListAPIView[Property]):
    permission_classes = [AllowAny]
    serializer_class = PropertySummarySerializer
    pagination_class = CatalogSearchPagination

    def get_queryset(self) -> QuerySet[Property]:
        query = PropertySearchQuerySerializer(data=self.request.query_params)
        query.is_valid(raise_exception=True)
        return search_properties(query.validated_filters())


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

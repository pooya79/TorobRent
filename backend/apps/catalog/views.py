import uuid
from typing import cast

from django.db.models import F, QuerySet
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
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

from .models import Listing, OutboundPolicy, ProductEventType, Property
from .selectors import (
    autocomplete_locations,
    catalog_statistics,
    search_properties,
    supported_cities,
)
from .serializers import (
    CatalogStatisticsSerializer,
    EventSessionSerializer,
    ExternalContinuationSerializer,
    LocationSuggestionSerializer,
    PhoneRevealSerializer,
    PropertyDetailSerializer,
    PropertySearchQuerySerializer,
    PropertySummarySerializer,
    SupportedCitySerializer,
    property_detail_data,
)
from .services import record_product_event

EVENT_SESSION_PARAMETER = OpenApiParameter(
    name="X-TorobRent-Event-Session",
    type=OpenApiTypes.UUID,
    location=OpenApiParameter.HEADER,
    required=True,
    description="Ephemeral per-tab token used only for short-lived deduplication and rate control",
)


def event_session(request: Request) -> uuid.UUID:
    serializer = EventSessionSerializer(
        data={"event_session": request.headers.get("X-TorobRent-Event-Session")}
    )
    serializer.is_valid(raise_exception=True)
    return cast(uuid.UUID, serializer.validated_data["event_session"])


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


class SupportedCityListView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        summary="List cities supported by public catalog search",
        responses={200: SupportedCitySerializer(many=True)},
    )
    def get(self, request: Request) -> Response:
        return Response(SupportedCitySerializer(supported_cities(), many=True).data)


class CatalogStatisticsView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        summary="Get live public catalog statistics",
        responses={200: CatalogStatisticsSerializer},
    )
    def get(self, request: Request) -> Response:
        return Response(CatalogStatisticsSerializer(catalog_statistics()).data)


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


class PropertyViewEventView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        summary="Record a privacy-minimal Property view",
        request=None,
        parameters=[EVENT_SESSION_PARAMETER],
        responses={204: None},
    )
    def post(self, request: Request, property_id: uuid.UUID) -> Response:
        try:
            property_ = (
                Property.objects
                .filter(
                    id=property_id,
                    listings__state="published",
                    listings__available_until__gt=timezone.now(),
                    listings__source__is_active=True,
                )
                .distinct()
                .get()
            )
        except Property.DoesNotExist as exc:
            raise NotFound("این ملک در دسترس نیست.") from exc
        record_product_event(
            event_type=ProductEventType.PROPERTY_VIEW,
            property_=property_,
            session_token=event_session(request),
        )
        return Response(status=204)


class ListingPhoneRevealView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        summary="Reveal the approved phone for an Active direct Listing",
        request=None,
        parameters=[EVENT_SESSION_PARAMETER],
        responses={200: PhoneRevealSerializer},
    )
    def post(self, request: Request, listing_id: uuid.UUID) -> Response:
        try:
            listing = (
                Listing.objects
                .active()
                .select_related("property", "source", "submission")
                .get(
                    id=listing_id,
                    source__is_builtin=True,
                    source__outbound_policy=OutboundPolicy.DIRECT_CONTACT,
                    direct_phone__gt="",
                    submission__state="published",
                    submission__phone_publication_consent=True,
                    submission__contact_phone=F("direct_phone"),
                )
            )
        except Listing.DoesNotExist as exc:
            raise NotFound("شماره تماس این آگهی در دسترس نیست.") from exc
        record_product_event(
            event_type=ProductEventType.PHONE_REVEAL,
            property_=listing.property,
            listing=listing,
            session_token=event_session(request),
        )
        return Response(PhoneRevealSerializer({"phone": listing.direct_phone}).data)


class ListingContinuationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        summary="Resolve an Active Listing's external continuation",
        request=None,
        parameters=[EVENT_SESSION_PARAMETER],
        responses={200: ExternalContinuationSerializer},
    )
    def post(self, request: Request, listing_id: uuid.UUID) -> Response:
        try:
            listing = (
                Listing.objects
                .active()
                .select_related("property", "source")
                .get(
                    id=listing_id,
                    source__outbound_policy=OutboundPolicy.EXTERNAL_LINK,
                    external_url__gt="",
                )
            )
        except Listing.DoesNotExist as exc:
            raise NotFound("مسیر ادامه این آگهی در دسترس نیست.") from exc
        record_product_event(
            event_type=ProductEventType.EXTERNAL_CONTINUATION,
            property_=listing.property,
            listing=listing,
            session_token=event_session(request),
        )
        return Response(ExternalContinuationSerializer({"url": listing.external_url}).data)

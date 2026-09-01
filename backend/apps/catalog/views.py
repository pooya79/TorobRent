import uuid
from collections import defaultdict
from decimal import ROUND_FLOOR, Decimal
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
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.pagination import StandardPageNumberPagination
from apps.common.serializers import ProblemSerializer

from .models import Favorite, Listing, OutboundPolicy, ProductEventType, Property
from .selectors import (
    autocomplete_locations,
    catalog_facets,
    catalog_statistics,
    favorite_properties,
    search_properties,
    supported_cities,
)
from .serializers import (
    CatalogFacetsSerializer,
    CatalogMapSerializer,
    CatalogStatisticsSerializer,
    EventSessionSerializer,
    ExternalContinuationSerializer,
    FavoriteCollectionSerializer,
    LocationSuggestionSerializer,
    PhoneRevealSerializer,
    PropertyDetailSerializer,
    PropertySearchPageSerializer,
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

MAP_MARKER_ZOOM_THRESHOLD = 11


def catalog_map_payload(
    mappable_properties: list[Property], *, total_property_count: int, zoom: int
) -> dict[str, object]:
    markers = mappable_properties
    clusters: list[dict[str, object]] = []
    if zoom < MAP_MARKER_ZOOM_THRESHOLD:
        cell_sizes = {
            10: Decimal("0.2"),
        }
        cell_size = cell_sizes.get(zoom, Decimal("0.4"))
        cells: dict[tuple[int, int], list[Property]] = defaultdict(list)
        for property_ in mappable_properties:
            latitude = property_.approximate_latitude
            longitude = property_.approximate_longitude
            if latitude is None or longitude is None:
                continue
            cell = (
                int((latitude / cell_size).to_integral_value(rounding=ROUND_FLOOR)),
                int((longitude / cell_size).to_integral_value(rounding=ROUND_FLOOR)),
            )
            cells[cell].append(property_)
        clustered_ids: set[uuid.UUID] = set()
        for cell, cell_properties in sorted(cells.items()):
            if len(cell_properties) < 2:
                continue
            property_ids = [property_.id for property_ in cell_properties]
            latitudes = [
                property_.approximate_latitude
                for property_ in cell_properties
                if property_.approximate_latitude is not None
            ]
            longitudes = [
                property_.approximate_longitude
                for property_ in cell_properties
                if property_.approximate_longitude is not None
            ]
            clustered_ids.update(property_ids)
            clusters.append({
                "id": f"{zoom}:{cell[0]}:{cell[1]}",
                "latitude": sum(latitudes, start=Decimal()) / len(cell_properties),
                "longitude": sum(longitudes, start=Decimal()) / len(cell_properties),
                "north": max(latitudes),
                "east": max(longitudes),
                "south": min(latitudes),
                "west": min(longitudes),
                "property_count": len(cell_properties),
                "property_ids": property_ids,
            })
        markers = [
            property_ for property_ in mappable_properties if property_.id not in clustered_ids
        ]
    return {
        "total_property_count": total_property_count,
        "mappable_property_count": len(mappable_properties),
        "clusters": clusters,
        "markers": markers,
    }


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
        responses={200: PropertySearchPageSerializer},
    )
)
class PropertySearchView(ListAPIView[Property]):
    permission_classes = [AllowAny]
    serializer_class = PropertySummarySerializer
    pagination_class = CatalogSearchPagination

    def list(self, request: Request, *args: object, **kwargs: object) -> Response:
        query = PropertySearchQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        filters = query.validated_filters()
        account_id = request.user.pk if request.user.is_authenticated else None
        queryset = search_properties(filters, favorite_account_id=account_id)
        page = self.paginate_queryset(queryset)
        if page is None:
            raise RuntimeError("Catalog search pagination must be configured")
        response = self.get_paginated_response(self.get_serializer(page, many=True).data)
        response.data["facets"] = CatalogFacetsSerializer(catalog_facets(filters)).data
        mappable_properties = list(
            search_properties(filters, favorite_account_id=account_id)
            .filter(
                approximate_latitude__isnull=False,
                approximate_longitude__isnull=False,
                location_radius_meters__isnull=False,
            )
            .exclude(location_precision="")
        )
        zoom = filters.viewport.zoom if filters.viewport is not None else 10
        response.data["map"] = CatalogMapSerializer(
            catalog_map_payload(
                mappable_properties,
                total_property_count=response.data["count"],
                zoom=zoom,
            )
        ).data
        return response

    def get_queryset(self) -> QuerySet[Property]:
        query = PropertySearchQuerySerializer(data=self.request.query_params)
        query.is_valid(raise_exception=True)
        account_id = self.request.user.pk if self.request.user.is_authenticated else None
        return search_properties(
            query.validated_filters(),
            favorite_account_id=account_id,
        )


class PropertyFavoriteView(APIView):
    permission_classes = [IsAuthenticated]

    def _active_property(self, property_id: uuid.UUID) -> Property:
        try:
            return (
                Property.objects
                .filter(
                    id=property_id,
                    listings__in=Listing.objects.active(),
                )
                .distinct()
                .get()
            )
        except Property.DoesNotExist as exc:
            raise NotFound("این ملک در دسترس نیست.") from exc

    @extend_schema(
        summary="Save an active Property as a Favorite",
        request=None,
        responses={204: None},
    )
    def put(self, request: Request, property_id: uuid.UUID) -> Response:
        property_ = self._active_property(property_id)
        Favorite.objects.get_or_create(account_id=request.user.pk, property=property_)
        return Response(status=204)

    @extend_schema(
        summary="Remove a Property from Favorites",
        request=None,
        responses={204: None},
    )
    def delete(self, request: Request, property_id: uuid.UUID) -> Response:
        Favorite.objects.filter(account_id=request.user.pk, property_id=property_id).delete()
        return Response(status=204)


class FavoriteCollectionView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        summary="List active and temporarily unavailable Favorites",
        responses={200: FavoriteCollectionSerializer},
    )
    def get(self, request: Request) -> Response:
        account_id = cast(uuid.UUID, request.user.pk)
        active, unavailable = favorite_properties(account_id)
        serializer = FavoriteCollectionSerializer({"active": active, "unavailable": unavailable})
        return Response(serializer.data)


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

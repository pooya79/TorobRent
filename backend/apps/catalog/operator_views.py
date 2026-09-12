from __future__ import annotations

import uuid
from dataclasses import asdict
from typing import cast

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.capabilities import OperatorCapability, has_capability
from apps.accounts.models import User
from apps.common.pagination import StandardPageNumberPagination

from .matching import compare_properties
from .operator_serializers import (
    CatalogCurationPropertySearchPageSerializer,
    CatalogCurationPropertySearchSerializer,
    PropertyComparisonSerializer,
    property_evidence_data,
    property_search_data,
)
from .selectors import current_properties_for_curation, search_current_properties_for_curation


class CanCurateCatalog(BasePermission):
    message = "مجوز ساماندهی کاتالوگ لازم است."

    def has_permission(self, request: Request, view: APIView) -> bool:
        return has_capability(cast(User, request.user), OperatorCapability.CURATE_CATALOG)


class CatalogCurationPropertySearchView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Search current Properties for manual Catalog Curation comparison",
        parameters=[
            OpenApiParameter(
                name="q",
                type=str,
                location="query",
                description=(
                    "Optional Property ID, Listing ID, Source display name, neighborhood, or "
                    "source reference. Persian characters and spacing are normalized. An empty "
                    "query lists current non-merged Properties."
                ),
            ),
            OpenApiParameter(name="page", type=int, location="query", description="Page number."),
            OpenApiParameter(
                name="page_size",
                type=int,
                location="query",
                description="Results per page; defaults to 25 and is capped at 100.",
            ),
        ],
        responses={200: CatalogCurationPropertySearchPageSerializer},
    )
    def get(self, request: Request) -> Response:
        properties = search_current_properties_for_curation(
            request.query_params.get("q", "").strip()
        )
        paginator = StandardPageNumberPagination()
        selected = paginator.paginate_queryset(properties, request, view=self)
        assert selected is not None
        data = CatalogCurationPropertySearchSerializer(
            [property_search_data(property_) for property_ in selected], many=True
        ).data
        return paginator.get_paginated_response(data)


class PropertyComparisonView(APIView):
    permission_classes = [CanCurateCatalog]

    @extend_schema(
        summary="Compare exactly two current Properties",
        parameters=[
            OpenApiParameter(
                name="property",
                type=uuid.UUID,
                many=True,
                location="query",
                required=True,
                description="Exactly two different current, non-merged Property IDs.",
            )
        ],
        responses={200: PropertyComparisonSerializer},
    )
    def get(self, request: Request) -> Response:
        raw_ids = request.query_params.getlist("property")
        if len(raw_ids) != 2 or raw_ids[0] == raw_ids[1]:
            raise ValidationError({"property": "دقیقاً دو ملک متفاوت انتخاب کنید."})
        try:
            property_ids = [uuid.UUID(value) for value in raw_ids]
        except ValueError as exc:
            raise ValidationError({"property": "شناسه ملک معتبر نیست."}) from exc
        found = {
            property_.id: property_
            for property_ in current_properties_for_curation().filter(id__in=property_ids)
        }
        if len(found) != 2:
            raise ValidationError({"property": "هر دو ملک باید جاری و ادغام‌نشده باشند."})
        properties = [found[property_id] for property_id in property_ids]
        payload = {
            **asdict(compare_properties(*properties)),
            "properties": [property_evidence_data(property_) for property_ in properties],
        }
        return Response(PropertyComparisonSerializer(payload).data)

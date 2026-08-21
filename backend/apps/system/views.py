import logging

from django.core.cache import cache
from django.db import connection
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import HealthSerializer

logger = logging.getLogger(__name__)


class LiveView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(summary="Check process liveness", responses=HealthSerializer)
    def get(self, request: Request) -> Response:
        return Response({"status": "ok"})


class ReadyView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        summary="Check dependency readiness",
        responses={
            200: HealthSerializer,
            503: OpenApiResponse(
                response=HealthSerializer, description="A dependency is unavailable"
            ),
        },
    )
    def get(self, request: Request) -> Response:
        try:
            connection.ensure_connection()
            cache.set("readiness", "ok", timeout=5)
            if cache.get("readiness") != "ok":
                raise RuntimeError("Cache readiness probe failed")
        except Exception:
            logger.exception("readiness_probe_failed")
            return Response({"status": "unavailable"}, status=503)
        return Response({"status": "ok"})

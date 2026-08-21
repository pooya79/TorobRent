from typing import cast

from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import ensure_csrf_cookie
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.serializers import ProblemSerializer

from .models import User
from .serializers import SessionSerializer, UserSerializer


@method_decorator(never_cache, name="dispatch")
@method_decorator(ensure_csrf_cookie, name="dispatch")
class SessionView(APIView):
    permission_classes = [AllowAny]

    @extend_schema(summary="Inspect the browser session", responses=SessionSerializer)
    def get(self, request: Request) -> Response:
        return Response({
            "authenticated": request.user.is_authenticated,
            "csrf_token": get_token(request),
        })


class CurrentUserView(APIView):
    @extend_schema(
        summary="Get the current user",
        responses={
            200: UserSerializer,
            (401, "application/problem+json"): OpenApiResponse(
                response=ProblemSerializer, description="Authentication is required"
            ),
        },
    )
    def get(self, request: Request) -> Response:
        return Response(UserSerializer(cast(User, request.user)).data)

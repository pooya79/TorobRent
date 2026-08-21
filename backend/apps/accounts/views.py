from typing import cast

from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.serializers import ProblemSerializer

from .models import User
from .serializers import (
    DetailSerializer,
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    RegistrationSerializer,
    SessionSerializer,
    TokenSerializer,
    UserSerializer,
)
from .services import (
    end_session,
    register_submitter,
    request_password_reset,
    reset_password,
    start_session,
    verify_submitter_email,
)

PROBLEM_MEDIA_TYPE = "application/problem+json"
VALIDATION_ERROR = OpenApiResponse(
    response=ProblemSerializer, description="Request validation failed"
)
AUTHENTICATION_ERROR = OpenApiResponse(
    response=ProblemSerializer, description="Authentication failed"
)
PERMISSION_ERROR = OpenApiResponse(
    response=ProblemSerializer, description="Authentication or CSRF verification failed"
)
UNSUPPORTED_MEDIA_ERROR = OpenApiResponse(
    response=ProblemSerializer, description="Only JSON request bodies are supported"
)
THROTTLED_ERROR = OpenApiResponse(response=ProblemSerializer, description="Request was throttled")
PUBLIC_MUTATION_ERRORS = {
    (400, PROBLEM_MEDIA_TYPE): VALIDATION_ERROR,
    (403, PROBLEM_MEDIA_TYPE): PERMISSION_ERROR,
    (415, PROBLEM_MEDIA_TYPE): UNSUPPORTED_MEDIA_ERROR,
    (429, PROBLEM_MEDIA_TYPE): THROTTLED_ERROR,
}


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


@method_decorator(csrf_protect, name="dispatch")
class RegistrationView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "registration"

    @extend_schema(
        summary="Register a Submitter",
        request=RegistrationSerializer,
        responses={
            201: DetailSerializer,
            **PUBLIC_MUTATION_ERRORS,
        },
    )
    def post(self, request: Request) -> Response:
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        register_submitter(**serializer.validated_data)
        return Response(
            {"detail": "حساب ساخته شد. برای تأیید ایمیل، پیام ارسال‌شده را بررسی کنید."},
            status=status.HTTP_201_CREATED,
        )


@method_decorator(csrf_protect, name="dispatch")
class VerifyEmailView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "email_verification"

    @extend_schema(
        summary="Verify a Submitter email address",
        request=TokenSerializer,
        responses={
            200: DetailSerializer,
            **PUBLIC_MUTATION_ERRORS,
        },
    )
    def post(self, request: Request) -> Response:
        serializer = TokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not verify_submitter_email(serializer.validated_data["token"]):
            raise ValidationError({"token": "پیوند تأیید نامعتبر است یا اعتبار آن تمام شده است."})
        return Response({"detail": "ایمیل شما تأیید شد. اکنون می‌توانید وارد شوید."})


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "login"

    @extend_schema(
        summary="Log in with an email and password",
        request=LoginSerializer,
        responses={
            200: UserSerializer,
            (401, PROBLEM_MEDIA_TYPE): AUTHENTICATION_ERROR,
            **PUBLIC_MUTATION_ERRORS,
        },
    )
    def post(self, request: Request) -> Response:
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = start_session(request._request, **serializer.validated_data)
        if user is None:
            raise AuthenticationFailed("ایمیل یا گذرواژه نادرست است.")
        return Response(UserSerializer(user).data)


@method_decorator(csrf_protect, name="dispatch")
class LogoutView(APIView):
    @extend_schema(
        summary="Log out of the current session",
        request=None,
        responses={
            200: DetailSerializer,
            (401, PROBLEM_MEDIA_TYPE): AUTHENTICATION_ERROR,
            (403, PROBLEM_MEDIA_TYPE): PERMISSION_ERROR,
        },
    )
    def post(self, request: Request) -> Response:
        end_session(request._request)
        return Response({"detail": "با موفقیت خارج شدید."})


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "password_reset_request"

    @extend_schema(
        summary="Request a password reset",
        request=PasswordResetRequestSerializer,
        responses={
            202: DetailSerializer,
            **PUBLIC_MUTATION_ERRORS,
        },
    )
    def post(self, request: Request) -> Response:
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request_password_reset(serializer.validated_data["email"])
        return Response(
            {"detail": "اگر حسابی با این ایمیل وجود داشته باشد، پیوند بازیابی ارسال می‌شود."},
            status=status.HTTP_202_ACCEPTED,
        )


@method_decorator(csrf_protect, name="dispatch")
class PasswordResetConfirmView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "password_reset_confirm"

    @extend_schema(
        summary="Reset a password",
        request=PasswordResetConfirmSerializer,
        responses={
            200: DetailSerializer,
            **PUBLIC_MUTATION_ERRORS,
        },
    )
    def post(self, request: Request) -> Response:
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not reset_password(
            token=serializer.validated_data["token"],
            new_password=serializer.validated_data["new_password"],
        ):
            raise ValidationError({"token": "پیوند بازیابی نامعتبر است یا اعتبار آن تمام شده است."})
        return Response({"detail": "گذرواژه شما تغییر کرد. اکنون می‌توانید وارد شوید."})

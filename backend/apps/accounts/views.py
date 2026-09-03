from typing import cast

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import status
from rest_framework.exceptions import APIException, AuthenticationFailed, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.serializers import ProblemSerializer

from .models import User
from .serializers import (
    CurrentUserSerializer,
    DetailSerializer,
    DisplayNameSerializer,
    DisplayNameUpdateSerializer,
    EmailVerificationRequestSerializer,
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    PhoneOtpResponseSerializer,
    PhoneVerificationRequestSerializer,
    PhoneVerificationSerializer,
    RegistrationResponseSerializer,
    RegistrationSerializer,
    SessionSerializer,
    SubmitterOnboardingStateSerializer,
    SubmitterOnboardingUpdateSerializer,
    TokenSerializer,
    UserSerializer,
)
from .services import (
    PhoneOwnershipConflict,
    PhoneVerificationResult,
    choose_display_name,
    end_session,
    grant_submitter_eligibility,
    register_renter,
    register_submitter,
    request_email_verification,
    request_password_reset,
    request_phone_verification,
    reset_password,
    start_session,
    verify_email,
    verify_phone,
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
CONFLICT_ERROR = OpenApiResponse(response=ProblemSerializer, description="Request conflicts")
PUBLIC_MUTATION_ERRORS = {
    (400, PROBLEM_MEDIA_TYPE): VALIDATION_ERROR,
    (403, PROBLEM_MEDIA_TYPE): PERMISSION_ERROR,
    (415, PROBLEM_MEDIA_TYPE): UNSUPPORTED_MEDIA_ERROR,
    (429, PROBLEM_MEDIA_TYPE): THROTTLED_ERROR,
}


class PhoneOwnershipConflictResponse(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "phone_ownership_conflict"
    default_detail = "این شماره به حساب دیگری متصل است. برای بررسی مالکیت با پشتیبانی تماس بگیرید."


def registration_response(identifier_kind: str, otp: str | None) -> Response:
    if identifier_kind == "phone":
        data = {
            "detail": "کد تأیید برای شماره تلفن ارسال شد.",
            "verification_method": "phone",
        }
        if settings.DEVELOPMENT_OTP_DISCLOSURE:
            assert otp is not None
            data["development_otp"] = otp
        return Response(data, status=status.HTTP_201_CREATED)
    return Response(
        {
            "detail": "حساب ساخته شد. برای تأیید ایمیل، پیام ارسال‌شده را بررسی کنید.",
            "verification_method": "email",
        },
        status=status.HTTP_201_CREATED,
    )


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
            200: CurrentUserSerializer,
            (401, "application/problem+json"): OpenApiResponse(
                response=ProblemSerializer, description="Authentication is required"
            ),
        },
    )
    def get(self, request: Request) -> Response:
        return Response(CurrentUserSerializer(cast(User, request.user)).data)


class DisplayNameView(APIView):
    @extend_schema(
        summary="Choose the current Listing Inquiry Display Name",
        request=DisplayNameUpdateSerializer,
        responses={200: DisplayNameSerializer},
    )
    def put(self, request: Request) -> Response:
        serializer = DisplayNameUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = choose_display_name(
            account=cast(User, request.user),
            display_name=serializer.validated_data["display_name"],
        )
        return Response({"display_name": user.display_name, "identity_verified": False})


@method_decorator(csrf_protect, name="dispatch")
class SubmitterOnboardingView(APIView):
    @staticmethod
    def response_data(user: User) -> dict[str, object]:
        return {
            "eligible": user.is_submitter and user.phone_verified,
            "phone_verified": user.phone_verified,
            "selected_path": user.submitter_onboarding_path,
        }

    @extend_schema(
        summary="Inspect Submitter onboarding progress",
        responses={200: SubmitterOnboardingStateSerializer},
    )
    def get(self, request: Request) -> Response:
        return Response(self.response_data(cast(User, request.user)))

    @extend_schema(
        summary="Complete or resume Submitter onboarding",
        request=SubmitterOnboardingUpdateSerializer,
        responses={200: SubmitterOnboardingStateSerializer, **PUBLIC_MUTATION_ERRORS},
    )
    def post(self, request: Request) -> Response:
        user = cast(User, request.user)
        serializer = SubmitterOnboardingUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            grant_submitter_eligibility(user=user, **serializer.validated_data)
        except DjangoValidationError as exc:
            raise ValidationError({"phone": exc.messages[0]}) from exc
        return Response(self.response_data(user))


@method_decorator(csrf_protect, name="dispatch")
class RegistrationView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "registration"

    @extend_schema(
        summary="Register a Submitter",
        request=RegistrationSerializer,
        responses={
            201: RegistrationResponseSerializer,
            **PUBLIC_MUTATION_ERRORS,
        },
    )
    def post(self, request: Request) -> Response:
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        identifier = serializer.validated_data["identifier"]
        _, otp = register_submitter(**serializer.validated_data)
        return registration_response(identifier.kind, otp)


@method_decorator(csrf_protect, name="dispatch")
class RenterRegistrationView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "registration"

    @extend_schema(
        summary="Register a Renter",
        request=RegistrationSerializer,
        responses={
            201: RegistrationResponseSerializer,
            **PUBLIC_MUTATION_ERRORS,
        },
    )
    def post(self, request: Request) -> Response:
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        identifier = serializer.validated_data["identifier"]
        _, otp = register_renter(**serializer.validated_data)
        return registration_response(identifier.kind, otp)


@method_decorator(csrf_protect, name="dispatch")
class VerifyEmailView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "email_verification"

    @extend_schema(
        summary="Verify an email address",
        request=TokenSerializer,
        responses={
            200: DetailSerializer,
            **PUBLIC_MUTATION_ERRORS,
        },
    )
    def post(self, request: Request) -> Response:
        serializer = TokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not verify_email(serializer.validated_data["token"]):
            raise ValidationError({"token": "پیوند تأیید نامعتبر است یا اعتبار آن تمام شده است."})
        return Response({"detail": "ایمیل شما تأیید شد. اکنون می‌توانید وارد شوید."})


@method_decorator(csrf_protect, name="dispatch")
class EmailVerificationRequestView(APIView):
    throttle_scope = "email_verification"

    @extend_schema(
        summary="Add or replace the current account email and send its verification link",
        request=EmailVerificationRequestSerializer,
        responses={202: DetailSerializer, **PUBLIC_MUTATION_ERRORS},
    )
    def post(self, request: Request) -> Response:
        serializer = EmailVerificationRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request_email_verification(
            email=serializer.validated_data["email"],
            requesting_user=cast(User, request.user),
            return_to=serializer.validated_data.get("return_to"),
        )
        return Response(
            {"detail": "اگر ایمیل قابل استفاده باشد، پیوند تأیید ارسال می‌شود."},
            status=status.HTTP_202_ACCEPTED,
        )


@method_decorator(csrf_protect, name="dispatch")
class VerifyPhoneView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "phone_verification"

    @extend_schema(
        summary="Verify an Iranian mobile number",
        request=PhoneVerificationSerializer,
        responses={200: DetailSerializer, **PUBLIC_MUTATION_ERRORS},
    )
    def post(self, request: Request) -> Response:
        serializer = PhoneVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = verify_phone(**serializer.validated_data)
        if result is not PhoneVerificationResult.SUCCESS:
            raise ValidationError({"otp": "کد تأیید پذیرفته نشد. کد تازه‌ای درخواست کنید."})
        return Response({"detail": "شماره تلفن تأیید شد. اکنون می‌توانید وارد شوید."})


@method_decorator(csrf_protect, name="dispatch")
class PhoneVerificationRequestView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "phone_verification_request"

    @extend_schema(
        summary="Request a phone verification code",
        request=PhoneVerificationRequestSerializer,
        responses={
            202: PhoneOtpResponseSerializer,
            (409, PROBLEM_MEDIA_TYPE): CONFLICT_ERROR,
            **PUBLIC_MUTATION_ERRORS,
        },
    )
    def post(self, request: Request) -> Response:
        serializer = PhoneVerificationRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        requesting_user = request.user if request.user.is_authenticated else None
        try:
            otp = request_phone_verification(
                phone=serializer.validated_data["identifier"],
                requesting_user=requesting_user,
                grants_submitter_eligibility=(
                    requesting_user is not None
                    and serializer.validated_data.get("purpose") == "submitter_onboarding"
                ),
            )
        except PhoneOwnershipConflict as exc:
            raise PhoneOwnershipConflictResponse from exc
        data = {"detail": "اگر شماره قابل تأیید باشد، کد تأیید ارسال می‌شود."}
        if settings.DEVELOPMENT_OTP_DISCLOSURE and otp is not None:
            data["development_otp"] = otp
        return Response(data, status=status.HTTP_202_ACCEPTED)


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "login"

    @extend_schema(
        summary="Log in with an email or Iranian mobile number and password",
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
            raise AuthenticationFailed("شناسه یا گذرواژه نادرست است.")
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

from collections.abc import Mapping
from typing import Any

from django.utils import timezone
from rest_framework.request import Request
from rest_framework.throttling import ScopedRateThrottle

from .identifiers import normalize_iranian_mobile
from .models import PhoneVerificationChallenge, User
from .services import PHONE_VERIFICATION_RESEND_COOLDOWN


class PhoneVerificationRequestThrottle(ScopedRateThrottle):
    """Do not charge the hourly limit for an OTP request suppressed by the resend cooldown."""

    def allow_request(self, request: Request, view: Any) -> bool:
        if self._is_suppressed_resend(request):
            return True
        return super().allow_request(request, view)

    @staticmethod
    def _is_suppressed_resend(request: Request) -> bool:
        data = request.data
        if not isinstance(data, Mapping):
            return False
        identifier = data.get("identifier")
        if not isinstance(identifier, str):
            return False
        phone = normalize_iranian_mobile(identifier.strip())
        if phone is None:
            return False

        user: User | None
        if request.user.is_authenticated:
            user = request.user
        else:
            user = User.objects.filter(phone=phone, phone_verified_at__isnull=True).first()
        if user is None:
            return False

        return PhoneVerificationChallenge.objects.filter(
            user=user,
            phone=phone,
            created_at__gt=timezone.now() - PHONE_VERIFICATION_RESEND_COOLDOWN,
        ).exists()

from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.views import APIView

from .models import User


class HasVerifiedIdentifier(BasePermission):
    message = "برای ادامه باید ایمیل یا شماره تلفن حساب تأیید شده باشد."

    def has_permission(self, request: Request, view: APIView) -> bool:
        user = request.user
        return (
            isinstance(user, User)
            and user.is_active
            and (user.email_verified or user.phone_verified)
        )

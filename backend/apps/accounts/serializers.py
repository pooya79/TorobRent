from typing import Any

from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import User

TOKEN_ERROR_MESSAGES: dict[str, Any] = {
    "required": "پیوند ناقص است.",
    "blank": "پیوند ناقص است.",
    "null": "پیوند ناقص است.",
}


class UserSerializer(serializers.ModelSerializer[User]):
    email_verified = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name", "email_verified")
        read_only_fields = fields


class SessionSerializer(serializers.Serializer[Any]):
    authenticated = serializers.BooleanField()
    csrf_token = serializers.CharField()


class DetailSerializer(serializers.Serializer[Any]):
    detail = serializers.CharField()


class RegistrationSerializer(serializers.Serializer[Any]):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_email(self, value: str) -> str:
        email = value.lower()
        if User.objects.filter(email=email).exists():
            raise serializers.ValidationError("حسابی با این ایمیل از قبل وجود دارد.")
        return email

    def validate_password(self, value: str) -> str:
        validate_password(value)
        return value


class TokenSerializer(serializers.Serializer[Any]):
    token = serializers.CharField(trim_whitespace=False, error_messages=TOKEN_ERROR_MESSAGES)


class LoginSerializer(serializers.Serializer[Any]):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_email(self, value: str) -> str:
        return value.lower()


class PasswordResetRequestSerializer(serializers.Serializer[Any]):
    email = serializers.EmailField()

    def validate_email(self, value: str) -> str:
        return value.lower()


class PasswordResetConfirmSerializer(serializers.Serializer[Any]):
    token = serializers.CharField(trim_whitespace=False, error_messages=TOKEN_ERROR_MESSAGES)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_new_password(self, value: str) -> str:
        validate_password(value)
        return value

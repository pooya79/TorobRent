from typing import Any

from rest_framework import serializers

from .capabilities import OperatorCapability
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
        fields: tuple[str, ...] = (
            "id",
            "email",
            "first_name",
            "last_name",
            "email_verified",
            "is_submitter",
        )
        read_only_fields: tuple[str, ...] = fields


class CurrentUserSerializer(UserSerializer):
    operator_capabilities = serializers.ListField(
        child=serializers.ChoiceField(choices=OperatorCapability.choices),
        read_only=True,
    )

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + ("operator_capabilities",)
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

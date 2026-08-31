from typing import Any

from rest_framework import serializers

from .capabilities import OperatorCapability
from .identifiers import AccountIdentifier, normalize_account_identifier
from .models import SubmitterOnboardingPath, User

TOKEN_ERROR_MESSAGES: dict[str, Any] = {
    "required": "پیوند ناقص است.",
    "blank": "پیوند ناقص است.",
    "null": "پیوند ناقص است.",
}


class AccountIdentifierField(serializers.CharField):
    default_error_messages = {"invalid": "ایمیل یا شماره تلفن معتبر نیست."}

    def to_internal_value(self, data: Any) -> Any:
        value = super().to_internal_value(data)
        try:
            return normalize_account_identifier(value)
        except ValueError:
            self.fail("invalid")


class IranianMobileField(serializers.CharField):
    default_error_messages = {"invalid": "شماره تلفن معتبر نیست."}

    def to_internal_value(self, data: Any) -> str:
        value = super().to_internal_value(data)
        try:
            identifier = normalize_account_identifier(value)
        except ValueError:
            self.fail("invalid")
        if identifier.kind != "phone":
            self.fail("invalid")
        return identifier.value


class UserSerializer(serializers.ModelSerializer[User]):
    email_verified = serializers.BooleanField(read_only=True)
    phone_verified = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields: tuple[str, ...] = (
            "id",
            "email",
            "phone",
            "first_name",
            "last_name",
            "email_verified",
            "phone_verified",
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


class SubmitterOnboardingStateSerializer(serializers.Serializer[Any]):
    eligible = serializers.BooleanField()
    phone_verified = serializers.BooleanField()
    selected_path = serializers.ChoiceField(
        choices=SubmitterOnboardingPath.choices, allow_null=True
    )


class SubmitterOnboardingUpdateSerializer(serializers.Serializer[Any]):
    selected_path = serializers.ChoiceField(choices=SubmitterOnboardingPath.choices, required=False)


class SessionSerializer(serializers.Serializer[Any]):
    authenticated = serializers.BooleanField()
    csrf_token = serializers.CharField()


class DetailSerializer(serializers.Serializer[Any]):
    detail = serializers.CharField()


class RegistrationSerializer(serializers.Serializer[Any]):
    identifier = AccountIdentifierField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    return_to = serializers.CharField(required=False, max_length=1000)

    def validate_identifier(self, value: AccountIdentifier) -> AccountIdentifier:
        if User.objects.filter(**{value.kind: value.value}).exists():
            raise serializers.ValidationError("این شناسه قابل استفاده نیست.")
        return value

    def validate_return_to(self, value: str) -> str:
        unsafe_character = "\\" in value or any(
            ord(character) < 32 or ord(character) == 127 for character in value
        )
        if not value.startswith("/") or value.startswith("//") or unsafe_character:
            raise serializers.ValidationError("مقصد بازگشت معتبر نیست.")
        return value


class TokenSerializer(serializers.Serializer[Any]):
    token = serializers.CharField(trim_whitespace=False, error_messages=TOKEN_ERROR_MESSAGES)


class LoginSerializer(serializers.Serializer[Any]):
    identifier = AccountIdentifierField()
    password = serializers.CharField(write_only=True, trim_whitespace=False)


class PhoneVerificationSerializer(serializers.Serializer[Any]):
    identifier = IranianMobileField()
    otp = serializers.RegexField(r"^\d{6}$")


class PhoneVerificationRequestSerializer(serializers.Serializer[Any]):
    identifier = IranianMobileField()
    purpose = serializers.ChoiceField(choices=("submitter_onboarding",), required=False)


class PhoneOtpResponseSerializer(DetailSerializer):
    demo_otp = serializers.RegexField(r"^\d{6}$", required=False)


class RegistrationResponseSerializer(PhoneOtpResponseSerializer):
    verification_method = serializers.ChoiceField(choices=("email", "phone"))


class EmailVerificationRequestSerializer(serializers.Serializer[Any]):
    email = serializers.EmailField()

    def validate_email(self, value: str) -> str:
        return value.lower()


class PasswordResetRequestSerializer(serializers.Serializer[Any]):
    email = serializers.EmailField()

    def validate_email(self, value: str) -> str:
        return value.lower()


class PasswordResetConfirmSerializer(serializers.Serializer[Any]):
    token = serializers.CharField(trim_whitespace=False, error_messages=TOKEN_ERROR_MESSAGES)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

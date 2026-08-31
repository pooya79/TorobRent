from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import InventoryRange, SourceProposal, SourceRepresentativeRelationship

REQUIRED_ERROR = "این مقدار الزامی است."


class SourceProposalCreateSerializer(serializers.Serializer[Any]):
    start_new = serializers.BooleanField(required=False, default=False)


class SourceProposalDraftSerializer(serializers.Serializer[Any]):
    website_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    website_url = serializers.URLField(max_length=1000, required=False, allow_blank=True)
    relationship = serializers.ChoiceField(
        choices=SourceRepresentativeRelationship.choices, required=False, allow_blank=True
    )
    inventory_range = serializers.ChoiceField(
        choices=InventoryRange.choices, required=False, allow_blank=True
    )
    sitemap_url = serializers.URLField(max_length=1000, required=False, allow_blank=True)
    operator_note = serializers.CharField(max_length=5000, required=False, allow_blank=True)
    authority_declared = serializers.BooleanField(required=False)


class SourceProposalDetailsSerializer(serializers.Serializer[Any]):
    website_name = serializers.CharField(
        max_length=200,
        error_messages={"required": REQUIRED_ERROR, "blank": REQUIRED_ERROR},
    )
    website_url = serializers.URLField(
        max_length=1000,
        error_messages={"required": REQUIRED_ERROR, "blank": REQUIRED_ERROR},
    )
    relationship = serializers.ChoiceField(
        choices=SourceRepresentativeRelationship.choices,
        error_messages={
            "required": REQUIRED_ERROR,
            "invalid_choice": "رابطه انتخاب‌شده معتبر نیست.",
        },
    )
    inventory_range = serializers.ChoiceField(
        choices=InventoryRange.choices,
        error_messages={"required": REQUIRED_ERROR, "invalid_choice": "بازه انتخاب‌شده معتبر نیست."},
    )
    sitemap_url = serializers.URLField(max_length=1000, required=False, allow_blank=True)
    operator_note = serializers.CharField(max_length=5000, required=False, allow_blank=True)
    authority_declared = serializers.BooleanField(error_messages={"required": REQUIRED_ERROR})

    def validate_authority_declared(self, value: bool) -> bool:
        if not value:
            raise serializers.ValidationError("اعلام اختیار برای معرفی وب‌سایت الزامی است.")
        return value


class SourceProposalSubmitSerializer(serializers.Serializer[Any]):
    preview_confirmed = serializers.BooleanField(error_messages={"required": REQUIRED_ERROR})

    def validate_preview_confirmed(self, value: bool) -> bool:
        if not value:
            raise serializers.ValidationError("تأیید پیش‌نمایش شبیه‌سازی‌شده الزامی است.")
        return value


class SimulatedPreviewExampleSerializer(serializers.Serializer[Any]):
    title = serializers.CharField()
    status = serializers.CharField()


class SimulatedSourceProposalPreviewSerializer(serializers.Serializer[Any]):
    simulated = serializers.BooleanField()
    title = serializers.CharField()
    disclaimer = serializers.CharField()
    estimated_count = serializers.IntegerField(allow_null=True)
    inventory_range = serializers.ChoiceField(choices=InventoryRange.choices)
    examples = SimulatedPreviewExampleSerializer(many=True)


class SourceProposalSerializer(serializers.ModelSerializer[SourceProposal]):
    available_actions = serializers.SerializerMethodField()
    preview = serializers.SerializerMethodField()

    class Meta:
        model = SourceProposal
        fields = (
            "id",
            "state",
            "current_step",
            "website_name",
            "website_url",
            "relationship",
            "inventory_range",
            "sitemap_url",
            "operator_note",
            "authority_declared",
            "preview",
            "preview_confirmed",
            "pending_since",
            "available_actions",
            "created_at",
            "updated_at",
        )

    def get_available_actions(self, proposal: SourceProposal) -> list[str]:
        return ["edit"] if proposal.state == "draft" else []

    @extend_schema_field(SimulatedSourceProposalPreviewSerializer(allow_null=True))
    def get_preview(self, proposal: SourceProposal) -> dict[str, Any] | None:
        if not proposal.preview:
            return None
        return dict(SimulatedSourceProposalPreviewSerializer(proposal.preview).data)

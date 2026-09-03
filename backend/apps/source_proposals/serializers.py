from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import (
    ExternalListingCandidate,
    ExternalListingCandidateEvent,
    ExternalListingCandidateReviewClaim,
    InventoryRange,
    SourceProposal,
    SourceProposalEvent,
    SourceProposalReviewClaim,
    SourceProposalState,
    SourceRepresentativeRelationship,
)

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


class SourceProposalEventSerializer(serializers.ModelSerializer[SourceProposalEvent]):
    actor_label = serializers.EmailField(source="actor.email", read_only=True)

    class Meta:
        model = SourceProposalEvent
        fields = (
            "id",
            "actor_label",
            "revision",
            "prior_state",
            "new_state",
            "reason",
            "created_at",
        )


class SourceProposalSerializer(serializers.ModelSerializer[SourceProposal]):
    available_actions = serializers.SerializerMethodField()
    preview = serializers.SerializerMethodField()
    history = serializers.SerializerMethodField()

    class Meta:
        model = SourceProposal
        fields = (
            "id",
            "state",
            "revision",
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
            "history",
            "created_at",
            "updated_at",
        )

    def get_available_actions(self, proposal: SourceProposal) -> list[str]:
        if proposal.state == SourceProposalState.DRAFT:
            actions = ["edit"]
            if proposal.can_discard:
                actions.append("delete")
            return actions
        if proposal.state == SourceProposalState.CHANGES_REQUESTED:
            return ["edit"]
        return []

    @extend_schema_field(SimulatedSourceProposalPreviewSerializer(allow_null=True))
    def get_preview(self, proposal: SourceProposal) -> dict[str, Any] | None:
        if not proposal.preview:
            return None
        return dict(SimulatedSourceProposalPreviewSerializer(proposal.preview).data)

    @extend_schema_field(SourceProposalEventSerializer(many=True))
    def get_history(self, proposal: SourceProposal) -> list[dict[str, Any]]:
        return list(SourceProposalEventSerializer(proposal.events.all(), many=True).data)


class SourceProposalReviewClaimSerializer(serializers.ModelSerializer[SourceProposalReviewClaim]):
    operator_label = serializers.EmailField(source="operator.email", read_only=True)

    class Meta:
        model = SourceProposalReviewClaim
        fields = ("id", "operator_label", "revision", "expires_at", "created_at")


class SourceProposalDecisionSerializer(serializers.Serializer[Any]):
    reviewed_revision = serializers.IntegerField(min_value=1)
    reason = serializers.CharField(max_length=5000, allow_blank=True)


class SourceProposalApprovalSerializer(serializers.Serializer[Any]):
    reviewed_revision = serializers.IntegerField(min_value=1)
    confirmed = serializers.BooleanField()

    def validate_confirmed(self, value: bool) -> bool:
        if not value:
            raise serializers.ValidationError("تأیید اعتبارسنجی Source الزامی است.")
        return value


class OperatorSourceProposalSerializer(SourceProposalSerializer):
    needs_reconciliation = serializers.SerializerMethodField()

    class Meta(SourceProposalSerializer.Meta):
        fields = SourceProposalSerializer.Meta.fields + (  # type: ignore[assignment]
            "needs_reconciliation",
        )

    def get_needs_reconciliation(self, proposal: SourceProposal) -> bool:
        if not proposal.normalized_domain:
            return False
        return (
            SourceProposal.objects
            .filter(
                discarded_at__isnull=True,
                normalized_domain=proposal.normalized_domain,
                state__in=(
                    SourceProposalState.DRAFT,
                    SourceProposalState.PENDING,
                    SourceProposalState.CHANGES_REQUESTED,
                ),
            )
            .exclude(submitter_id=proposal.submitter_id)
            .exists()
        )


class ExternalCandidateSourceSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    display_name = serializers.CharField()
    domain = serializers.CharField()
    is_active = serializers.BooleanField()


class ExternalListingCandidateEventSerializer(
    serializers.ModelSerializer[ExternalListingCandidateEvent]
):
    actor_label = serializers.EmailField(source="actor.email", read_only=True)

    class Meta:
        model = ExternalListingCandidateEvent
        fields = (
            "id",
            "actor_label",
            "revision",
            "prior_state",
            "new_state",
            "reason",
            "created_at",
        )


class ExternalListingCandidateSerializer(serializers.ModelSerializer[ExternalListingCandidate]):
    source = ExternalCandidateSourceSerializer(read_only=True)  # type: ignore[assignment]
    source_proposal_id = serializers.UUIDField(read_only=True)
    listing_id = serializers.UUIDField(read_only=True, allow_null=True)
    media = serializers.SerializerMethodField()
    history = ExternalListingCandidateEventSerializer(source="events", many=True, read_only=True)

    class Meta:
        model = ExternalListingCandidate
        fields = (
            "id",
            "source_proposal_id",
            "source",
            "listing_id",
            "state",
            "revision",
            "simulated",
            "title",
            "external_url",
            "property_type",
            "area_sqm",
            "room_count",
            "deposit_rial",
            "monthly_rent_rial",
            "description",
            "media",
            "history",
            "created_at",
            "updated_at",
        )

    @extend_schema_field(serializers.ListField(child=serializers.CharField()))
    def get_media(self, _candidate: ExternalListingCandidate) -> list[str]:
        return []


class ExternalListingCandidateReviewClaimSerializer(
    serializers.ModelSerializer[ExternalListingCandidateReviewClaim]
):
    operator_label = serializers.EmailField(source="operator.email", read_only=True)

    class Meta:
        model = ExternalListingCandidateReviewClaim
        fields = ("id", "operator_label", "revision", "expires_at", "created_at")

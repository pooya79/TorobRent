from typing import Any

from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .models import (
    DiscoveryStage,
    ExternalListingCandidate,
    ExternalListingCandidateEvent,
    ExternalListingCandidateReviewClaim,
    InventoryRange,
    SourceProposal,
    SourceProposalEvent,
    SourceProposalReviewClaim,
    SourceProposalState,
    SourceRepresentativeRelationship,
    SourceReservation,
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
            raise serializers.ValidationError("تأیید اطلاعات وب‌سایت الزامی است.")
        return value


class PreviewExampleSerializer(serializers.Serializer[Any]):
    title = serializers.CharField()
    status = serializers.CharField()


class SourceProposalPreviewSerializer(serializers.Serializer[Any]):
    simulated = serializers.BooleanField()
    title = serializers.CharField()
    disclaimer = serializers.CharField()
    estimated_count = serializers.IntegerField(allow_null=True)
    inventory_range = serializers.ChoiceField(choices=InventoryRange.choices)
    examples = PreviewExampleSerializer(many=True)


class SourceProposalEventSerializer(serializers.ModelSerializer[SourceProposalEvent]):
    actor_label = serializers.SerializerMethodField()

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

    def get_actor_label(self, event: SourceProposalEvent) -> str:
        if event.actor is None:
            return "Former account"
        return event.actor.email or str(event.actor_id)


class SourceProposalSerializer(serializers.ModelSerializer[SourceProposal]):
    available_actions = serializers.SerializerMethodField()
    preview = serializers.SerializerMethodField()
    history = serializers.SerializerMethodField()

    class Meta:
        model = SourceProposal
        read_only_fields = ("discovery_stage",)
        fields = (
            "id",
            "state",
            "discovery_stage",
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

    def to_representation(self, instance: SourceProposal) -> dict[str, Any]:
        data = super().to_representation(instance)
        reservation = instance.reservations.filter(revision=instance.revision).first()
        if (
            instance.state == SourceProposalState.PENDING
            and reservation
            and (reservation.expires_at <= timezone.now() or reservation.released_at)
            and instance.discovery_stage != DiscoveryStage.FAILED
        ):
            data["discovery_stage"] = DiscoveryStage.RELEASED
        return data

    def get_available_actions(self, proposal: SourceProposal) -> list[str]:
        if proposal.state == SourceProposalState.DRAFT:
            actions = ["edit"]
            if proposal.can_discard:
                actions.append("delete")
            return actions
        if proposal.state == SourceProposalState.CHANGES_REQUESTED:
            return ["edit"]
        return []

    @extend_schema_field(SourceProposalPreviewSerializer(allow_null=True))
    def get_preview(self, proposal: SourceProposal) -> dict[str, Any] | None:
        if not proposal.preview:
            return None
        return dict(SourceProposalPreviewSerializer(proposal.preview).data)

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


class DiscoverySampleSerializer(serializers.Serializer[Any]):
    url = serializers.CharField()
    classification = serializers.CharField()
    evidence = serializers.ListField(child=serializers.CharField())


class DiscoveryStructureSerializer(serializers.Serializer[Any]):
    fingerprint = serializers.CharField()
    representative_url_shape = serializers.CharField()
    page_urls = serializers.ListField(child=serializers.CharField())
    supported_page_urls = serializers.ListField(child=serializers.CharField())
    excluded_page_urls = serializers.ListField(child=serializers.CharField())
    coverage = serializers.FloatField()
    selected = serializers.BooleanField()


class DiscoveryFailureSerializer(serializers.Serializer[Any]):
    url = serializers.CharField(required=False)
    code = serializers.CharField()
    detail = serializers.CharField()


class DiscoveryEvidenceSerializer(serializers.Serializer[Any]):
    page_count = serializers.IntegerField(default=0)
    detail_page_count = serializers.IntegerField(default=0)
    classifications = serializers.DictField(child=serializers.IntegerField(), default=dict)
    structures = DiscoveryStructureSerializer(many=True, default=list)
    exclusions = serializers.ListField(child=serializers.CharField(), default=list)
    samples = DiscoverySampleSerializer(many=True, default=list)
    failures = DiscoveryFailureSerializer(many=True, default=list)


class SourceDiscoverySerializer(serializers.ModelSerializer[SourceReservation]):
    evidence = DiscoveryEvidenceSerializer(read_only=True)

    class Meta:
        model = SourceReservation
        fields = (
            "id",
            "expires_at",
            "released_at",
            "release_reason",
            "started_at",
            "completed_at",
            "evidence",
        )


class OperatorSourceProposalSerializer(SourceProposalSerializer):
    needs_reconciliation = serializers.SerializerMethodField()
    discovery = serializers.SerializerMethodField()

    class Meta(SourceProposalSerializer.Meta):
        fields = SourceProposalSerializer.Meta.fields + (  # type: ignore[assignment]
            "needs_reconciliation",
            "discovery",
        )

    @extend_schema_field(SourceDiscoverySerializer(allow_null=True))
    def get_discovery(self, proposal: SourceProposal) -> dict[str, Any] | None:
        reservation = proposal.reservations.filter(revision=proposal.revision).first()
        return dict(SourceDiscoverySerializer(reservation).data) if reservation else None

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

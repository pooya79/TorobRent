from typing import Any

from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from .candidate_serializers import (
    ExternalListingCandidateSerializer as ExternalListingCandidateSerializer,
)
from .extraction_serializers import ExtractionRequestSerializer
from .models import (
    DiscoveryStage,
    ExternalListingCandidateReviewClaim,
    InventoryRange,
    SourceAssignment,
    SourceProfileRepair,
    SourceProfileVersion,
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


class AssignmentSourceSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    display_name = serializers.CharField()
    domain = serializers.CharField()


class AssignmentProfileVersionSerializer(serializers.Serializer[Any]):
    id = serializers.UUIDField()
    number = serializers.IntegerField()


class SourceAssignmentSerializer(serializers.ModelSerializer[SourceAssignment]):
    review_operator = serializers.UUIDField(
        source="approval.event.actor_id", read_only=True, allow_null=True, default=None
    )
    recent_requests = serializers.SerializerMethodField()

    @extend_schema_field(ExtractionRequestSerializer(many=True))
    def get_recent_requests(self, assignment: SourceAssignment) -> list[dict[str, Any]]:
        return list(
            ExtractionRequestSerializer(
                assignment.requests.select_related("run")[:10], many=True
            ).data
        )

    source = AssignmentSourceSerializer(read_only=True)  # type: ignore[assignment]
    state = serializers.SerializerMethodField()
    active_profile_version = serializers.SerializerMethodField()
    review_mode = serializers.ChoiceField(
        source="approval.review_mode",
        choices=("approval_required", "automatic"),
        read_only=True,
        allow_null=True,
        default=None,
    )

    class Meta:
        model = SourceAssignment
        fields = (
            "id",
            "state",
            "source",
            "active_profile_version",
            "review_mode",
            "created_at",
            "revoked_at",
            "recent_requests",
            "review_operator",
        )

    @extend_schema_field(serializers.ChoiceField(choices=("active", "revoked")))
    def get_state(self, assignment: SourceAssignment) -> str:
        return "revoked" if assignment.revoked_at else "active"

    @extend_schema_field(AssignmentProfileVersionSerializer(allow_null=True))
    def get_active_profile_version(self, assignment: SourceAssignment) -> dict[str, Any] | None:
        if assignment.revoked_at or assignment.approval is None:
            return None
        version = assignment.approval.version
        if version.profile.active_version_id != version.pk:
            return None
        return dict(AssignmentProfileVersionSerializer(version).data)


class SourceProposalSerializer(serializers.ModelSerializer[SourceProposal]):
    assignment = serializers.SerializerMethodField()
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
            "assignment",
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

    @extend_schema_field(SourceAssignmentSerializer(allow_null=True))
    def get_assignment(self, proposal: SourceProposal) -> dict[str, Any] | None:
        assignment = (
            SourceAssignment.objects
            .filter(proposal=proposal, representative_id=proposal.submitter_id)
            .select_related("source", "approval__version__profile")
            .order_by("-created_at")
            .first()
        )
        return dict(SourceAssignmentSerializer(assignment).data) if assignment else None

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


class SourceProfileDecisionSerializer(SourceProposalDecisionSerializer):
    reviewed_profile_version = serializers.UUIDField(required=False)


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
    profile_failure = serializers.CharField(required=False)
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


class ProfileFieldEvidenceSerializer(serializers.Serializer[Any]):
    observer_name = serializers.CharField()
    raw_value = serializers.JSONField()
    normalized_value = serializers.JSONField()
    confidence = serializers.FloatField()
    source_locator = serializers.CharField()
    evidence_snippet = serializers.CharField()
    disposition = serializers.CharField()


class ProfileFieldValidationSerializer(serializers.Serializer[Any]):
    resolved = serializers.IntegerField()
    conflicts = serializers.IntegerField()
    coverage = serializers.FloatField()
    passed = serializers.BooleanField()
    missing_page_urls = serializers.ListField(child=serializers.CharField())
    conflict_page_urls = serializers.ListField(child=serializers.CharField())


class ProfileValidationSerializer(serializers.Serializer[Any]):
    training_page_urls = serializers.ListField(child=serializers.CharField())
    held_out_page_urls = serializers.ListField(child=serializers.CharField())
    required_resolved = serializers.IntegerField()
    fields = serializers.DictField(child=ProfileFieldValidationSerializer())  # type: ignore[assignment]
    pages = serializers.ListField(child=serializers.JSONField())
    approval_enabled = serializers.BooleanField()


class ProfileSampleSerializer(serializers.Serializer[Any]):
    canonical_url = serializers.CharField()
    normalized = serializers.DictField(child=serializers.JSONField())
    source_claims = serializers.DictField(
        child=serializers.ListField(child=serializers.JSONField())
    )
    evidence = serializers.DictField(child=ProfileFieldEvidenceSerializer(many=True))
    conflicts = serializers.DictField(child=serializers.ListField(child=serializers.JSONField()))
    unresolved = serializers.ListField(child=serializers.CharField())
    status = serializers.CharField()
    structural_drift = serializers.BooleanField()
    fingerprint_similarity = serializers.FloatField()


class SourceProfileVersionSerializer(serializers.ModelSerializer[SourceProfileVersion]):
    media_candidates = ExternalListingCandidateSerializer(many=True, read_only=True)
    reservation = serializers.UUIDField(source="reservation_id", read_only=True)
    decision_reason = serializers.CharField(
        source="decision.event.reason", read_only=True, default=""
    )
    decided_at = serializers.DateTimeField(
        source="decision.event.created_at", read_only=True, default=None
    )
    validation = ProfileValidationSerializer(read_only=True)
    samples = ProfileSampleSerializer(many=True, read_only=True)
    review_mode = serializers.CharField(source="decision.review_mode", read_only=True, default="")
    status = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()
    created_by_label = serializers.CharField(source="created_by.email", read_only=True, default="")

    class Meta:
        model = SourceProfileVersion
        fields = (
            "id",
            "reservation",
            "decision_reason",
            "decided_at",
            "number",
            "parent",
            "rules",
            "structural_fingerprint",
            "validation",
            "samples",
            "media_candidates",
            "exclusions",
            "diagnostics",
            "pipeline_version",
            "provenance",
            "created_at",
            "created_by_label",
            "status",
            "is_active",
            "review_mode",
        )

    def get_status(self, version: SourceProfileVersion) -> str:
        return version.decision.event.new_state if hasattr(version, "decision") else "proposed"

    def get_is_active(self, version: SourceProfileVersion) -> bool:
        return version.profile.active_version_id == version.pk


class SourceProfileRepairSerializer(serializers.ModelSerializer[SourceProfileRepair]):
    selected_fields = serializers.ListField(child=serializers.CharField(), read_only=True)
    outcome = serializers.SerializerMethodField()
    detail = serializers.SerializerMethodField()
    structured_result = serializers.JSONField(
        source="result.structured_result", read_only=True, default=None, allow_null=True
    )
    validation = serializers.JSONField(source="result.validation", read_only=True, default=dict)
    result_version = serializers.UUIDField(
        source="result.result_version_id", read_only=True, default=None, allow_null=True
    )
    duration_ms = serializers.IntegerField(
        source="result.duration_ms", read_only=True, default=None, allow_null=True
    )
    finished_at = serializers.DateTimeField(
        source="result.finished_at", read_only=True, default=None, allow_null=True
    )

    class Meta:
        model = SourceProfileRepair
        fields = (
            "id",
            "parent",
            "actor",
            "selected_fields",
            "model",
            "prompt_version",
            "schema_version",
            "evidence_sha256",
            "started_at",
            "finished_at",
            "outcome",
            "detail",
            "structured_result",
            "validation",
            "result_version",
            "duration_ms",
        )

    def get_outcome(self, repair: SourceProfileRepair) -> str:
        from .profile_repair import REPAIR_STALE_SECONDS

        if hasattr(repair, "result"):
            return repair.result.outcome
        return (
            "interrupted"
            if (timezone.now() - repair.started_at).total_seconds() > REPAIR_STALE_SECONDS
            else "pending"
        )

    def get_detail(self, repair: SourceProfileRepair) -> str:
        if hasattr(repair, "result"):
            return repair.result.detail
        if self.get_outcome(repair) == "interrupted":
            return "درخواست ناتمام ماند؛ پرونده را تازه کنید و در صورت نیاز درخواست تازه‌ای بدهید."
        return "اصلاح در حال انجام است؛ پرونده را تازه کنید."


class OperatorSourceProposalSerializer(SourceProposalSerializer):
    needs_reconciliation = serializers.SerializerMethodField()
    discovery = serializers.SerializerMethodField()
    profile_versions = serializers.SerializerMethodField()
    profile_repairs = serializers.SerializerMethodField()

    class Meta(SourceProposalSerializer.Meta):
        fields = SourceProposalSerializer.Meta.fields + (  # type: ignore[assignment]
            "needs_reconciliation",
            "discovery",
            "profile_versions",
            "profile_repairs",
        )

    @extend_schema_field(SourceProfileRepairSerializer(many=True))
    def get_profile_repairs(self, proposal: SourceProposal) -> list[dict[str, Any]]:
        repairs = SourceProfileRepair.objects.filter(
            parent__reservation__proposal=proposal
        ).select_related("result")
        return list(SourceProfileRepairSerializer(repairs, many=True).data)

    @extend_schema_field(SourceProfileVersionSerializer(many=True))
    def get_profile_versions(self, proposal: SourceProposal) -> list[dict[str, Any]]:
        versions = SourceProfileVersion.objects.filter(
            reservation__proposal=proposal
        ).select_related("profile", "decision__event", "created_by")
        return list(SourceProfileVersionSerializer(versions, many=True).data)

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


class ExternalListingCandidateReviewClaimSerializer(
    serializers.ModelSerializer[ExternalListingCandidateReviewClaim]
):
    operator_label = serializers.EmailField(source="operator.email", read_only=True)

    class Meta:
        model = ExternalListingCandidateReviewClaim
        fields = ("id", "operator_label", "revision", "expires_at", "created_at")


class SourceProfileEditSerializer(serializers.Serializer[Any]):
    reviewed_revision = serializers.IntegerField(min_value=1)
    reviewed_profile_version = serializers.UUIDField()
    rules = serializers.JSONField()

    def validate_rules(self, value: Any) -> dict[str, Any]:
        from apps.source_extraction.rules import validate_field_rules

        try:
            return validate_field_rules(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from None


class SourceProfileApprovalSerializer(SourceProposalApprovalSerializer):
    reviewed_profile_version = serializers.UUIDField()
    review_mode = serializers.ChoiceField(choices=("approval_required", "automatic"))


class SourceProfileRepairRequestSerializer(serializers.Serializer[Any]):
    request_id = serializers.UUIDField()
    reviewed_revision = serializers.IntegerField(min_value=1)
    reviewed_profile_version = serializers.UUIDField()
    selected_fields = serializers.ListField(
        child=serializers.CharField(max_length=40), min_length=1, max_length=4
    )

from __future__ import annotations

import uuid
from collections.abc import Collection, Iterable
from typing import Any, ClassVar

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


class MessageKind(models.TextChoices):
    SYSTEM_NOTIFICATION = "system_notification", "System Notification"
    LISTING_INQUIRY = "listing_inquiry", "Listing Inquiry"
    SUPPORT_REQUEST = "support_request", "Support Request"


class ListingInquiryReplyUnavailableReason(models.TextChoices):
    ACCOUNT_DELETED = "account_deleted", "Account deleted"
    ACCOUNT_BLOCKED = "account_blocked", "Account blocked"
    LISTING_INACTIVE = "listing_inactive", "Listing inactive"
    RESPONSIBILITY_CHANGED = "responsibility_changed", "Responsibility changed"


LISTING_INQUIRY_OPENING_ATTNAMES = frozenset({
    "listing_id",
    "opening_property_title",
    "opening_area_sqm",
    "opening_deposit_rial",
    "opening_monthly_rent_rial",
    "opening_currency",
    "opening_source_display_name",
    "opening_message_fingerprint",
})
LISTING_INQUIRY_OPENING_FIELDS = LISTING_INQUIRY_OPENING_ATTNAMES | {
    "listing",
}


class ListingInquiryQuerySet(models.QuerySet["ListingInquiry"]):
    def update(self, **kwargs: Any) -> int:
        if LISTING_INQUIRY_OPENING_FIELDS.intersection(kwargs):
            raise ValidationError("Listing Inquiry opening context is immutable.")
        return super().update(**kwargs)

    def bulk_update(
        self,
        objs: Iterable[ListingInquiry],
        fields: Iterable[str],
        batch_size: int | None = None,
    ) -> int:
        if LISTING_INQUIRY_OPENING_FIELDS.intersection(fields):
            raise ValidationError("Listing Inquiry opening context is immutable.")
        return super().bulk_update(objs, fields, batch_size)


class ListingInquiryManager(models.Manager["ListingInquiry"]):
    def get_queryset(self) -> ListingInquiryQuerySet:
        return ListingInquiryQuerySet(self.model, using=self._db)


class ListingInquiry(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    listing = models.ForeignKey(
        "catalog.Listing",
        on_delete=models.PROTECT,
        related_name="inquiries",
        editable=False,
    )
    renter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="renter_listing_inquiries",
        editable=False,
        null=True,
    )
    submitter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="submitter_listing_inquiries",
        editable=False,
        null=True,
    )
    opening_property_title = models.CharField(max_length=255, editable=False)
    opening_area_sqm = models.PositiveIntegerField(editable=False)
    opening_deposit_rial = models.PositiveBigIntegerField(editable=False)
    opening_monthly_rent_rial = models.PositiveBigIntegerField(editable=False)
    opening_currency = models.CharField(max_length=3, default="IRR", editable=False)
    opening_source_display_name = models.CharField(max_length=120, editable=False)
    opening_message_fingerprint = models.CharField(max_length=64, editable=False)
    renter_read_at = models.DateTimeField(null=True, blank=True)
    submitter_read_at = models.DateTimeField(null=True, blank=True)
    latest_activity_at = models.DateTimeField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects: ClassVar[ListingInquiryManager] = ListingInquiryManager()

    class Meta:
        ordering = ("-latest_activity_at", "-id")
        indexes = [
            models.Index(
                fields=("renter", "opening_message_fingerprint", "created_at"),
                name="inquiry_repeated_content_idx",
            )
        ]
        constraints = [
            models.UniqueConstraint(
                fields=("renter", "listing"),
                name="one_listing_inquiry_per_renter_listing",
            ),
            models.CheckConstraint(
                condition=~models.Q(renter=models.F("submitter")),
                name="listing_inquiry_participants_differ",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.renter_id} -> {self.listing_id}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        if not self._state.adding:
            update_fields = kwargs.get("update_fields")
            if update_fields is None or LISTING_INQUIRY_OPENING_FIELDS.intersection(update_fields):
                opening_values = (
                    type(self).objects.values(*LISTING_INQUIRY_OPENING_ATTNAMES).get(id=self.id)
                )
                if any(getattr(self, field) != value for field, value in opening_values.items()):
                    raise ValidationError("Listing Inquiry opening context is immutable.")
        super().save(*args, **kwargs)

    @property
    def has_deleted_participant(self) -> bool:
        return self.renter_id is None or self.submitter_id is None


class ListingInquiryMessage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    inquiry = models.ForeignKey(
        ListingInquiry,
        on_delete=models.CASCADE,
        related_name="messages",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="listing_inquiry_messages",
        null=True,
    )
    body = models.TextField(max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True, editable=False)
    edit_locked_at = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        ordering = ("created_at", "id")

    def __str__(self) -> str:
        return f"{self.inquiry_id}: {self.author_id}"


class ConversationReportStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    DISMISSED = "dismissed", "Dismissed"
    UPHELD = "upheld", "Upheld"


class ConversationReportDecision(models.TextChoices):
    DISMISSED = ConversationReportStatus.DISMISSED, "Dismissed"
    UPHELD = ConversationReportStatus.UPHELD, "Upheld"


class ConversationReportTarget(models.TextChoices):
    INQUIRY = "inquiry", "Inquiry"
    MESSAGE = "message", "Message"


class ConversationEvidenceRetentionStatus(models.TextChoices):
    INVESTIGATION = "investigation", "Investigation"
    REQUIRED = "required", "Required"
    RELEASED = "released", "Released"


class ConversationReport(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    inquiry = models.ForeignKey(
        ListingInquiry,
        on_delete=models.PROTECT,
        related_name="reports",
        null=True,
        blank=True,
    )
    target_message = models.ForeignKey(
        ListingInquiryMessage,
        on_delete=models.PROTECT,
        related_name="reports",
        null=True,
        blank=True,
    )
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="conversation_reports",
        null=True,
        blank=True,
    )
    reporter_display_name_snapshot = models.CharField(max_length=120)
    target_kind = models.CharField(max_length=16, choices=ConversationReportTarget.choices)
    explanation = models.TextField(max_length=2000, blank=True)
    evidence = models.JSONField(null=True, blank=True)
    evidence_retention_status = models.CharField(
        max_length=16,
        choices=ConversationEvidenceRetentionStatus.choices,
        default=ConversationEvidenceRetentionStatus.INVESTIGATION,
    )
    evidence_released_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(
        max_length=16,
        choices=ConversationReportStatus.choices,
        default=ConversationReportStatus.PENDING,
    )
    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="decided_conversation_reports",
        null=True,
        blank=True,
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    internal_note = models.TextField(max_length=2000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "-id")
        permissions = [
            ("moderate_conversation_reports", "Can moderate Conversation Reports"),
        ]

    def __str__(self) -> str:
        return f"{self.inquiry_id}: {self.status}"


class ConversationReportEvidenceHold(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(
        ConversationReport,
        on_delete=models.CASCADE,
        related_name="evidence_holds",
    )
    message = models.ForeignKey(
        ListingInquiryMessage,
        on_delete=models.PROTECT,
        related_name="conversation_report_evidence_holds",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("report", "message"),
                name="one_evidence_hold_per_report_message",
            )
        ]

    def __str__(self) -> str:
        return f"{self.report_id}: {self.message_id}"


class ConversationModerationEventType(models.TextChoices):
    INSPECTED = "inspected", "Inspected"
    DISMISSED = "dismissed", "Dismissed"
    UPHELD = "upheld", "Upheld"
    PAIR_RESTRICTED = "pair_restricted", "Pair restricted"
    INITIATION_SUSPENDED = "initiation_suspended", "Initiation suspended"
    EVIDENCE_RELEASED = "evidence_released", "Evidence released"


class ConversationModerationEventQuerySet(models.QuerySet["ConversationModerationEvent"]):
    def update(self, **kwargs: Any) -> int:
        raise ValidationError("Conversation moderation history is append-only.")

    def delete(self) -> tuple[int, dict[str, int]]:
        raise ValidationError("Conversation moderation history is append-only.")

    def bulk_update(
        self,
        objs: Iterable[ConversationModerationEvent],
        fields: Iterable[str],
        batch_size: int | None = None,
    ) -> int:
        raise ValidationError("Conversation moderation history is append-only.")


class ConversationModerationEventManager(models.Manager["ConversationModerationEvent"]):
    def get_queryset(self) -> ConversationModerationEventQuerySet:
        return ConversationModerationEventQuerySet(self.model, using=self._db)


class ConversationModerationEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(
        ConversationReport,
        on_delete=models.PROTECT,
        related_name="moderation_events",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="conversation_moderation_events",
    )
    event_type = models.CharField(
        max_length=24,
        choices=ConversationModerationEventType.choices,
    )
    internal_note = models.TextField(max_length=2000, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    objects: ClassVar[ConversationModerationEventManager] = ConversationModerationEventManager()

    class Meta:
        ordering = ("created_at", "id")

    def __str__(self) -> str:
        return f"{self.report_id}: {self.event_type}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        if not self._state.adding:
            raise ValidationError("Conversation moderation history is append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        raise ValidationError("Conversation moderation history is append-only.")


class AccountBlock(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    lower_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="account_blocks_as_lower",
    )
    higher_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="account_blocks_as_higher",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="created_account_blocks",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("lower_account", "higher_account"),
                name="one_account_block_per_pair",
            ),
            models.CheckConstraint(
                condition=~models.Q(lower_account=models.F("higher_account")),
                name="account_block_accounts_differ",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(created_by=models.F("lower_account"))
                    | models.Q(created_by=models.F("higher_account"))
                ),
                name="account_block_created_by_participant",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.lower_account_id} — {self.higher_account_id}"


class ModeratedPairRestriction(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    lower_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="moderated_restrictions_as_lower",
    )
    higher_account = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="moderated_restrictions_as_higher",
    )
    report = models.OneToOneField(
        ConversationReport,
        on_delete=models.PROTECT,
        related_name="pair_restriction",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_moderated_pair_restrictions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=("lower_account", "higher_account"),
                name="one_moderated_restriction_per_pair",
            ),
            models.CheckConstraint(
                condition=~models.Q(lower_account=models.F("higher_account")),
                name="moderated_restriction_accounts_differ",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.lower_account_id} — {self.higher_account_id}"


class InquiryInitiationSuspension(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="inquiry_initiation_suspension",
    )
    report = models.ForeignKey(
        ConversationReport,
        on_delete=models.PROTECT,
        related_name="initiation_suspensions",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_inquiry_initiation_suspensions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"Suspended {self.account_id}"


class ImmutableSystemNotificationQuerySet(models.QuerySet["SystemNotification"]):
    def update(self, **kwargs: Any) -> int:
        raise ValidationError("System Notification history is immutable.")

    def delete(self) -> tuple[int, dict[str, int]]:
        raise ValidationError("System Notification history is immutable.")

    def bulk_update(
        self,
        objs: Iterable[SystemNotification],
        fields: Iterable[str],
        batch_size: int | None = None,
    ) -> int:
        raise ValidationError("System Notification history is immutable.")

    def bulk_create(
        self,
        objs: Iterable[SystemNotification],
        batch_size: int | None = None,
        ignore_conflicts: bool = False,
        update_conflicts: bool = False,
        update_fields: Collection[str] | None = None,
        unique_fields: Collection[str] | None = None,
    ) -> list[SystemNotification]:
        if update_conflicts:
            raise ValidationError("System Notification history is immutable.")
        return super().bulk_create(
            objs,
            batch_size=batch_size,
            ignore_conflicts=ignore_conflicts,
            update_conflicts=update_conflicts,
            update_fields=update_fields,
            unique_fields=unique_fields,
        )


class SystemNotificationManager(models.Manager["SystemNotification"]):
    def get_queryset(self) -> ImmutableSystemNotificationQuerySet:
        return ImmutableSystemNotificationQuerySet(self.model, using=self._db)


class SystemNotification(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="system_notifications",
    )
    originating_event = models.ForeignKey(
        "submissions.SubmissionEvent",
        on_delete=models.PROTECT,
        related_name="system_notifications",
        null=True,
        blank=True,
    )
    originating_source_proposal_event = models.ForeignKey(
        "source_proposals.SourceProposalEvent",
        on_delete=models.PROTECT,
        related_name="system_notifications",
        null=True,
        blank=True,
    )
    originating_run_decision = models.ForeignKey(
        "source_proposals.ExtractionRunDecision",
        on_delete=models.PROTECT,
        null=True,
        related_name="system_notifications",
    )
    originating_candidate_event = models.ForeignKey(
        "source_proposals.ExternalListingCandidateEvent",
        on_delete=models.PROTECT,
        null=True,
        related_name="system_notifications",
    )
    target_submission = models.ForeignKey(
        "submissions.Submission",
        on_delete=models.SET_NULL,
        related_name="system_notifications",
        null=True,
        blank=True,
    )
    target_source_proposal = models.ForeignKey(
        "source_proposals.SourceProposal",
        on_delete=models.SET_NULL,
        related_name="system_notifications",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    objects: ClassVar[SystemNotificationManager] = SystemNotificationManager()

    class Meta:
        ordering = ("-created_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=("recipient", "originating_event"),
                name="one_system_notification_per_recipient_event",
            ),
            models.UniqueConstraint(
                fields=("recipient", "originating_source_proposal_event"),
                name="one_system_notification_per_recipient_source_proposal_event",
            ),
            models.UniqueConstraint(
                fields=("recipient", "originating_run_decision"),
                name="one_notification_per_run_decision",
            ),
            models.UniqueConstraint(
                fields=("recipient", "originating_candidate_event"),
                name="one_notification_per_candidate_event",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(
                        originating_event__isnull=False,
                        originating_source_proposal_event__isnull=True,
                        originating_run_decision__isnull=True,
                        originating_candidate_event__isnull=True,
                    )
                    | models.Q(
                        originating_event__isnull=True,
                        originating_source_proposal_event__isnull=False,
                        originating_run_decision__isnull=True,
                        originating_candidate_event__isnull=True,
                    )
                    | models.Q(
                        originating_event__isnull=True,
                        originating_source_proposal_event__isnull=True,
                        originating_run_decision__isnull=False,
                        originating_candidate_event__isnull=True,
                    )
                    | models.Q(
                        originating_event__isnull=True,
                        originating_source_proposal_event__isnull=True,
                        originating_run_decision__isnull=True,
                        originating_candidate_event__isnull=False,
                    )
                ),
                name="system_notification_has_exactly_one_originating_event",
            ),
        ]

    def __str__(self) -> str:
        event_id = self.originating_event_id or self.originating_source_proposal_event_id
        return f"{self.recipient_id}: {event_id}"

    def save(self, *args: Any, **kwargs: Any) -> None:
        if not self._state.adding:
            raise ValidationError("System Notification history is immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args: Any, **kwargs: Any) -> tuple[int, dict[str, int]]:
        raise ValidationError("System Notification history is immutable.")


class SystemNotificationReadState(models.Model):
    notification = models.OneToOneField(
        SystemNotification,
        on_delete=models.CASCADE,
        related_name="read_state",
        primary_key=True,
    )
    read_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"Read {self.notification_id}"

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
            models.CheckConstraint(
                condition=(
                    models.Q(
                        originating_event__isnull=False,
                        originating_source_proposal_event__isnull=True,
                    )
                    | models.Q(
                        originating_event__isnull=True,
                        originating_source_proposal_event__isnull=False,
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

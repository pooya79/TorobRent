from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, ClassVar

from django.contrib.auth.models import AbstractUser
from django.db import models

from .managers import UserManager

if TYPE_CHECKING:
    from .capabilities import OperatorCapability


class SubmitterOnboardingPath(models.TextChoices):
    SUBMISSION = "submission", "Submission"
    SOURCE_PROPOSAL = "source_proposal", "Source Proposal"


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = None  # type: ignore[assignment]
    email = models.EmailField(unique=True, null=True, blank=True)  # type: ignore[assignment]
    email_verified_at = models.DateTimeField(null=True, blank=True)
    phone = models.CharField(max_length=11, unique=True, null=True, blank=True)
    phone_verified_at = models.DateTimeField(null=True, blank=True)
    is_submitter = models.BooleanField(default=False, db_default=False)
    submitter_onboarding_path = models.CharField(
        max_length=16,
        choices=SubmitterOnboardingPath.choices,
        null=True,
        blank=True,
    )
    anonymized_at = models.DateTimeField(null=True, blank=True, editable=False)

    USERNAME_FIELD: ClassVar[str] = "email"  # type: ignore[misc]
    REQUIRED_FIELDS: ClassVar[list[str]] = []

    objects: ClassVar[UserManager] = UserManager()  # type: ignore[assignment]

    def __str__(self) -> str:
        return self.email or self.phone or str(self.id)

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None

    @property
    def phone_verified(self) -> bool:
        return self.phone_verified_at is not None

    @property
    def operator_capabilities(self) -> list[OperatorCapability]:
        from .capabilities import capabilities_for

        return capabilities_for(self)

    @property
    def historical_actor_reference(self) -> uuid.UUID:
        return self.id

    @property
    def historical_actor_label(self) -> str:
        return "Former Operator" if self.anonymized_at is not None else str(self)

    @property
    def historical_actor_email(self) -> str | None:
        return None if self.anonymized_at is not None else self.email

    class Meta:
        permissions = (
            ("handle_privacy_support_requests", "Can handle privacy Support Requests"),
            ("handle_general_support_requests", "Can handle general Support Requests"),
            ("manage_operator_queue", "Can manage Operator queues"),
        )


class OperatorAccess(User):
    class Meta:
        proxy = True
        default_permissions = ()
        verbose_name = "Operator access"
        verbose_name_plural = "Operator access"


class PhoneVerificationChallenge(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="phone_challenges")
    phone = models.CharField(max_length=11, db_index=True)
    secret_hash = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    consumed_at = models.DateTimeField(null=True, blank=True)
    grants_submitter_eligibility = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=("phone", "-created_at"))]

    def __str__(self) -> str:
        return f"Phone verification challenge {self.id}"

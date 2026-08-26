from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, ClassVar

from django.contrib.auth.models import AbstractUser
from django.db import models

from .managers import UserManager

if TYPE_CHECKING:
    from .capabilities import OperatorCapability


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = None  # type: ignore[assignment]
    email = models.EmailField(unique=True)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    is_submitter = models.BooleanField(default=False, db_default=False)
    anonymized_at = models.DateTimeField(null=True, blank=True, editable=False)

    USERNAME_FIELD: ClassVar[str] = "email"  # type: ignore[misc]
    REQUIRED_FIELDS: ClassVar[list[str]] = []

    objects: ClassVar[UserManager] = UserManager()  # type: ignore[assignment]

    def __str__(self) -> str:
        return self.email

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None

    @property
    def operator_capabilities(self) -> list[OperatorCapability]:
        from .capabilities import capabilities_for

        return capabilities_for(self)

    @property
    def historical_actor_reference(self) -> uuid.UUID:
        return self.id

    @property
    def historical_actor_label(self) -> str:
        return "Former Operator" if self.anonymized_at is not None else self.email

    @property
    def historical_actor_email(self) -> str | None:
        return None if self.anonymized_at is not None else self.email

    class Meta:
        permissions = (
            ("handle_privacy_support_requests", "Can handle privacy Support Requests"),
            ("handle_general_support_requests", "Can handle general Support Requests"),
            ("manage_operator_queue", "Can manage Operator queues"),
        )

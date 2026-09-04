from typing import Any

from django.db import models
from django.db.models.signals import post_delete, pre_delete
from django.dispatch import receiver

from apps.accounts.models import User

from .models import ListingInquiry
from .services import cleanup_listing_inquiry


@receiver(pre_delete, sender=User)
def lock_listing_inquiries_for_account_deletion(
    sender: type[User], instance: User, using: str, **kwargs: Any
) -> None:
    del sender, kwargs
    inquiry_ids = list(
        ListingInquiry.objects
        .using(using)
        .select_for_update()
        .filter(models.Q(renter_id=instance.id) | models.Q(submitter_id=instance.id))
        .values_list("id", flat=True)
    )
    instance._listing_inquiry_cleanup_ids = inquiry_ids  # type: ignore[attr-defined]


@receiver(post_delete, sender=User)
def clean_listing_inquiries_after_account_deletion(
    sender: type[User], instance: User, using: str, **kwargs: Any
) -> None:
    del sender, kwargs
    for inquiry_id in getattr(instance, "_listing_inquiry_cleanup_ids", ()):
        cleanup_listing_inquiry(inquiry_id=inquiry_id, using=using)

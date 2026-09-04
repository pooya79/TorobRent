from typing import Any

from django.db import models


def set_null_in_immutable_history(
    collector: Any, field: models.Field[Any, Any], sub_objects: models.QuerySet[Any], using: str
) -> None:
    plain_queryset: models.QuerySet[Any] = models.QuerySet(model=field.model, using=using).filter(
        pk__in=sub_objects.values("pk")
    )
    collector.add_field_update(field, None, plain_queryset)

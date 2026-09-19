from django.contrib.auth.models import Group, Permission
from django.db import transaction

from .capabilities import MANAGED_OPERATOR_GROUP_PERMISSIONS


@transaction.atomic
def ensure_managed_operator_groups() -> None:
    for group_name, permission_labels in MANAGED_OPERATOR_GROUP_PERMISSIONS.items():
        permissions = []
        for label in permission_labels:
            app_label, codename = label.split(".", maxsplit=1)
            permissions.append(
                Permission.objects.get(
                    content_type__app_label=app_label,
                    codename=codename,
                )
            )
        group, _ = Group.objects.get_or_create(name=group_name)
        group.permissions.set(permissions)

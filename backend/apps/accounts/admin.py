from typing import Any, cast

from django import forms
from django.contrib import admin
from django.contrib.auth.admin import GroupAdmin as DjangoGroupAdmin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.contrib.auth.forms import UserChangeForm
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.http import HttpRequest

from .models import User
from .services import (
    anonymize_operator_account,
    can_delete_operator_group,
    validate_operator_access_change,
    validate_operator_group_change,
)


class OperatorAwareUserChangeForm(UserChangeForm):  # type: ignore[type-arg]
    provisioning_actor: User | None = None

    class Meta(UserChangeForm.Meta):
        model = User

    def clean(self) -> dict[str, Any]:
        cleaned_data = super().clean() or {}
        selected_groups = cleaned_data.get("groups")
        selected_permissions = cleaned_data.get("user_permissions")
        groups = selected_groups if selected_groups is not None else self.instance.groups.all()
        permissions = (
            selected_permissions
            if selected_permissions is not None
            else self.instance.user_permissions.all()
        )
        if self.provisioning_actor is not None:
            validate_operator_access_change(
                actor=self.provisioning_actor,
                target=self.instance,
                is_active=cleaned_data.get("is_active", self.instance.is_active),
                groups=groups,
                permissions=permissions,
            )
        return cleaned_data


class OperatorAwareGroupChangeForm(forms.ModelForm):  # type: ignore[type-arg]
    provisioning_actor: User | None = None

    class Meta:
        model = Group
        fields = ("name", "permissions")

    def clean(self) -> dict[str, Any]:
        cleaned_data = super().clean() or {}
        permissions = cleaned_data.get("permissions")
        if permissions is None:
            permissions = self.instance.permissions.all()
        if self.provisioning_actor is not None:
            validate_operator_group_change(
                actor=self.provisioning_actor,
                group=self.instance,
                permissions=permissions,
                changed_fields=set(self.changed_data),
            )
        return cleaned_data


@admin.register(User)
class UserAdmin(DjangoUserAdmin):  # type: ignore[type-arg]
    form = OperatorAwareUserChangeForm
    ordering = ("email",)
    list_display = (
        "email",
        "phone",
        "email_verified_at",
        "phone_verified_at",
        "anonymized_at",
        "is_staff",
        "is_active",
    )
    search_fields = ("email", "phone")
    readonly_fields = (
        "email_verified_at",
        "phone_verified_at",
        "anonymized_at",
        "last_login",
        "date_joined",
    )
    actions = ("anonymize_selected_accounts",)
    fieldsets = (
        (None, {"fields": ("email", "phone", "password")}),
        ("Personal info", {"fields": ("first_name", "last_name")}),
        (
            "Permissions",
            {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")},
        ),
        (
            "Important dates",
            {
                "fields": (
                    "email_verified_at",
                    "phone_verified_at",
                    "anonymized_at",
                    "last_login",
                    "date_joined",
                )
            },
        ),
    )
    add_fieldsets = (
        (
            None,
            {
                "classes": ("wide",),
                "fields": ("email", "password1", "password2", "is_staff", "is_active"),
            },
        ),
    )

    def get_form(
        self,
        request: HttpRequest,
        obj: User | None = None,
        change: bool = False,
        **kwargs: Any,
    ) -> type[forms.ModelForm[Any]]:
        base_form = super().get_form(request, obj, change=change, **kwargs)
        return type(
            "ProvisioningUserChangeForm",
            (base_form,),
            {"provisioning_actor": cast(User, request.user)},
        )

    def get_readonly_fields(self, request: HttpRequest, obj: User | None = None) -> tuple[str, ...]:
        fields = tuple(super().get_readonly_fields(request, obj))
        return fields if request.user.is_superuser else fields + ("is_superuser",)

    @admin.action(description="Anonymize selected former Operator accounts")
    def anonymize_selected_accounts(
        self,
        request: HttpRequest,
        queryset: Any,
    ) -> None:
        actor = cast(User, request.user)
        if not actor.is_superuser:
            self.message_user(request, "Only superusers may anonymize accounts.", level="error")
            return
        anonymized = 0
        skipped = 0
        for target in queryset:
            if target.is_superuser or target.id == actor.id:
                skipped += 1
                continue
            try:
                anonymize_operator_account(target=target, actor=actor)
            except ValidationError:
                skipped += 1
                continue
            anonymized += 1
        self.message_user(
            request,
            f"Anonymized {anonymized} former Operator account(s); skipped {skipped}.",
        )


admin.site.unregister(Group)


@admin.register(Group)
class GroupAdmin(DjangoGroupAdmin):
    form = OperatorAwareGroupChangeForm

    def get_form(
        self,
        request: HttpRequest,
        obj: Group | None = None,
        change: bool = False,
        **kwargs: Any,
    ) -> type[forms.ModelForm[Any]]:
        base_form = super().get_form(request, obj, change=change, **kwargs)
        return type(
            "ProvisioningGroupChangeForm",
            (base_form,),
            {"provisioning_actor": cast(User, request.user)},
        )

    def has_delete_permission(self, request: HttpRequest, obj: Group | None = None) -> bool:
        allowed_by_admin = super().has_delete_permission(request, obj)
        if not allowed_by_admin or obj is None:
            return allowed_by_admin
        return can_delete_operator_group(actor=cast(User, request.user), group=obj)

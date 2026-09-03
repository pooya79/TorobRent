from typing import Any, cast

from django import forms
from django.contrib import admin
from django.contrib.auth.admin import GroupAdmin as DjangoGroupAdmin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.contrib.auth.forms import UserChangeForm as DjangoUserChangeForm
from django.contrib.auth.models import Group
from django.core.exceptions import ValidationError
from django.db.models import QuerySet
from django.http import HttpRequest
from django.urls import reverse
from django.utils.html import format_html
from unfold.admin import ModelAdmin
from unfold.decorators import display
from unfold.forms import AdminPasswordChangeForm, UserCreationForm
from unfold.forms import UserChangeForm as UnfoldUserChangeForm
from unfold.widgets import UnfoldAdminCheckboxSelectMultipleWidget

from .capabilities import (
    CAPABILITY_PERMISSIONS,
    MANAGED_OPERATOR_GROUPS,
    OperatorCapability,
)
from .models import OperatorAccess, User
from .services import (
    anonymize_operator_account,
    can_delete_operator_group,
    update_operator_access,
    validate_operator_access_change,
    validate_operator_group_change,
)


class OperatorAwareUserChangeForm(UnfoldUserChangeForm):
    provisioning_actor: User | None = None

    class Meta(DjangoUserChangeForm.Meta):
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


class OperatorAccessForm(forms.ModelForm):  # type: ignore[type-arg]
    provisioning_actor: User | None = None
    operator_roles = forms.ModelMultipleChoiceField(
        label="Operator roles",
        help_text=(
            "Roles are reusable capability bundles. Platform administration access is controlled "
            "separately below."
        ),
        queryset=Group.objects.filter(name__in=MANAGED_OPERATOR_GROUPS).order_by("name"),
        required=False,
        widget=UnfoldAdminCheckboxSelectMultipleWidget,
    )

    class Meta:
        model = OperatorAccess
        fields = ("is_active", "is_staff")

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        if self.instance.pk:
            self.fields["operator_roles"].initial = self.instance.groups.filter(
                name__in=MANAGED_OPERATOR_GROUPS
            )

    def clean(self) -> dict[str, Any]:
        cleaned_data = super().clean() or {}
        selected_roles = cleaned_data.get("operator_roles")
        if selected_roles is None or self.provisioning_actor is None:
            return cleaned_data
        ordinary_groups = self.instance.groups.exclude(name__in=MANAGED_OPERATOR_GROUPS)
        validate_operator_access_change(
            actor=self.provisioning_actor,
            target=self.instance,
            is_active=cleaned_data.get("is_active", self.instance.is_active),
            groups=(*ordinary_groups, *selected_roles),
            permissions=self.instance.user_permissions.select_related("content_type"),
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
class UserAdmin(DjangoUserAdmin, ModelAdmin):  # type: ignore[type-arg]
    form = OperatorAwareUserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm
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
    list_filter = (
        "is_active",
        "is_staff",
        "is_superuser",
        ("email_verified_at", admin.EmptyFieldListFilter),
    )
    filter_horizontal = ("groups", "user_permissions")
    list_per_page = 50
    warn_unsaved_form = True
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


@admin.register(OperatorAccess)
class OperatorAccessAdmin(ModelAdmin):  # type: ignore[type-arg]
    form = OperatorAccessForm
    ordering = ("email",)
    list_display = (
        "account_identity",
        "access_status",
        "operator_roles_display",
        "effective_capabilities_display",
        "is_staff",
    )
    list_filter = (
        "is_active",
        "is_staff",
        ("email_verified_at", admin.EmptyFieldListFilter),
        "groups",
    )
    search_fields = ("email", "phone", "first_name", "last_name")
    list_per_page = 50
    warn_unsaved_form = True
    fieldsets = (
        (
            "Account readiness",
            {
                "fields": (
                    "id",
                    "email",
                    "phone",
                    "email_verified_at",
                    "is_active",
                )
            },
        ),
        (
            "Operational access",
            {
                "fields": (
                    "operator_roles",
                    "effective_capabilities",
                    "direct_capabilities",
                ),
                "description": (
                    "Choose role bundles for routine work. Effective capabilities include both "
                    "roles and any direct permission overrides."
                ),
            },
        ),
        (
            "Platform administration",
            {
                "fields": ("is_staff", "is_superuser", "advanced_account_permissions"),
                "description": (
                    "Django admin admission is independent from Operator Workspace access."
                ),
            },
        ),
    )
    readonly_fields = (
        "id",
        "email",
        "phone",
        "email_verified_at",
        "is_superuser",
        "effective_capabilities",
        "direct_capabilities",
        "advanced_account_permissions",
    )

    def get_queryset(self, request: HttpRequest) -> Any:
        return (
            super()
            .get_queryset(request)
            .prefetch_related("groups__permissions__content_type", "user_permissions__content_type")
        )

    def get_form(
        self,
        request: HttpRequest,
        obj: OperatorAccess | None = None,
        change: bool = False,
        **kwargs: Any,
    ) -> type[forms.ModelForm[Any]]:
        base_form = super().get_form(request, obj, change=change, **kwargs)
        return type(
            "ProvisioningOperatorAccessForm",
            (base_form,),
            {"provisioning_actor": cast(User, request.user)},
        )

    def save_model(
        self,
        request: HttpRequest,
        obj: OperatorAccess,
        form: forms.ModelForm[OperatorAccess],
        change: bool,
    ) -> None:
        selected_roles = cast(QuerySet[Group], form.cleaned_data["operator_roles"])
        updated = update_operator_access(
            target=obj,
            actor=cast(User, request.user),
            is_active=form.cleaned_data["is_active"],
            is_staff=form.cleaned_data["is_staff"],
            roles=selected_roles,
        )
        obj.is_active = updated.is_active
        obj.is_staff = updated.is_staff

    @admin.display(description="Account", ordering="email")
    def account_identity(self, obj: OperatorAccess) -> str:
        return obj.email or obj.phone or str(obj.id)

    @display(
        description="Status",
        label={
            "operator": "success",
            "no_access": "info",
            "unverified": "warning",
            "inactive": "danger",
        },
    )
    def access_status(self, obj: OperatorAccess) -> tuple[str, str]:
        if not obj.is_active:
            return ("inactive", "Inactive")
        if not obj.email_verified:
            return ("unverified", "Email unverified")
        if obj.operator_capabilities:
            return ("operator", "Operator")
        return ("no_access", "No operator access")

    @admin.display(description="Roles")
    def operator_roles_display(self, obj: OperatorAccess) -> str:
        roles = sorted(
            group.name for group in obj.groups.all() if group.name in MANAGED_OPERATOR_GROUPS
        )
        return ", ".join(roles) or "—"

    @admin.display(description="Capabilities")
    def effective_capabilities_display(self, obj: OperatorAccess) -> str:
        return self._capability_labels(obj) or "—"

    @admin.display(description="Effective capabilities")
    def effective_capabilities(self, obj: OperatorAccess) -> str:
        return self._capability_labels(obj) or "None"

    @admin.display(description="Direct capability overrides")
    def direct_capabilities(self, obj: OperatorAccess) -> str:
        permission_names = {
            f"{permission.content_type.app_label}.{permission.codename}"
            for permission in obj.user_permissions.all()
        }
        capabilities = [
            capability.label
            for capability, permission_name in CAPABILITY_PERMISSIONS.items()
            if permission_name in permission_names
        ]
        return ", ".join(capabilities) or "None"

    @admin.display(description="Advanced permissions")
    def advanced_account_permissions(self, obj: OperatorAccess) -> str:
        url = reverse("admin:accounts_user_change", args=(obj.pk,))
        return format_html('<a href="{}">Open the full account permission form</a>', url)

    def _capability_labels(self, obj: OperatorAccess) -> str:
        return ", ".join(
            OperatorCapability(capability).label for capability in obj.operator_capabilities
        )

    @staticmethod
    def _can_manage_operator_access(request: HttpRequest) -> bool:
        return bool(request.user.is_active and request.user.is_superuser)

    def has_module_permission(self, request: HttpRequest) -> bool:
        return self._can_manage_operator_access(request)

    def has_view_permission(self, request: HttpRequest, obj: OperatorAccess | None = None) -> bool:
        return self._can_manage_operator_access(request)

    def has_change_permission(
        self, request: HttpRequest, obj: OperatorAccess | None = None
    ) -> bool:
        return self._can_manage_operator_access(request)

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_delete_permission(
        self, request: HttpRequest, obj: OperatorAccess | None = None
    ) -> bool:
        return False


admin.site.unregister(Group)


@admin.register(Group)
class GroupAdmin(DjangoGroupAdmin, ModelAdmin):  # type: ignore[type-arg]
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

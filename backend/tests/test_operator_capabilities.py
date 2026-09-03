import pytest
from django.contrib import admin
from django.contrib.auth.models import Group, Permission
from django.core.exceptions import ValidationError
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import OperatorAccess, User
from apps.accounts.services import anonymize_operator_account, update_operator_access
from apps.contact.models import IntakeKind, SupportRequest, SupportRequestEvent
from apps.contact.serializers import SupportRequestEventSerializer


@pytest.mark.django_db
def test_current_account_exposes_domain_capabilities_without_permission_codenames(
    api_client: APIClient,
):
    operator = User.objects.create_user(
        email="operator@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    operator.user_permissions.add(
        Permission.objects.get(
            content_type__app_label="submissions",
            codename="review_submission",
        ),
        Permission.objects.get(
            content_type__app_label="accounts",
            codename="manage_operator_queue",
        ),
    )
    api_client.force_authenticate(operator)

    response = api_client.get("/api/v1/users/me/")

    assert response.status_code == 200
    assert response.data["operator_capabilities"] == [
        "manage_operator_queues",
        "review_submissions",
    ]
    assert "review_submission" not in response.data["operator_capabilities"]
    assert "manage_operator_queue" not in response.data["operator_capabilities"]


@pytest.mark.django_db
def test_account_anonymization_preserves_an_opaque_former_operator_history_reference():
    administrator = User.objects.create_superuser(
        email="administrator@example.com", password="password"
    )
    operator = User.objects.create_user(
        email="former.operator@example.com",
        password="password",
        first_name="Former",
        last_name="Operator",
        email_verified_at=timezone.now(),
    )
    operator.user_permissions.add(
        Permission.objects.get(codename="handle_general_support_requests")
    )
    support_request = SupportRequest.objects.create(
        name="Requester",
        email="requester@example.com",
        intake_kind=IntakeKind.GENERAL,
        message="Please preserve the operational event.",
    )
    event = SupportRequestEvent.objects.create(
        support_request=support_request,
        actor=operator,
        event_type="classified",
        prior_state="open",
        new_state="open",
        classification="guidance",
    )
    actor_reference = str(operator.id)

    anonymize_operator_account(target=operator, actor=administrator)

    operator.refresh_from_db()
    serialized = SupportRequestEventSerializer(event).data
    assert operator.anonymized_at is not None
    assert operator.first_name == operator.last_name == ""
    assert "former.operator@example.com" not in operator.email
    assert not operator.is_active
    assert not operator.email_verified
    assert not operator.has_usable_password()
    assert not operator.groups.exists()
    assert not operator.user_permissions.exists()
    assert serialized["actor_reference"] == actor_reference
    assert serialized["actor_label"] == "Former Operator"
    assert serialized["actor_email"] is None


@pytest.mark.django_db
def test_operator_anonymization_rejects_an_account_that_never_had_an_operator_grant():
    administrator = User.objects.create_superuser(
        email="administrator@example.com", password="password"
    )
    submitter = User.objects.create_user(
        email="submitter@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )

    with pytest.raises(ValidationError, match="Operator grant"):
        anonymize_operator_account(target=submitter, actor=administrator)

    submitter.refresh_from_db()
    assert submitter.anonymized_at is None
    assert submitter.email == "submitter@example.com"


@pytest.mark.django_db
def test_managed_operator_groups_are_independent_reusable_capability_bundles():
    expected_bundles = {
        "Conversation Moderator": {"communications.moderate_conversation_reports"},
        "Source Proposal Reviewer": {"source_proposals.review_source_proposal"},
        "Submission Reviewer": {"submissions.review_submission"},
        "Submission Review Lead": {
            "accounts.manage_operator_queue",
            "submissions.review_submission",
        },
        "Support Operator": {"accounts.handle_general_support_requests"},
        "Support Lead": {
            "accounts.manage_operator_queue",
            "accounts.handle_general_support_requests",
        },
        "Privacy Operator": {
            "accounts.handle_privacy_support_requests",
            "accounts.handle_general_support_requests",
        },
        "Privacy Lead": {
            "accounts.manage_operator_queue",
            "accounts.handle_privacy_support_requests",
            "accounts.handle_general_support_requests",
        },
        "Operator Queue Manager": {"accounts.manage_operator_queue"},
    }

    for group_name, expected_permissions in expected_bundles.items():
        group = Group.objects.get(name=group_name)
        actual_permissions = {
            f"{permission.content_type.app_label}.{permission.codename}"
            for permission in group.permissions.select_related("content_type")
        }
        assert actual_permissions == expected_permissions

    operator_permissions = Permission.objects.filter(
        codename__in=(
            "review_submission",
            "handle_general_support_requests",
            "handle_privacy_support_requests",
            "manage_operator_queue",
            "moderate_conversation_reports",
            "review_source_proposal",
        )
    )
    assert operator_permissions.count() == 6
    assert not Permission.objects.filter(
        codename__in=("catalog_stewardship", "link_verification")
    ).exists()


@pytest.mark.django_db
def test_superuser_manages_operator_roles_through_the_dedicated_admin(client):
    administrator = User.objects.create_superuser(
        email="administrator@example.com", password="password"
    )
    account = User.objects.create_user(
        email="new-operator@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )
    ordinary_group = Group.objects.create(name="Content Editors")
    account.groups.add(ordinary_group)
    reviewer = Group.objects.get(name="Submission Reviewer")
    support_lead = Group.objects.get(name="Support Lead")
    client.force_login(administrator)
    url = reverse("admin:accounts_operatoraccess_change", args=(account.pk,))

    form_page = client.get(url)
    changed = client.post(
        url,
        {
            "is_active": "on",
            "operator_roles": [reviewer.pk, support_lead.pk],
            "_save": "Save",
        },
    )

    account.refresh_from_db()
    assert form_page.status_code == 200
    assert b"Operator roles" in form_page.content
    assert changed.status_code == 302
    assert set(account.groups.values_list("name", flat=True)) == {
        "Content Editors",
        "Submission Reviewer",
        "Support Lead",
    }
    assert set(account.operator_capabilities) == {
        "handle_support",
        "manage_operator_queues",
        "review_submissions",
    }
    assert account.is_staff is False

    removed_role = client.post(
        url,
        {
            "is_active": "on",
            "operator_roles": [support_lead.pk],
            "_save": "Save",
        },
    )

    account.refresh_from_db()
    assert removed_role.status_code == 302
    assert set(account.groups.values_list("name", flat=True)) == {
        "Content Editors",
        "Support Lead",
    }


@pytest.mark.django_db
def test_operator_access_admin_rejects_unready_accounts_and_non_superusers(client):
    administrator = User.objects.create_superuser(
        email="administrator@example.com", password="password"
    )
    unverified = User.objects.create_user(
        email="unverified-operator@example.com", password="password"
    )
    reviewer = Group.objects.get(name="Submission Reviewer")
    url = reverse("admin:accounts_operatoraccess_change", args=(unverified.pk,))
    client.force_login(administrator)

    rejected = client.post(
        url,
        {
            "is_active": "on",
            "operator_roles": [reviewer.pk],
            "_save": "Save",
        },
    )

    unverified.refresh_from_db()
    assert rejected.status_code == 200
    assert not unverified.groups.filter(pk=reviewer.pk).exists()

    staff = User.objects.create_user(
        email="ordinary-staff@example.com",
        password="password",
        is_staff=True,
        email_verified_at=timezone.now(),
    )
    client.force_login(staff)
    assert client.get(url).status_code == 403


@pytest.mark.django_db
def test_operator_access_service_rejects_admin_admission_by_non_superuser():
    staff = User.objects.create_user(
        email="staff@example.com",
        password="password",
        is_staff=True,
        email_verified_at=timezone.now(),
    )
    target = User.objects.create_user(
        email="target@example.com",
        password="password",
        email_verified_at=timezone.now(),
    )

    with pytest.raises(ValidationError, match="Only active superusers"):
        update_operator_access(
            target=target,
            actor=staff,
            is_active=True,
            is_staff=True,
            roles=(),
        )

    target.refresh_from_db()
    assert target.is_staff is False


def test_all_project_admin_models_use_the_unfold_interface():
    from unfold.admin import ModelAdmin

    assert admin.site.is_registered(OperatorAccess)
    assert all(
        isinstance(model_admin, ModelAdmin)
        for model_admin in admin.site._registry.values()  # noqa: SLF001
    )


@pytest.mark.django_db
def test_superuser_can_promote_only_an_active_verified_account_without_admin_admission(client):
    superuser = User.objects.create_superuser(email="root@example.com", password="password")
    reviewer_group = Group.objects.get(name="Submission Reviewer")
    verified = User.objects.create_user(
        email="verified@example.com",
        password="password",
        email_verified_at=superuser.date_joined,
    )
    unverified = User.objects.create_user(email="unverified@example.com", password="password")
    inactive = User.objects.create_user(
        email="inactive@example.com",
        password="password",
        email_verified_at=superuser.date_joined,
        is_active=False,
    )
    client.force_login(superuser)

    def promote(target: User):
        return client.post(
            reverse("admin:accounts_user_change", args=(target.pk,)),
            {
                "email": target.email,
                "first_name": "",
                "last_name": "",
                "is_active": target.is_active,
                "is_staff": False,
                "is_superuser": False,
                "date_joined": target.date_joined.isoformat(),
                "groups": [reviewer_group.pk],
                "user_permissions": [],
                "_save": "Save",
            },
        )

    promoted = promote(verified)
    rejected_unverified = promote(unverified)
    rejected_inactive = promote(inactive)

    verified.refresh_from_db()
    unverified.refresh_from_db()
    inactive.refresh_from_db()
    assert promoted.status_code == 302, promoted.context["adminform"].form.errors
    assert verified.groups.filter(pk=reviewer_group.pk).exists()
    assert verified.is_staff is False
    assert rejected_unverified.status_code == 200
    assert not unverified.groups.filter(pk=reviewer_group.pk).exists()
    assert rejected_inactive.status_code == 200
    assert not inactive.groups.filter(pk=reviewer_group.pk).exists()


@pytest.mark.django_db
def test_non_superuser_can_manage_unrelated_assignments_but_not_operator_access(client):
    staff = User.objects.create_user(
        email="staff@example.com",
        password="password",
        is_staff=True,
    )
    staff.user_permissions.add(Permission.objects.get(codename="change_user"))
    reviewer_group = Group.objects.get(name="Submission Reviewer")
    ordinary_group = Group.objects.create(name="Content Editors")
    ordinary_permission = Permission.objects.get(
        content_type__app_label="accounts",
        codename="view_user",
    )
    target = User.objects.create_user(
        email="target@example.com",
        password="password",
        email_verified_at=staff.date_joined,
    )
    target.groups.add(reviewer_group)
    client.force_login(staff)

    unrelated_change = client.post(
        reverse("admin:accounts_user_change", args=(target.pk,)),
        {
            "email": target.email,
            "first_name": "",
            "last_name": "",
            "is_active": True,
            "is_staff": False,
            "is_superuser": False,
            "date_joined": target.date_joined.isoformat(),
            "groups": [reviewer_group.pk, ordinary_group.pk],
            "user_permissions": [ordinary_permission.pk],
            "_save": "Save",
        },
    )

    target.refresh_from_db()
    assert unrelated_change.status_code == 302
    assert target.groups.filter(pk=reviewer_group.pk).exists()
    assert target.groups.filter(pk=ordinary_group.pk).exists()
    assert target.user_permissions.filter(pk=ordinary_permission.pk).exists()

    revoked = client.post(
        reverse("admin:accounts_user_change", args=(target.pk,)),
        {
            "email": target.email,
            "first_name": "",
            "last_name": "",
            "is_active": True,
            "is_staff": False,
            "is_superuser": False,
            "groups": [ordinary_group.pk],
            "user_permissions": [ordinary_permission.pk],
            "_save": "Save",
        },
    )

    target.refresh_from_db()
    assert revoked.status_code == 200
    assert target.groups.filter(pk=reviewer_group.pk).exists()

    other_target = User.objects.create_user(
        email="other-target@example.com",
        password="password",
        email_verified_at=staff.date_joined,
    )
    granted = client.post(
        reverse("admin:accounts_user_change", args=(other_target.pk,)),
        {
            "email": other_target.email,
            "first_name": "",
            "last_name": "",
            "is_active": True,
            "is_staff": False,
            "is_superuser": False,
            "groups": [reviewer_group.pk],
            "user_permissions": [],
            "_save": "Save",
        },
    )

    assert granted.status_code == 200
    assert not other_target.groups.filter(pk=reviewer_group.pk).exists()


@pytest.mark.django_db
def test_non_superuser_cannot_add_operator_permissions_to_groups(client):
    staff = User.objects.create_user(
        email="group-staff@example.com",
        password="password",
        is_staff=True,
    )
    staff.user_permissions.add(
        Permission.objects.get(codename="change_group"),
        Permission.objects.get(codename="delete_group"),
    )
    group = Group.objects.create(name="Ordinary Group")
    ordinary_permission = Permission.objects.get(
        content_type__app_label="accounts",
        codename="view_user",
    )
    review_permission = Permission.objects.get(
        content_type__app_label="submissions",
        codename="review_submission",
    )
    client.force_login(staff)

    ordinary_change = client.post(
        reverse("admin:auth_group_change", args=(group.pk,)),
        {
            "name": group.name,
            "permissions": [ordinary_permission.pk],
            "_save": "Save",
        },
    )
    capability_injection = client.post(
        reverse("admin:auth_group_change", args=(group.pk,)),
        {
            "name": group.name,
            "permissions": [ordinary_permission.pk, review_permission.pk],
            "_save": "Save",
        },
    )

    group.refresh_from_db()
    assert ordinary_change.status_code == 302
    assert capability_injection.status_code == 200
    assert set(group.permissions.all()) == {ordinary_permission}

    reviewer_group = Group.objects.get(name="Submission Reviewer")
    deleted = client.post(
        reverse("admin:auth_group_delete", args=(reviewer_group.pk,)),
        {"post": "yes"},
    )

    assert deleted.status_code == 403
    assert Group.objects.filter(pk=reviewer_group.pk).exists()

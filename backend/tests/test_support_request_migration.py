import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
def test_contact_message_record_is_renamed_without_loss_or_duplication():
    executor = MigrationExecutor(connection)
    latest_targets = executor.loader.graph.leaf_nodes()
    old_target = [("contact", "0001_initial")]
    new_target = [("contact", "0002_rename_support_request")]

    try:
        executor.migrate(old_target)
        old_apps = executor.loader.project_state(old_target).apps
        ContactMessage = old_apps.get_model("contact", "ContactMessage")
        Permission = old_apps.get_model("auth", "Permission")
        User = old_apps.get_model("accounts", "User")
        original = ContactMessage.objects.create(
            name="Existing requester",
            email="existing@example.com",
            kind="account_deletion",
            message="This record existed before the Support Request migration.",
        )
        operator = User.objects.create(email="existing-operator@example.com", is_staff=True)
        old_permission = Permission.objects.get(
            content_type__app_label="contact",
            codename="view_contactmessage",
        )
        operator.user_permissions.add(old_permission)

        executor = MigrationExecutor(connection)
        executor.migrate(new_target)
        new_apps = executor.loader.project_state(new_target).apps
        SupportRequest = new_apps.get_model("contact", "SupportRequest")
        Permission = new_apps.get_model("auth", "Permission")
        User = new_apps.get_model("accounts", "User")

        migrated = SupportRequest.objects.get(id=original.id)
        assert SupportRequest.objects.count() == 1
        assert SupportRequest._meta.db_table == "contact_contactmessage"
        assert SupportRequest._meta.get_field("intake_kind").column == "kind"
        assert migrated.intake_kind == "account_deletion"
        assert migrated.email == "existing@example.com"
        preserved_permission = Permission.objects.get(
            content_type__app_label="contact",
            codename="view_supportrequest",
        )
        migrated_operator = User.objects.get(id=operator.id)
        assert migrated_operator.user_permissions.filter(id=preserved_permission.id).exists()
        assert Permission.objects.filter(
            content_type__app_label="contact",
            codename="view_contactmessage",
        ).exists()
    finally:
        MigrationExecutor(connection).migrate(latest_targets)


@pytest.mark.django_db(transaction=True)
def test_existing_classification_is_preserved_while_public_exposure_becomes_locked_urgent():
    executor = MigrationExecutor(connection)
    latest_targets = executor.loader.graph.leaf_nodes()
    old_target = [("contact", "0002_rename_support_request")]
    new_target = [("contact", "0003_add_privacy_aware_support_triage")]

    try:
        executor.migrate(old_target)
        old_apps = executor.loader.project_state(old_target).apps
        SupportRequest = old_apps.get_model("contact", "SupportRequest")
        deletion = SupportRequest.objects.create(
            name="Existing deletion",
            email="deletion@example.com",
            intake_kind="account_deletion",
            classification="guidance",
            message="This deletion request predates authoritative Support triage.",
        )
        removal = SupportRequest.objects.create(
            name="Existing public exposure",
            email="removal@example.com",
            intake_kind="public_contact_removal",
            classification="spam",
            message="This public exposure request predates authoritative Support triage.",
        )

        executor = MigrationExecutor(connection)
        executor.migrate(new_target)
        new_apps = executor.loader.project_state(new_target).apps
        SupportRequest = new_apps.get_model("contact", "SupportRequest")

        migrated_deletion = SupportRequest.objects.get(id=deletion.id)
        assert migrated_deletion.classification == "guidance"
        assert migrated_deletion.priority == "normal"
        assert migrated_deletion.priority_locked is False
        migrated_removal = SupportRequest.objects.get(id=removal.id)
        assert migrated_removal.classification == "spam"
        assert migrated_removal.priority == "urgent"
        assert migrated_removal.priority_locked is True
    finally:
        MigrationExecutor(connection).migrate(latest_targets)

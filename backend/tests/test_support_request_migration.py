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

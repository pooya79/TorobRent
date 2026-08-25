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


@pytest.mark.django_db(transaction=True)
def test_resolution_history_migration_preserves_account_link_and_event_classification():
    executor = MigrationExecutor(connection)
    latest_targets = executor.loader.graph.leaf_nodes()
    old_target = [("contact", "0003_add_privacy_aware_support_triage")]
    new_target = [("contact", "0007_supportrequest_account_linked_at_intake_and_more")]

    try:
        executor.migrate(old_target)
        old_apps = executor.loader.project_state(old_target).apps
        SupportRequest = old_apps.get_model("contact", "SupportRequest")
        SupportRequestEvent = old_apps.get_model("contact", "SupportRequestEvent")
        User = old_apps.get_model("accounts", "User")
        requester = User.objects.create(email="linked@example.com")
        operator = User.objects.create(email="operator@example.com")
        support_request = SupportRequest.objects.create(
            submitter=requester,
            name="Linked requester",
            email=requester.email,
            intake_kind="general",
            classification="guidance",
            message="This request and event predate immutable resolution history.",
        )
        event = SupportRequestEvent.objects.create(
            support_request=support_request,
            actor=operator,
            event_type="assigned",
            prior_state="open",
            new_state="in_progress",
        )

        executor = MigrationExecutor(connection)
        executor.migrate(new_target)
        new_apps = executor.loader.project_state(new_target).apps
        SupportRequest = new_apps.get_model("contact", "SupportRequest")
        SupportRequestEvent = new_apps.get_model("contact", "SupportRequestEvent")

        migrated_request = SupportRequest.objects.get(id=support_request.id)
        migrated_event = SupportRequestEvent.objects.get(id=event.id)
        assert migrated_request.account_linked_at_intake is True
        assert migrated_event.classification == "guidance"
    finally:
        MigrationExecutor(connection).migrate(latest_targets)


@pytest.mark.django_db(transaction=True)
def test_redaction_migration_preserves_existing_support_content_and_history():
    executor = MigrationExecutor(connection)
    latest_targets = executor.loader.graph.leaf_nodes()
    old_target = [
        ("accounts", "0004_create_operator_groups"),
        ("contact", "0007_supportrequest_account_linked_at_intake_and_more"),
        ("submissions", "0007_submissiondecisionnotification"),
    ]
    new_target = [
        ("accounts", "0005_user_anonymized_at"),
        ("contact", "0008_supportrequest_personal_content_redacted_at_and_more"),
        ("submissions", "0007_submissiondecisionnotification"),
    ]

    try:
        executor.migrate(old_target)
        old_apps = executor.loader.project_state(old_target).apps
        SupportRequest = old_apps.get_model("contact", "SupportRequest")
        SupportRequestEvent = old_apps.get_model("contact", "SupportRequestEvent")
        Submission = old_apps.get_model("submissions", "Submission")
        User = old_apps.get_model("accounts", "User")
        operator = User.objects.create(email="migration-operator@example.com")
        submitter = User.objects.create(email="migration-submitter@example.com")
        support_request = SupportRequest.objects.create(
            name="Existing requester",
            email="existing-requester@example.com",
            intake_kind="general",
            classification="guidance",
            message="Existing personal content is not redacted merely by migrating.",
        )
        event = SupportRequestEvent.objects.create(
            support_request=support_request,
            actor=operator,
            event_type="classified",
            prior_state="open",
            new_state="open",
            classification="guidance",
            reason="Existing operational fact",
        )
        pending_submission = Submission.objects.create(
            submitter=submitter,
            role="owner",
            state="pending",
        )

        executor = MigrationExecutor(connection)
        executor.migrate(new_target)
        new_apps = executor.loader.project_state(new_target).apps
        SupportRequest = new_apps.get_model("contact", "SupportRequest")
        SupportRequestEvent = new_apps.get_model("contact", "SupportRequestEvent")
        Submission = new_apps.get_model("submissions", "Submission")

        migrated_request = SupportRequest.objects.get(id=support_request.id)
        migrated_event = SupportRequestEvent.objects.get(id=event.id)
        assert migrated_request.name == "Existing requester"
        assert migrated_request.email == "existing-requester@example.com"
        assert migrated_request.message == (
            "Existing personal content is not redacted merely by migrating."
        )
        assert migrated_request.personal_content_redacted_at is None
        assert migrated_event.reason == "Existing operational fact"
        assert migrated_event.actor_id == operator.id
        migrated_submission = Submission.objects.get(id=pending_submission.id)
        assert migrated_submission.state == "pending"
        assert migrated_submission.submitter_id == submitter.id
    finally:
        MigrationExecutor(connection).migrate(latest_targets)

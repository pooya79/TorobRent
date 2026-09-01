from decimal import Decimal

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone


@pytest.mark.django_db(transaction=True)
def test_alternate_contact_migration_preserves_existing_submission_data():
    executor = MigrationExecutor(connection)
    latest_targets = executor.loader.graph.leaf_nodes()
    account_target = ("accounts", "0008_user_submitter_onboarding_path")
    old_target = [
        account_target,
        ("submissions", "0010_submission_exact_latitude_submission_exact_longitude"),
    ]
    new_target = [
        account_target,
        ("submissions", "0011_submission_alternate_contact_phone_verified_at_and_more"),
    ]

    try:
        executor.migrate(old_target)
        old_apps = executor.loader.project_state(old_target).apps
        User = old_apps.get_model("accounts", "User")
        Submission = old_apps.get_model("submissions", "Submission")
        verified_at = timezone.now()
        submitter = User.objects.create(
            email="persisted-submitter@example.com",
            email_verified_at=verified_at,
            password="already-hashed",
        )
        submission = Submission.objects.create(
            submitter_id=submitter.id,
            role="owner",
            state="changes_requested",
            current_step="contact",
            address="بلوار دریا، کوچه سرو",
            exact_latitude=Decimal("35.756123"),
            exact_longitude=Decimal("51.376456"),
            contact_name="سارا احمدی",
            contact_phone="09123456789",
            authorization_declared=True,
            phone_publication_consent=True,
            review_data={"reason": "شماره تماس را بررسی کنید."},
        )

        executor = MigrationExecutor(connection)
        executor.migrate(new_target)
        new_apps = executor.loader.project_state(new_target).apps
        migrated = new_apps.get_model("submissions", "Submission").objects.get(id=submission.id)

        assert migrated.submitter_id == submitter.id
        assert migrated.state == "changes_requested"
        assert migrated.current_step == "contact"
        assert migrated.address == "بلوار دریا، کوچه سرو"
        assert migrated.exact_latitude == Decimal("35.756123")
        assert migrated.exact_longitude == Decimal("51.376456")
        assert migrated.contact_name == "سارا احمدی"
        assert migrated.contact_phone == "09123456789"
        assert migrated.authorization_declared is True
        assert migrated.phone_publication_consent is True
        assert migrated.review_data == {"reason": "شماره تماس را بررسی کنید."}
        assert migrated.contact_phone_source == "account"
        assert migrated.alternate_contact_phone_verified_at is None
    finally:
        MigrationExecutor(connection).migrate(latest_targets)

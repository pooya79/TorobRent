import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
def test_existing_accounts_retain_submitter_behavior_when_renter_accounts_are_introduced():
    executor = MigrationExecutor(connection)
    latest_targets = executor.loader.graph.leaf_nodes()
    old_target = [("accounts", "0005_user_anonymized_at")]
    new_target = [("accounts", "0006_user_is_submitter")]

    try:
        executor.migrate(old_target)
        old_apps = executor.loader.project_state(old_target).apps
        User = old_apps.get_model("accounts", "User")
        submitter = User.objects.create(email="existing-submitter@example.com")
        operator = User.objects.create(email="existing-operator@example.com", is_staff=True)

        executor = MigrationExecutor(connection)
        executor.migrate(new_target)
        new_apps = executor.loader.project_state(new_target).apps
        User = new_apps.get_model("accounts", "User")

        assert User.objects.get(id=submitter.id).is_submitter is True
        assert User.objects.get(id=operator.id).is_submitter is True
    finally:
        MigrationExecutor(connection).migrate(latest_targets)

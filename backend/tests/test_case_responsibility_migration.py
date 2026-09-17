"""Backfill must preserve each case's own history when a domain changes representatives."""

from datetime import timedelta
from importlib import import_module
from types import SimpleNamespace

import pytest
from django.apps import apps
from django.db import connection
from django.utils import timezone

from apps.catalog.models import Source
from apps.source_proposals.models import (
    SourceAssignment,
    SourceProposal,
    SourceResponsibilityChange,
)
from tests.test_source_proposal_review import make_operator, make_user


@pytest.mark.django_db
def test_backfill_bounds_responsibility_to_each_assignment_lifetime(api_client):
    representative = make_user(email="rep@example.com", submitter=True)
    old_operator = make_operator(email="old@example.com")
    new_operator = make_operator(email="new@example.com")
    now = timezone.now()
    source = Source.objects.create(
        name="case-history",
        domain="history.example",
        responsible_operator=new_operator,
        responsibility_revision=2,
    )
    old = SourceProposal.objects.create(submitter=representative, source=source, state="revoked")
    new = SourceProposal.objects.create(submitter=representative, source=source, state="approved")
    old_assignment = SourceAssignment.objects.create(
        source=source,
        proposal=old,
        representative=representative,
        revoked_at=now - timedelta(days=2),
    )
    new_assignment = SourceAssignment.objects.create(
        source=source, proposal=new, representative=representative
    )
    SourceAssignment.objects.filter(pk=old_assignment.pk).update(created_at=now - timedelta(days=4))
    SourceAssignment.objects.filter(pk=new_assignment.pk).update(created_at=now - timedelta(days=1))
    SourceResponsibilityChange.objects.create(
        source=source,
        operator=old_operator,
        actor=old_operator,
        revision=1,
        reason="old case",
        created_at=now - timedelta(days=4),
    )
    SourceResponsibilityChange.objects.create(
        source=source,
        operator=new_operator,
        actor=new_operator,
        revision=2,
        reason="new case",
        created_at=now - timedelta(days=1),
    )
    migration = import_module("apps.source_proposals.migrations.0045_backfill_case_responsibility")
    migration.backfill(apps, SimpleNamespace(connection=connection))
    api_client.force_authenticate(new_operator)
    for proposal, operator, reason in [
        (old, old_operator, "old case"),
        (new, new_operator, "new case"),
    ]:
        detail = api_client.get(
            f"/api/v1/operator/source-proposals/?proposal={proposal.pk}"
        ).json()[0]
        assert detail["responsibility"]["operator"] == str(operator.pk)
        assert detail["assignment"]["review_operator"] == str(operator.pk)
        assert [item["reason"] for item in detail["responsibility"]["history"]] == [reason]

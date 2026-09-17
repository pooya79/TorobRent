from django.db import migrations
from django.utils import timezone


def backfill(apps, schema_editor):
    database = schema_editor.connection.alias
    Proposal = apps.get_model("source_proposals", "SourceProposal")
    Change = apps.get_model("source_proposals", "SourceCaseResponsibilityChange")
    SourceChange = apps.get_model("source_proposals", "SourceResponsibilityChange")
    Claim = apps.get_model("source_proposals", "SourceProposalReviewClaim")
    Assignment = apps.get_model("source_proposals", "SourceAssignment")
    Event = apps.get_model("source_proposals", "SourceProposalEvent")
    for proposal in Proposal.objects.using(database).all().iterator():
        assignment = (
            Assignment.objects
            .using(database)
            .filter(proposal=proposal)
            .order_by("-created_at")
            .first()
        )
        evidence = []
        if assignment:
            approval = (
                Event.objects
                .using(database)
                .filter(proposal=proposal, new_state="approved")
                .order_by("created_at")
                .first()
            )
            history = SourceChange.objects.using(database).filter(
                source_id=assignment.source_id,
                created_at__gte=approval.created_at if approval else assignment.created_at,
            )
            if assignment.revoked_at:
                history = history.filter(created_at__lte=assignment.revoked_at)
            # The initial Source change is recorded just before Assignment creation.
            initial = (
                history
                .filter(created_at__lte=assignment.created_at)
                .order_by("-created_at", "-revision")
                .first()
            )
            if initial:
                evidence.append((
                    initial.operator_id,
                    initial.actor_id,
                    initial.reason,
                    initial.created_at,
                ))
            elif approval:
                evidence.append((
                    approval.actor_id,
                    approval.actor_id,
                    "مسئول اولیه از سابقه تأیید این پرونده",
                    approval.created_at,
                ))
            for change in history.filter(created_at__gt=assignment.created_at).order_by(
                "created_at", "revision"
            ):
                evidence.append((
                    change.operator_id,
                    change.actor_id,
                    change.reason,
                    change.created_at,
                ))
        else:
            claim = (
                Claim.objects
                .using(database)
                .filter(
                    proposal=proposal,
                    revision=proposal.revision,
                    released_at__isnull=True,
                    expires_at__gt=timezone.now(),
                )
                .first()
            )
            if claim:
                evidence.append((
                    claim.operator_id,
                    claim.operator_id,
                    "انتقال بررسی جاری به مسئولیت پایدار پرونده",
                    timezone.now(),
                ))
        for revision, (operator, actor, reason, created_at) in enumerate(evidence, start=1):
            Change.objects.using(database).create(
                proposal=proposal,
                operator_id=operator,
                actor_id=actor,
                revision=revision,
                reason=reason,
                created_at=created_at,
            )
            proposal.responsible_operator_id = operator
            proposal.responsibility_revision = revision
        proposal.save(
            using=database, update_fields=("responsible_operator", "responsibility_revision")
        )


class Migration(migrations.Migration):
    dependencies = [("source_proposals", "0044_sourceproposal_responsibility_revision_and_more")]
    operations = [migrations.RunPython(backfill, migrations.RunPython.noop)]

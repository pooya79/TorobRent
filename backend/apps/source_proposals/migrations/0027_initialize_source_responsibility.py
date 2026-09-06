from django.db import migrations


def initialize_responsibility(apps, schema_editor):
    Source = apps.get_model("catalog", "Source")
    Assignment = apps.get_model("source_proposals", "SourceAssignment")
    Event = apps.get_model("source_proposals", "SourceProposalEvent")
    Change = apps.get_model("source_proposals", "SourceResponsibilityChange")
    database = schema_editor.connection.alias
    for source in Source.objects.using(database).filter(is_builtin=False).iterator():
        assignment = (
            Assignment.objects
            .using(database)
            .filter(source_id=source.pk, approval__isnull=False)
            .select_related("approval__event")
            .order_by("-created_at", "-pk")
            .first()
        )
        event = (
            assignment.approval.event
            if assignment
            else (
                Event.objects
                .using(database)
                .filter(proposal__source_id=source.pk, new_state="approved")
                .order_by("-created_at", "-pk")
                .first()
            )
        )
        if event is None:
            continue
        Source.objects.using(database).filter(pk=source.pk).update(
            responsible_operator_id=event.actor_id, responsibility_revision=1
        )
        Change.objects.using(database).create(
            source_id=source.pk,
            operator_id=event.actor_id,
            actor_id=event.actor_id,
            revision=1,
            reason="مسئول اولیه از سابقه تأیید پروفایل منبع",
            created_at=event.created_at,
        )


class Migration(migrations.Migration):
    dependencies = [("source_proposals", "0026_sourceresponsibilitychange")]
    operations = [migrations.RunPython(initialize_responsibility, migrations.RunPython.noop)]

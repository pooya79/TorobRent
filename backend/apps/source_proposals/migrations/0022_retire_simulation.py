from django.db import migrations, models
from django.utils import timezone


def retire_simulation(apps, schema_editor):
    alias = schema_editor.connection.alias
    Candidate = apps.get_model("source_proposals", "ExternalListingCandidate")
    Event = apps.get_model("source_proposals", "ExternalListingCandidateEvent")
    Claim = apps.get_model("source_proposals", "ExternalListingCandidateReviewClaim")
    Listing = apps.get_model("catalog", "Listing")
    now = timezone.now()
    for candidate in Candidate.objects.using(alias).filter(simulated=True).iterator():
        candidate.evidence = {**candidate.evidence, "legacy_simulation": True}
        if candidate.state in ("pending", "changes_requested", "published"):
            Event.objects.using(alias).create(
                candidate=candidate,
                actor=None,
                revision=candidate.revision,
                prior_state=candidate.state,
                new_state="cancelled",
                reason="Retired simulated extraction; historical evidence retained.",
            )
            candidate.state = "cancelled"
        candidate.save(using=alias, update_fields=("evidence", "state"))
        Claim.objects.using(alias).filter(candidate=candidate, released_at=None).update(
            released_at=now
        )
        if candidate.listing_id:
            Listing.objects.using(alias).filter(pk=candidate.listing_id, state="published").update(
                state="unavailable", updated_at=now
            )


class Migration(migrations.Migration):
    dependencies = [("source_proposals", "0021_alter_candidateimage_original_url")]
    operations = [
        # Keep the physical column through the rolling deployment. New inserts use
        # the database default; a later release can drop the compatibility column.
        migrations.AlterField(
            model_name="externallistingcandidate",
            name="simulated",
            field=models.BooleanField(default=False, db_default=False, editable=False),
        ),
        migrations.RunPython(retire_simulation, migrations.RunPython.noop),
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.RemoveField(model_name="externallistingcandidate", name="simulated"),
            ]
        ),
    ]

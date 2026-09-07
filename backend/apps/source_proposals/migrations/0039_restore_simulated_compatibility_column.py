from django.db import migrations, models


def restore_simulated_compatibility_column(apps, schema_editor):
    Candidate = apps.get_model("source_proposals", "ExternalListingCandidate")
    table_name = Candidate._meta.db_table
    with schema_editor.connection.cursor() as cursor:
        columns = {
            column.name
            for column in schema_editor.connection.introspection.get_table_description(
                cursor, table_name
            )
        }
    if "simulated" in columns:
        return

    field = models.BooleanField(default=False, db_default=False, editable=False)
    field.set_attributes_from_name("simulated")
    field.model = Candidate
    schema_editor.add_field(Candidate, field)


class Migration(migrations.Migration):
    dependencies = [
        ("source_proposals", "0038_sourceexceptionnotificationstate_last_delivery_check"),
    ]
    operations = [
        # Migration 0022 intentionally retained this physical column for old workers while
        # removing it from Django's model state. SQLite may discard state-only columns when
        # later schema changes rebuild the table, so restore the rolling-deployment contract.
        migrations.RunPython(
            restore_simulated_compatibility_column,
            migrations.RunPython.noop,
        ),
    ]

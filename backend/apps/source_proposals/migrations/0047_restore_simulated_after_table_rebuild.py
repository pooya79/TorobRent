from django.db import migrations, models


def restore_simulated_column(apps, schema_editor):
    candidate = apps.get_model("source_proposals", "ExternalListingCandidate")
    table_name = candidate._meta.db_table
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
    field.model = candidate
    schema_editor.add_field(candidate, field)


class Migration(migrations.Migration):
    dependencies = [
        ("source_proposals", "0046_externallistingcandidate_requested_urls_and_more"),
    ]
    operations = [
        migrations.RunPython(restore_simulated_column, migrations.RunPython.noop),
    ]

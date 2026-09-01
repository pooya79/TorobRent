from django.db import migrations


def create_source_proposal_reviewer_group(apps, schema_editor):
    content_type_model = apps.get_model("contenttypes", "ContentType")
    group_model = apps.get_model("auth", "Group")
    permission_model = apps.get_model("auth", "Permission")
    content_type, _ = content_type_model.objects.get_or_create(
        app_label="source_proposals", model="sourceproposal"
    )
    permission, _ = permission_model.objects.get_or_create(
        content_type=content_type,
        codename="review_source_proposal",
        defaults={"name": "Can review Source Proposals"},
    )
    group, _ = group_model.objects.get_or_create(name="Source Proposal Reviewer")
    group.permissions.add(permission)


def remove_source_proposal_reviewer_group(apps, schema_editor):
    apps.get_model("auth", "Group").objects.filter(name="Source Proposal Reviewer").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0008_user_submitter_onboarding_path"),
        ("source_proposals", "0001_initial"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="sourceproposal",
            options={
                "ordering": ("-updated_at",),
                "permissions": (("review_source_proposal", "Can review Source Proposals"),),
            },
        ),
        migrations.RunPython(
            create_source_proposal_reviewer_group,
            remove_source_proposal_reviewer_group,
        ),
    ]

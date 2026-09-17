from django.db import migrations

GROUP_PERMISSIONS = {
    "Submission Reviewer": ("submissions.review_submission",),
    "Submission Review Lead": ("submissions.review_submission", "accounts.manage_operator_queue"),
    "Support Operator": ("accounts.handle_general_support_requests",),
    "Support Lead": (
        "accounts.handle_general_support_requests",
        "accounts.manage_operator_queue",
    ),
    "Privacy Operator": (
        "accounts.handle_general_support_requests",
        "accounts.handle_privacy_support_requests",
    ),
    "Privacy Lead": (
        "accounts.handle_general_support_requests",
        "accounts.handle_privacy_support_requests",
        "accounts.manage_operator_queue",
    ),
    "Operator Queue Manager": ("accounts.manage_operator_queue",),
    "Source Proposal Reviewer": ("source_proposals.review_source_proposal",),
    "Catalog Curator": ("catalog.curate_catalog",),
    "Conversation Moderator": ("communications.moderate_conversation_reports",),
}

PERMISSION_MODELS_AND_NAMES = {
    "manage_operator_queue": ("user", "Can manage Operator queues"),
    "handle_general_support_requests": ("user", "Can handle general Support Requests"),
    "handle_privacy_support_requests": ("user", "Can handle privacy Support Requests"),
    "review_submission": ("submission", "Can review and publish Submissions"),
    "review_source_proposal": ("sourceproposal", "Can review Source Proposals"),
    "curate_catalog": ("property", "Can curate the Property catalog"),
    "moderate_conversation_reports": ("conversationreport", "Can moderate Conversation Reports"),
}


def create_operator_groups(apps, schema_editor):
    content_type_model = apps.get_model("contenttypes", "ContentType")
    group_model = apps.get_model("auth", "Group")
    permission_model = apps.get_model("auth", "Permission")

    for group_name, permission_labels in GROUP_PERMISSIONS.items():
        group, _ = group_model.objects.using(schema_editor.connection.alias).get_or_create(
            name=group_name
        )
        permissions = []
        for label in permission_labels:
            app_label, codename = label.split(".")
            model, name = PERMISSION_MODELS_AND_NAMES[codename]
            content_type, _ = content_type_model.objects.using(
                schema_editor.connection.alias
            ).get_or_create(app_label=app_label, model=model)
            permission, _ = permission_model.objects.using(
                schema_editor.connection.alias
            ).get_or_create(
                content_type=content_type,
                codename=codename,
                defaults={"name": name},
            )
            permissions.append(permission)
        group.permissions.set(permissions)


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
        ("catalog", "0001_initial"),
        ("communications", "0001_initial"),
        ("source_proposals", "0001_initial"),
        ("submissions", "0001_initial"),
    ]

    operations = [migrations.RunPython(create_operator_groups, migrations.RunPython.noop)]

from django.db import migrations

CAPABILITIES = {
    "queue": (
        "accounts",
        "user",
        "manage_operator_queue",
        "Can manage Operator queues",
    ),
    "privacy": (
        "accounts",
        "user",
        "handle_privacy_support_requests",
        "Can handle privacy Support Requests",
    ),
    "review": (
        "submissions",
        "submission",
        "review_submission",
        "Can review and publish Submissions",
    ),
    "support": (
        "accounts",
        "user",
        "handle_general_support_requests",
        "Can handle general Support Requests",
    ),
}

GROUPS = {
    "Submission Reviewer": ("review",),
    "Submission Review Lead": ("review", "queue"),
    "Support Operator": ("support",),
    "Support Lead": ("support", "queue"),
    "Privacy Operator": ("support", "privacy"),
    "Privacy Lead": ("support", "privacy", "queue"),
    "Operator Queue Manager": ("queue",),
}


def create_operator_groups(apps, schema_editor):
    content_type_model = apps.get_model("contenttypes", "ContentType")
    group_model = apps.get_model("auth", "Group")
    permission_model = apps.get_model("auth", "Permission")
    permissions = {}
    for key, (app_label, model, codename, name) in CAPABILITIES.items():
        content_type, _ = content_type_model.objects.get_or_create(
            app_label=app_label,
            model=model,
        )
        permission, _ = permission_model.objects.get_or_create(
            content_type=content_type,
            codename=codename,
            defaults={"name": name},
        )
        permissions[key] = permission

    for name, capability_keys in GROUPS.items():
        group, _ = group_model.objects.get_or_create(name=name)
        group.permissions.set(permissions[key] for key in capability_keys)


def remove_operator_groups(apps, schema_editor):
    group_model = apps.get_model("auth", "Group")
    group_model.objects.filter(name__in=GROUPS).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0003_alter_user_options"),
        ("submissions", "0004_alter_submission_options_submission_listing_and_more"),
    ]

    operations = [
        migrations.RunPython(create_operator_groups, remove_operator_groups),
    ]

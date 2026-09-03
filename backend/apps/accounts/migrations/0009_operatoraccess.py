from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0008_user_submitter_onboarding_path"),
    ]

    operations = [
        migrations.CreateModel(
            name="OperatorAccess",
            fields=[],
            options={
                "verbose_name": "Operator access",
                "verbose_name_plural": "Operator access",
                "proxy": True,
                "indexes": [],
                "constraints": [],
                "default_permissions": (),
            },
            bases=("accounts.user",),
        ),
    ]

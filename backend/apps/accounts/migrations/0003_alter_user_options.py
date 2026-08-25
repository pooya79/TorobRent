from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("accounts", "0002_user_email_verified_at")]

    operations = [
        migrations.AlterModelOptions(
            name="user",
            options={
                "permissions": (
                    (
                        "handle_privacy_support_requests",
                        "Can handle privacy Support Requests",
                    ),
                    (
                        "handle_general_support_requests",
                        "Can handle general Support Requests",
                    ),
                    ("manage_operator_queue", "Can manage Operator queues"),
                )
            },
        )
    ]

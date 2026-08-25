import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("submissions", "0005_submission_pending_since_reviewclaim"),
    ]

    operations = [
        migrations.AlterField(
            model_name="submissionevent",
            name="submission",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="events",
                to="submissions.submission",
            ),
        ),
        migrations.AddField(
            model_name="submissionevent",
            name="event_type",
            field=models.CharField(
                choices=[
                    ("transition", "تغییر وضعیت"),
                    ("decision_correction", "اصلاح تصمیم"),
                ],
                default="transition",
                max_length=24,
            ),
        ),
        migrations.AddField(
            model_name="submissionevent",
            name="normalized_corrections",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="submissionevent",
            name="publication_result",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="submissionevent",
            name="correction",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="submissionevent",
            name="corrects",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="corrections",
                to="submissions.submissionevent",
            ),
        ),
        migrations.AddField(
            model_name="submissionevent",
            name="review_claim",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="decision_events",
                to="submissions.reviewclaim",
            ),
        ),
    ]

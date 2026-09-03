from unicodedata import normalize

from django.db import migrations, models
from django.utils.crypto import salted_hmac


def backfill_opening_message_fingerprints(apps, _schema_editor):
    ListingInquiry = apps.get_model("communications", "ListingInquiry")
    for inquiry in ListingInquiry.objects.prefetch_related("messages").iterator(chunk_size=2000):
        opening_message = min(
            inquiry.messages.all(), key=lambda message: (message.created_at, message.id)
        )
        normalized_body = " ".join(normalize("NFKC", opening_message.body).casefold().split())
        fingerprint = salted_hmac(
            "listing-inquiry-opening-message",
            normalized_body,
            algorithm="sha256",
        ).hexdigest()
        ListingInquiry.objects.filter(id=inquiry.id).update(opening_message_fingerprint=fingerprint)


class Migration(migrations.Migration):
    dependencies = [("communications", "0005_listinginquirymessage_edit_state")]

    operations = [
        migrations.AddField(
            model_name="listinginquiry",
            name="opening_message_fingerprint",
            field=models.CharField(default="", editable=False, max_length=64),
            preserve_default=False,
        ),
        migrations.RunPython(backfill_opening_message_fingerprints, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name="listinginquiry",
            index=models.Index(
                fields=["renter", "opening_message_fingerprint", "created_at"],
                name="inquiry_repeated_content_idx",
            ),
        ),
    ]

from django.db import migrations, models


def copy_opening_snapshots(apps, _schema_editor):
    ListingInquiry = apps.get_model("communications", "ListingInquiry")
    property_type_labels = {
        "apartment": "آپارتمان",
        "house": "خانه",
        "villa": "ویلا",
        "office": "دفتر اداری",
        "shop": "مغازه",
        "warehouse": "انبار",
        "workshop": "کارگاه",
    }
    for inquiry in ListingInquiry.objects.select_related(
        "listing__property__neighborhood", "listing__terms", "listing__source"
    ).iterator():
        listing = inquiry.listing
        property_ = listing.property
        property_title = property_type_labels.get(property_.property_type, property_.property_type)
        if property_.neighborhood_id:
            property_title = f"{property_title} در {property_.neighborhood.name_fa}"
        ListingInquiry.objects.filter(id=inquiry.id).update(
            opening_property_title=property_title,
            opening_area_sqm=property_.area_sqm,
            opening_deposit_rial=listing.terms.deposit_rial,
            opening_monthly_rent_rial=listing.terms.monthly_rent_rial,
            opening_currency=listing.terms.currency,
            opening_source_display_name=listing.source.display_name,
        )


class Migration(migrations.Migration):
    dependencies = [("communications", "0003_listinginquiry_listinginquirymessage_and_more")]

    operations = [
        migrations.AddField(
            model_name="listinginquiry",
            name="opening_area_sqm",
            field=models.PositiveIntegerField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="listinginquiry",
            name="opening_currency",
            field=models.CharField(default="IRR", editable=False, max_length=3),
        ),
        migrations.AddField(
            model_name="listinginquiry",
            name="opening_deposit_rial",
            field=models.PositiveBigIntegerField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="listinginquiry",
            name="opening_monthly_rent_rial",
            field=models.PositiveBigIntegerField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="listinginquiry",
            name="opening_property_title",
            field=models.CharField(editable=False, max_length=255, null=True),
        ),
        migrations.AddField(
            model_name="listinginquiry",
            name="opening_source_display_name",
            field=models.CharField(editable=False, max_length=120, null=True),
        ),
        migrations.RunPython(copy_opening_snapshots, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="listinginquiry",
            name="opening_area_sqm",
            field=models.PositiveIntegerField(editable=False),
        ),
        migrations.AlterField(
            model_name="listinginquiry",
            name="opening_deposit_rial",
            field=models.PositiveBigIntegerField(editable=False),
        ),
        migrations.AlterField(
            model_name="listinginquiry",
            name="opening_monthly_rent_rial",
            field=models.PositiveBigIntegerField(editable=False),
        ),
        migrations.AlterField(
            model_name="listinginquiry",
            name="opening_property_title",
            field=models.CharField(editable=False, max_length=255),
        ),
        migrations.AlterField(
            model_name="listinginquiry",
            name="opening_source_display_name",
            field=models.CharField(editable=False, max_length=120),
        ),
    ]

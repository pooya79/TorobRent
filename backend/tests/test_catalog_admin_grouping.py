import pytest
from django.core.exceptions import ValidationError
from django.test import Client
from django.utils import timezone

from apps.accounts.models import User
from apps.catalog.administrative_grouping import (
    administrative_merge,
    administrative_partition_preview,
    administrative_reassign_listing,
)
from apps.catalog.match_decisions import comparison_data
from apps.catalog.models import (
    Favorite,
    OutboundPolicy,
    Property,
    PropertyImage,
    PropertyImageVariant,
    PropertyMatchDecision,
    PropertyMatchSuggestion,
    PropertyPartitionDecision,
    Source,
)
from apps.catalog.services import merge_properties
from apps.communications.models import ListingInquiry
from tests.test_catalog_curation import attach_listing_image, image_fixture
from tests.test_grouped_property_consistency import make_property


@pytest.fixture
def admin_grouping_case():
    actor = User.objects.create_superuser(
        email="break-glass@example.com", password="correct-horse-battery"
    )
    source = Source.objects.create(
        name="admin-grouping",
        domain="admin-grouping.example",
        display_name="منبع تعمیر مدیریتی",
        outbound_policy=OutboundPolicy.EXTERNAL_LINK,
    )
    survivor, survivor_listing = make_property(source, "SURVIVOR")
    redundant, redundant_listing = make_property(source, "REDUNDANT", area_sqm=95)
    return actor, survivor, redundant, survivor_listing, redundant_listing


@pytest.mark.django_db
def test_administrative_merge_uses_reviewed_grouping_and_records_a_complete_decision(
    admin_grouping_case,
):
    actor, survivor, redundant, survivor_listing, redundant_listing = admin_grouping_case
    Favorite.objects.create(account=actor, property=survivor)
    Favorite.objects.create(account=actor, property=redundant)
    redundant_listing.source_claims = {"address": "نشانی منبع حفظ‌شده"}
    redundant_listing.save(update_fields=["source_claims"])
    listing_image = attach_listing_image(redundant_listing, image_fixture(), position=0)
    listing_variant = listing_image.variants.get()
    property_image = PropertyImage.objects.create(
        property=redundant,
        position=0,
        is_primary=True,
        reviewed_at=timezone.now(),
        reviewed_by=actor,
    )
    PropertyImageVariant.objects.create(
        image=property_image,
        kind=listing_variant.kind,
        asset=listing_variant.asset,
    )
    renter = User.objects.create_user(email="merge-renter@example.com", password="password")
    inquiry = ListingInquiry.objects.create(
        listing=redundant_listing,
        renter=renter,
        submitter=None,
        opening_property_title=redundant.title,
        opening_area_sqm=redundant.area_sqm,
        opening_deposit_rial=redundant_listing.terms.deposit_rial,
        opening_monthly_rent_rial=redundant_listing.terms.monthly_rent_rial,
        opening_source_display_name=redundant_listing.source.display_name,
        opening_message_fingerprint="a" * 64,
        latest_activity_at=timezone.now(),
    )
    retained = {
        "area_sqm": redundant.area_sqm,
        "terms_id": redundant_listing.terms_id,
        "source_claims": redundant_listing.source_claims,
        "external_url": redundant_listing.external_url,
    }
    reviewed = comparison_data([survivor.pk, redundant.pk])

    decision = administrative_merge(
        actor=actor,
        survivor_id=survivor.pk,
        redundant_id=redundant.pk,
        reviewed_revision=reviewed["revision"],
        reason="تعمیر اضطراری گروه‌بندی",
    )

    redundant.refresh_from_db()
    redundant_listing.refresh_from_db()
    assert redundant.merged_into_id == survivor.pk
    assert redundant_listing.property_id == survivor.pk
    assert Favorite.objects.filter(property=survivor).count() == 1
    assert decision.actor == actor
    assert decision.origin == "administrative"
    assert decision.outcome == PropertyMatchDecision.Outcome.SAME_PROPERTY
    assert set(decision.affected_listing_ids) == {
        str(survivor_listing.pk),
        str(redundant_listing.pk),
    }
    assert decision.evidence["assessment"]["scoring_version"]
    assert decision.evaluation_snapshot["scoring_version"]
    assert decision.before_revision == reviewed["revision"]
    assert decision.after_revision != decision.before_revision
    assert decision.reason == "تعمیر اضطراری گروه‌بندی"
    assert decision.grouping_events.get().listing == redundant_listing
    redundant.refresh_from_db()
    redundant_listing.refresh_from_db()
    inquiry.refresh_from_db()
    assert Property.objects.filter(pk=redundant.pk).exists()
    assert redundant.area_sqm == retained["area_sqm"]
    assert redundant_listing.terms_id == retained["terms_id"]
    assert redundant_listing.source_claims == retained["source_claims"]
    assert redundant_listing.external_url == retained["external_url"]
    assert redundant_listing.images.get() == listing_image
    assert redundant.images.get() == property_image
    assert inquiry.listing == redundant_listing
    redirected = Client().get(f"/api/v1/catalog/properties/{redundant.pk}/")
    assert redirected.status_code == 200
    assert redirected.json()["id"] == str(survivor.pk)


@pytest.mark.django_db
def test_administrative_merge_rejects_stale_review_without_partial_mutation(
    admin_grouping_case,
):
    actor, survivor, redundant, _, redundant_listing = admin_grouping_case
    reviewed = comparison_data([survivor.pk, redundant.pk])
    redundant.area_sqm = 101
    redundant.save(update_fields=["area_sqm"])

    with pytest.raises(ValidationError, match="تغییر کرده"):
        administrative_merge(
            actor=actor,
            survivor_id=survivor.pk,
            redundant_id=redundant.pk,
            reviewed_revision=reviewed["revision"],
        )

    redundant.refresh_from_db()
    redundant_listing.refresh_from_db()
    assert redundant.merged_into_id is None
    assert redundant_listing.property_id == redundant.pk
    assert not PropertyMatchDecision.objects.exists()


@pytest.mark.django_db
def test_admin_merge_reports_stale_review_without_partial_mutation(admin_grouping_case):
    actor, survivor, redundant, _, redundant_listing = admin_grouping_case
    client = Client()
    client.force_login(actor)
    preview = client.post(
        "/admin/catalog/property/",
        {
            "action": "merge_into_target",
            "target_property": str(survivor.pk),
            "_selected_action": [str(redundant.pk)],
            "index": "0",
        },
    )
    redundant.area_sqm = 101
    redundant.save(update_fields=["area_sqm"])

    response = client.post(
        "/admin/catalog/property/",
        {
            "action": "merge_into_target",
            "target_property": str(survivor.pk),
            "reviewed_revision": preview.context["reviewed_revision"],
            "_selected_action": [str(redundant.pk)],
            "confirm_repair": "1",
            "index": "0",
        },
        follow=True,
    )

    redundant.refresh_from_db()
    redundant_listing.refresh_from_db()
    assert "تغییر کرده است" in response.content.decode()
    assert redundant.merged_into_id is None
    assert redundant_listing.property_id == redundant.pk
    assert not PropertyMatchDecision.objects.exists()


@pytest.mark.django_db
def test_administrative_listing_reassignment_partitions_to_existing_destination_atomically(
    admin_grouping_case,
):
    actor, source_property, historical, _, moved_listing = admin_grouping_case
    merge_properties(target=source_property, duplicate=historical, reason="گروه‌بندی قدیمی")
    destination, _ = make_property(moved_listing.source, "DESTINATION", area_sqm=95)
    reviewed = administrative_partition_preview(
        actor=actor, listing=moved_listing, destination_id=destination.pk
    )

    partition = administrative_reassign_listing(
        actor=actor,
        listing_id=moved_listing.pk,
        destination_id=destination.pk,
        reviewed_revision=reviewed["revision"],
        reason="اصلاح اضطراری هویت ملک",
    )

    moved_listing.refresh_from_db()
    source_property.refresh_from_db()
    assert moved_listing.property_id == destination.pk
    assert source_property.merged_into_id is None
    assert partition.actor == actor
    assert partition.origin == "administrative"
    assert partition.selected_listing_ids == [str(moved_listing.pk)]
    assert partition.evaluation_snapshot["scoring_version"]
    assert partition.before_revision == reviewed["partition_revision"]
    assert partition.after_revision != partition.before_revision
    suppression = PropertyMatchSuggestion.objects.get(
        left_id=min(source_property.pk, destination.pk),
        right_id=max(source_property.pk, destination.pk),
    )
    assert suppression.state == "rejected"
    assert suppression.suppressed_evidence_fingerprint == suppression.evidence_fingerprint


@pytest.mark.django_db
def test_administrative_listing_reassignment_restores_a_compatible_historical_property(
    admin_grouping_case,
):
    actor, source_property, historical, _, moved_listing = admin_grouping_case
    merge_properties(target=source_property, duplicate=historical, reason="گروه‌بندی قدیمی")
    reviewed = administrative_partition_preview(
        actor=actor, listing=moved_listing, destination_id=historical.pk
    )

    partition = administrative_reassign_listing(
        actor=actor,
        listing_id=moved_listing.pk,
        destination_id=historical.pk,
        reviewed_revision=reviewed["revision"],
    )

    moved_listing.refresh_from_db()
    historical.refresh_from_db()
    assert moved_listing.property_id == historical.pk
    assert historical.merged_into_id is None
    assert partition.restored_historical_property is True
    assert partition.origin == "administrative"
    assert PropertyPartitionDecision.objects.count() == 1


@pytest.mark.django_db
def test_administrative_reassignment_is_bound_to_reviewed_destination(admin_grouping_case):
    actor, source_property, historical, _, moved_listing = admin_grouping_case
    merge_properties(target=source_property, duplicate=historical, reason="گروه‌بندی قدیمی")
    reviewed_destination, _ = make_property(moved_listing.source, "REVIEWED")
    substituted_destination, _ = make_property(moved_listing.source, "SUBSTITUTED")
    reviewed = administrative_partition_preview(
        actor=actor,
        listing=moved_listing,
        destination_id=reviewed_destination.pk,
    )

    with pytest.raises(ValidationError, match="تغییر کرده"):
        administrative_reassign_listing(
            actor=actor,
            listing_id=moved_listing.pk,
            destination_id=substituted_destination.pk,
            reviewed_revision=reviewed["revision"],
        )

    moved_listing.refresh_from_db()
    assert moved_listing.property_id == source_property.pk
    assert not PropertyPartitionDecision.objects.exists()


@pytest.mark.django_db
def test_administrative_reassignment_rejects_changed_destination_evidence(admin_grouping_case):
    actor, source_property, historical, _, moved_listing = admin_grouping_case
    merge_properties(target=source_property, duplicate=historical, reason="گروه‌بندی قدیمی")
    destination, _ = make_property(moved_listing.source, "DESTINATION")
    reviewed = administrative_partition_preview(
        actor=actor,
        listing=moved_listing,
        destination_id=destination.pk,
    )
    destination.area_sqm += 1
    destination.save(update_fields=["area_sqm"])

    with pytest.raises(ValidationError, match="تغییر کرده"):
        administrative_reassign_listing(
            actor=actor,
            listing_id=moved_listing.pk,
            destination_id=destination.pk,
            reviewed_revision=reviewed["revision"],
        )

    moved_listing.refresh_from_db()
    assert moved_listing.property_id == source_property.pk
    assert not PropertyPartitionDecision.objects.exists()


@pytest.mark.django_db
def test_catalog_curator_cannot_invoke_superuser_break_glass_service(admin_grouping_case):
    from tests.test_grouped_property_consistency import make_operator

    _, survivor, redundant, *_ = admin_grouping_case
    curator = make_operator()
    reviewed = comparison_data([survivor.pk, redundant.pk])

    with pytest.raises(ValidationError, match="ابرکاربر"):
        administrative_merge(
            actor=curator,
            survivor_id=survivor.pk,
            redundant_id=redundant.pk,
            reviewed_revision=reviewed["revision"],
        )


@pytest.mark.django_db(transaction=True)
def test_administrative_reassignment_rolls_back_on_postgresql_storage_failure(
    admin_grouping_case,
):
    from django.db import ProgrammingError, connection

    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL transaction contract")
    actor, source_property, historical, _, moved_listing = admin_grouping_case
    merge_properties(target=source_property, duplicate=historical, reason="گروه‌بندی قدیمی")
    destination, _ = make_property(moved_listing.source, "DESTINATION", area_sqm=95)
    reviewed = administrative_partition_preview(
        actor=actor, listing=moved_listing, destination_id=destination.pk
    )
    with connection.cursor() as cursor:
        cursor.execute(
            "CREATE FUNCTION pg_temp.reject_admin_partition() RETURNS trigger "
            "LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'admin partition failure'; END $$"
        )
        cursor.execute(
            "CREATE TRIGGER test_reject_admin_partition BEFORE INSERT "
            "ON catalog_listinggroupingevent FOR EACH ROW "
            "EXECUTE FUNCTION pg_temp.reject_admin_partition()"
        )
    try:
        with pytest.raises(ProgrammingError, match="admin partition failure"):
            administrative_reassign_listing(
                actor=actor,
                listing_id=moved_listing.pk,
                destination_id=destination.pk,
                reviewed_revision=reviewed["revision"],
            )
    finally:
        with connection.cursor() as cursor:
            cursor.execute(
                "DROP TRIGGER test_reject_admin_partition ON catalog_listinggroupingevent"
            )
    moved_listing.refresh_from_db()
    assert moved_listing.property_id == source_property.pk
    assert not PropertyPartitionDecision.objects.exists()


@pytest.mark.django_db(transaction=True)
def test_administrative_merge_rolls_back_on_postgresql_storage_failure(admin_grouping_case):
    from django.db import ProgrammingError, connection

    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL transaction contract")
    actor, survivor, redundant, _, redundant_listing = admin_grouping_case
    Favorite.objects.create(account=actor, property=survivor)
    Favorite.objects.create(account=actor, property=redundant)
    reviewed = comparison_data([survivor.pk, redundant.pk])
    with connection.cursor() as cursor:
        cursor.execute(
            "CREATE FUNCTION pg_temp.reject_admin_merge() RETURNS trigger "
            "LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'admin merge failure'; END $$"
        )
        cursor.execute(
            "CREATE TRIGGER test_reject_admin_merge BEFORE INSERT "
            "ON catalog_listinggroupingevent FOR EACH ROW "
            "EXECUTE FUNCTION pg_temp.reject_admin_merge()"
        )
    try:
        with pytest.raises(ProgrammingError, match="admin merge failure"):
            administrative_merge(
                actor=actor,
                survivor_id=survivor.pk,
                redundant_id=redundant.pk,
                reviewed_revision=reviewed["revision"],
            )
    finally:
        with connection.cursor() as cursor:
            cursor.execute("DROP TRIGGER test_reject_admin_merge ON catalog_listinggroupingevent")
    redundant.refresh_from_db()
    redundant_listing.refresh_from_db()
    assert redundant.merged_into_id is None
    assert redundant_listing.property_id == redundant.pk
    assert Favorite.objects.filter(property=survivor).count() == 1
    assert Favorite.objects.filter(property=redundant).count() == 1
    assert not PropertyMatchDecision.objects.exists()

"""Enforce cross-table publication rules, including writes outside Django services.

Authority is checked at publication, not forever: revocation and account deletion
must still be able to retain historical Listings and approval records.
"""

from django.db import migrations

APPROVED_ASSIGNMENT = """
    SELECT 1 FROM source_proposals_sourceassignment a
    JOIN source_proposals_sourceproposal p ON p.id = a.proposal_id
    JOIN source_proposals_sourceprofiledecision d ON d.id = a.approval_id
    JOIN source_proposals_sourceproposalevent e ON e.id = d.event_id
    JOIN source_proposals_sourceprofileversion v ON v.id = d.version_id
    JOIN source_proposals_sourceprofile f ON f.id = v.profile_id
    WHERE a.source_id = {source_id} AND a.revoked_at IS NULL
      AND a.representative_id IS NOT NULL AND p.submitter_id = a.representative_id
      AND p.source_id = a.source_id AND d.representative_id = a.representative_id
      AND e.proposal_id = p.id AND e.new_state = 'approved'
      AND (e.actor_id IS NULL OR e.actor_id <> a.representative_id)
      AND f.source_id = a.source_id AND f.active_version_id = v.id
"""


def install(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor not in ("postgresql", "sqlite"):
        raise RuntimeError("Listing authority guards require PostgreSQL or SQLite")
    approved = APPROVED_ASSIGNMENT.format(source_id="l.source_id")
    with connection.cursor() as cursor:
        cursor.execute(f"""
            SELECT COUNT(*) FROM catalog_listing l
            JOIN catalog_source s ON s.id = l.source_id
            WHERE s.outbound_policy = 'external_link' AND l.state = 'published'
              AND NOT EXISTS ({approved})
        """)
        if cursor.fetchone()[0]:
            raise RuntimeError(
                "Published External Listings lack approved Source Assignments. "
                "Approve their Sources or withdraw the Listings before retrying. "
                "For development fixtures, run seed_dev with the new code first."
            )

    approved = APPROVED_ASSIGNMENT.format(source_id="NEW.source_id")
    listing_condition = f"""
        EXISTS (SELECT 1 FROM catalog_source s WHERE s.id = NEW.source_id
                    AND s.outbound_policy = 'external_link')
        AND ((NEW.state = 'published' AND NOT EXISTS ({approved}))
             OR EXISTS (SELECT 1 FROM submissions_submission sub WHERE sub.listing_id = NEW.id))
    """
    submission_condition = """
        EXISTS (SELECT 1 FROM catalog_source s WHERE s.id = NEW.source_id
                AND s.outbound_policy = 'external_link')
        OR EXISTS (SELECT 1 FROM catalog_listing l JOIN catalog_source s ON s.id = l.source_id
                   WHERE l.id = NEW.listing_id AND s.outbound_policy = 'external_link')
    """
    # Reclassifying a Source must not bypass the Listing/Submission guards.
    approved_source = APPROVED_ASSIGNMENT.format(source_id="NEW.id")
    source_condition = f"""
        NEW.outbound_policy = 'external_link' AND (
            EXISTS (SELECT 1 FROM submissions_submission sub
                    LEFT JOIN catalog_listing l ON l.id = sub.listing_id
                    WHERE sub.source_id = NEW.id OR l.source_id = NEW.id)
            OR (EXISTS (SELECT 1 FROM catalog_listing l
                        WHERE l.source_id = NEW.id AND l.state = 'published')
                AND NOT EXISTS ({approved_source}))
        )
    """
    guards = (
        (
            "catalog_listing",
            "listing_publication_authority",
            "state, source_id",
            listing_condition,
            "External Listing publication requires an approved Source Assignment",
        ),
        (
            "submissions_submission",
            "submission_direct_source",
            "source_id, listing_id",
            submission_condition,
            "A Submission cannot reference an External Listing or Source",
        ),
        (
            "catalog_source",
            "source_external_authority",
            "outbound_policy",
            source_condition,
            "External Source requires approval and cannot belong to a direct Submission",
        ),
    )
    for table, name, columns, condition, message in guards:
        if connection.vendor == "postgresql":
            lock = (
                """IF NEW.state = 'published' THEN
                       PERFORM 1 FROM catalog_source
                       WHERE id = NEW.source_id AND outbound_policy = 'external_link' FOR UPDATE;
                   END IF;"""
                if table == "catalog_listing"
                else ""
            )
            schema_editor.execute(f"""
                CREATE FUNCTION {name}() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    {lock}
                    IF {condition} THEN
                        RAISE EXCEPTION '{message}' USING ERRCODE = '23514';
                    END IF;
                    RETURN NEW;
                END $$;
                CREATE TRIGGER {name} BEFORE INSERT OR UPDATE OF {columns}
                ON {table} FOR EACH ROW EXECUTE FUNCTION {name}();
            """)
        else:
            for event, suffix in (("INSERT", "insert"), (f"UPDATE OF {columns}", "update")):
                schema_editor.execute(f"""
                    CREATE TRIGGER {name}_{suffix} BEFORE {event} ON {table}
                    FOR EACH ROW WHEN {condition}
                    BEGIN SELECT RAISE(ABORT, '{message}'); END;
                """)


def uninstall(apps, schema_editor):
    for table, name in (
        ("catalog_listing", "listing_publication_authority"),
        ("submissions_submission", "submission_direct_source"),
        ("catalog_source", "source_external_authority"),
    ):
        if schema_editor.connection.vendor == "postgresql":
            schema_editor.execute(f"DROP TRIGGER {name} ON {table}; DROP FUNCTION {name}();")
        else:
            for suffix in ("insert", "update"):
                schema_editor.execute(f"DROP TRIGGER {name}_{suffix};")


class Migration(migrations.Migration):
    dependencies = [
        ("source_proposals", "0001_initial"),
        ("catalog", "0001_initial"),
        ("submissions", "0001_initial"),
    ]
    operations = [migrations.RunPython(install, uninstall)]

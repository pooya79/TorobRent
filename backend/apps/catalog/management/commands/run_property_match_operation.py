import uuid
from argparse import ArgumentParser
from typing import Any

from django.core.management.base import BaseCommand

from apps.catalog.models import PropertyMatchOperation
from apps.catalog.tasks import backfill_property_matching, rescore_property_matching


class Command(BaseCommand):
    help = "Start or resume a bounded catalog matching backfill or scoring-version rescore."

    def add_arguments(self, parser: ArgumentParser) -> None:
        parser.add_argument("kind", choices=("backfill", "rescore"))
        parser.add_argument("--operation-id", default=None)
        parser.add_argument("--limit", type=int, default=100)

    def handle(self, *args: Any, **options: Any) -> None:
        operation_id = str(options["operation_id"] or uuid.uuid4())
        limit = options["limit"]
        if limit < 1 or limit > 500:
            raise ValueError("limit must be between 1 and 500")
        task = (
            backfill_property_matching
            if options["kind"] == "backfill"
            else rescore_property_matching
        )
        generation = (
            PropertyMatchOperation.objects
            .filter(pk=operation_id)
            .values_list("generation", flat=True)
            .first()
            or 0
        )
        task.delay(operation_id=operation_id, limit=limit, generation=generation)
        self.stdout.write(operation_id)

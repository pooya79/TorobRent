from pathlib import Path
from typing import cast

from django.core.management.base import BaseCommand, CommandParser

from apps.catalog.taxonomy_codegen import render_property_taxonomy_module


class Command(BaseCommand):
    help = "Generate the frontend Property taxonomy from the catalog domain mapping"

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--output", type=Path, required=True)

    def handle(self, *_args: object, **options: object) -> None:
        output = cast(Path, options["output"])
        output.write_text(render_property_taxonomy_module(), encoding="utf-8")
        self.stdout.write(str(output))

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.system.development_seed import seed_development_data


class Command(BaseCommand):
    help = "Create or refresh deterministic TorobRent development data"

    def handle(self, *_args: object, **_options: object) -> None:
        if not settings.DEBUG and settings.SETTINGS_MODULE != "config.settings.test":
            raise CommandError("seed_dev is available only with development or test settings")
        result = seed_development_data()
        self.stdout.write(
            self.style.SUCCESS(
                f"Development data ready: {result.properties} Properties, "
                f"{result.listings} Listings"
            )
        )

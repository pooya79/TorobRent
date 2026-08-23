from django.core.management.base import BaseCommand

from apps.system.demo import seed_demo


class Command(BaseCommand):
    help = "Create or refresh deterministic local TorobRent demonstration data"

    def handle(self, *_args: object, **_options: object) -> None:
        result = seed_demo()
        self.stdout.write(
            self.style.SUCCESS(
                f"Demo ready: {result.properties} Properties, {result.listings} Listings"
            )
        )

from django.apps import AppConfig


class CatalogConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.catalog"

    def ready(self) -> None:
        from . import group_consistency_signals, match_suggestion_signals, signals  # noqa: F401

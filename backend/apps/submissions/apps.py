from django.apps import AppConfig


class SubmissionsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.submissions"

    def ready(self) -> None:
        from . import signals  # noqa: F401

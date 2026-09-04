from django.apps import AppConfig


class CommunicationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.communications"

    def ready(self) -> None:
        from . import signals  # noqa: F401

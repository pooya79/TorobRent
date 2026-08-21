from django.apps import AppConfig


class CommonConfig(AppConfig):
    name = "apps.common"

    def ready(self) -> None:
        import apps.common.schema  # noqa: F401

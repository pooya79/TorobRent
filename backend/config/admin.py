from django.conf import settings
from django.http import HttpRequest


def environment_callback(_request: HttpRequest) -> tuple[str, str]:
    if settings.DEBUG:
        return ("Development", "warning")
    return ("Production", "danger")

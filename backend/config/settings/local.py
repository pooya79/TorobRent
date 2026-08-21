from .base import *  # noqa: F403

DEBUG = True
MAILERS = {"default": {"BACKEND": "django.core.mail.backends.console.EmailBackend"}}
SPECTACULAR_SETTINGS["SERVE_PERMISSIONS"] = [  # noqa: F405
    "rest_framework.permissions.AllowAny"
]

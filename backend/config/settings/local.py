from .base import *  # noqa: F403

DEBUG = True
DEVELOPMENT_OTP_DISCLOSURE = True
SPECTACULAR_SETTINGS["SERVE_PERMISSIONS"] = [  # noqa: F405
    "rest_framework.permissions.AllowAny"
]

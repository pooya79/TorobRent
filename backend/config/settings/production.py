from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403
from .base import build_mailer_config

required_names = (
    "DJANGO_SECRET_KEY",
    "ALLOWED_HOSTS",
    "CSRF_TRUSTED_ORIGINS",
    "DATABASE_URL",
    "REDIS_URL",
)
for name in required_names:
    value = env(name, default="")  # noqa: F405
    if not value or value == "unsafe-local-only-change-me":
        raise ImproperlyConfigured(f"{name} must be configured in production")

DEBUG = False
MAILERS = build_mailer_config("django.core.mail.backends.smtp.EmailBackend")
DEVELOPMENT_OTP_DISCLOSURE = False
SMS_BACKEND = "apps.accounts.sms.WebhookSmsBackend"
for name in ("SMS_GATEWAY_URL", "SMS_GATEWAY_TOKEN"):
    if not globals()[name]:
        raise ImproperlyConfigured(f"{name} must be configured in production")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=True)  # noqa: F405
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=31536000)  # noqa: F405
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
X_FRAME_OPTIONS = "DENY"

SENTRY_DSN = env("SENTRY_DSN", default="")  # noqa: F405
if SENTRY_DSN:
    import sentry_sdk

    sentry_sdk.init(dsn=SENTRY_DSN, send_default_pii=False, traces_sample_rate=0.0)

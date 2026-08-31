from pathlib import Path

import environ

BACKEND_DIR = Path(__file__).resolve().parents[2]
ROOT_DIR = BACKEND_DIR.parent

env = environ.Env(
    DEBUG=(bool, False),
    DATABASE_URL=(str, "postgresql://app:app@localhost:5432/app"),
    REDIS_URL=(str, "redis://localhost:6379/0"),
)

SECRET_KEY = env("DJANGO_SECRET_KEY", default="unsafe-local-only-change-me")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "drf_spectacular",
    "drf_spectacular_sidecar",
    "apps.common",
    "apps.accounts",
    "apps.catalog",
    "apps.contact",
    "apps.source_proposals",
    "apps.submissions",
    "apps.system",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "apps.common.middleware.RequestIDMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

DATABASES = {"default": env.db_url("DATABASE_URL")}
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=0)
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": env("REDIS_URL"),
        "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
    }
}

AUTH_USER_MODEL = "accounts.User"
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BACKEND_DIR / "staticfiles"
MEDIA_ROOT = BACKEND_DIR / "media"
SUBMISSION_IMAGE_MAX_BYTES = env.int("SUBMISSION_IMAGE_MAX_BYTES", default=10 * 1024 * 1024)
SUBMISSION_ABANDONED_IMAGE_HOURS = env.int("SUBMISSION_ABANDONED_IMAGE_HOURS", default=24)
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_FAILURE_VIEW = "apps.common.csrf.csrf_failure"

REST_FRAMEWORK = {
    # nginx is the single trusted proxy and appends its caller to X-Forwarded-For.
    "NUM_PROXIES": 1,
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.common.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {
        "registration": "5/hour",
        "email_verification": "20/hour",
        "phone_verification": "20/hour",
        "phone_verification_request": "5/hour",
        "login": "10/minute",
        "password_reset_request": "5/hour",
        "password_reset_confirm": "10/hour",
        "contact": "5/hour",
    },
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "apps.common.pagination.StandardPageNumberPagination",
    "EXCEPTION_HANDLER": "apps.common.exceptions.problem_exception_handler",
    "PAGE_SIZE": 25,
}

SPECTACULAR_SETTINGS = {
    "TITLE": "TorobRent API",
    "DESCRIPTION": (
        "TorobRent — a smart rental search platform that aggregates, normalizes, and ranks "
        "property listings from multiple sources."
    ),
    "VERSION": "1.0.0",
    "OAS_VERSION": "3.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "ENUM_NAME_OVERRIDES": {
        "ExternalContactChannelEnum": "apps.contact.models.ExternalContactChannel.choices",
        "FeatureStateEnum": "apps.catalog.models.FeatureState.choices",
        "IdentityVerificationMethodEnum": (
            "apps.contact.models.IdentityVerificationMethod.choices"
        ),
        "IntakeKindEnum": "apps.contact.models.IntakeKind.choices",
        "OutboundPolicyEnum": "apps.catalog.models.OutboundPolicy.choices",
        "PropertyTypeEnum": "apps.catalog.models.PropertyType.choices",
        "PrivacyActionTypeEnum": "apps.contact.models.PrivacyActionType.choices",
        "SubmissionStateEnum": "apps.submissions.models.SubmissionState.choices",
        "SourceProposalInventoryRangeEnum": ("apps.source_proposals.models.InventoryRange.choices"),
        "SourceProposalRelationshipEnum": (
            "apps.source_proposals.models.SourceRepresentativeRelationship.choices"
        ),
        "SourceProposalStateEnum": "apps.source_proposals.models.SourceProposalState.choices",
        "SourceProposalStepEnum": "apps.source_proposals.models.SourceProposalStep.choices",
        "SupportClassificationEnum": "apps.contact.models.SupportClassification.choices",
        "SupportPriorityEnum": "apps.contact.models.SupportPriority.choices",
        "SupportRequiredCapabilityEnum": ("apps.contact.models.SupportRequiredCapability.choices"),
        "SupportRequestEventTypeEnum": "apps.contact.models.SupportRequestEventType.choices",
        "SupportRequestStatusEnum": "apps.contact.models.SupportRequestStatus.choices",
        "SupportResolutionCategoryEnum": ("apps.contact.models.SupportResolutionCategory.choices"),
    },
    "SWAGGER_UI_DIST": "SIDECAR",
    "SWAGGER_UI_FAVICON_HREF": "SIDECAR",
    "REDOC_DIST": "SIDECAR",
}

CELERY_BROKER_URL = env("REDIS_URL")
CELERY_RESULT_BACKEND = env("REDIS_URL")
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_TIME_LIMIT = 30 * 60
CELERY_TASK_SOFT_TIME_LIMIT = 25 * 60
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_BEAT_SCHEDULE = {
    "dispatch-pending-submission-decision-notifications": {
        "task": "apps.submissions.tasks.dispatch_pending_submission_decision_notifications",
        "schedule": 5 * 60,
    },
    "cleanup-abandoned-submission-images": {
        "task": "apps.submissions.tasks.cleanup_abandoned_submission_images",
        "schedule": 60 * 60,
    },
    "expire-due-listings": {
        "task": "apps.catalog.tasks.expire_due_listings",
        "schedule": 60 * 60,
    },
}


def build_mailer_config(default_backend: str) -> dict[str, dict[str, object]]:
    backend = env("EMAIL_BACKEND", default=default_backend)
    options: dict[str, object] = {}
    if backend == "django.core.mail.backends.smtp.EmailBackend":
        options = {
            "host": env("EMAIL_HOST", default="localhost"),
            "port": env.int("EMAIL_PORT", default=25),
            "username": env("EMAIL_HOST_USER", default=""),
            "password": env("EMAIL_HOST_PASSWORD", default=""),
            "use_tls": env.bool("EMAIL_USE_TLS", default=False),
        }
    return {"default": {"BACKEND": backend, "OPTIONS": options}}


MAILERS = build_mailer_config("django.core.mail.backends.console.EmailBackend")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="noreply@example.com")
FRONTEND_ORIGIN = env("FRONTEND_ORIGIN", default="http://localhost:5173")
EMAIL_VERIFICATION_TIMEOUT = 60 * 60 * 24
DEMO_OTP_DISCLOSURE = env.bool("DEMO_OTP_DISCLOSURE", default=False)
SMS_BACKEND = env("SMS_BACKEND", default="apps.accounts.sms.LocmemSmsBackend")
SMS_GATEWAY_URL = env("SMS_GATEWAY_URL", default="")
SMS_GATEWAY_TOKEN = env("SMS_GATEWAY_TOKEN", default="")
SMS_GATEWAY_TIMEOUT_SECONDS = env.int("SMS_GATEWAY_TIMEOUT_SECONDS", default=5)

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"json": {"()": "apps.common.logging.JSONFormatter"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "json"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", default="INFO")},
}

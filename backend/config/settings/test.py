from .base import *  # noqa: F403
from .base import env

SECRET_KEY = "test-secret-key"
DEBUG = False
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
STATIC_ROOT = None
WHITENOISE_USE_FINDERS = True
if env("TEST_DATABASE_URL", default=""):
    DATABASES = {"default": env.db_url("TEST_DATABASE_URL")}
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": ":memory:",
        }
    }
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
MAILERS = build_mailer_config("django.core.mail.backends.locmem.EmailBackend")  # noqa: F405
CELERY_TASK_ALWAYS_EAGER = True
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

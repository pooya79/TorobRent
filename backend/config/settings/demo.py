from .production import *  # noqa: F403

# The demo is intentionally HTTP-only and local. Production keeps secure cookies and HSTS.
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
SECURE_SSL_REDIRECT = False
SECURE_HSTS_SECONDS = 0
CELERY_WORKER_HIJACK_ROOT_LOGGER = False

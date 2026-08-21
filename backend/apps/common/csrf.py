from typing import Any

from django.http import JsonResponse


def csrf_failure(request: Any, reason: str = "") -> JsonResponse:
    request_id = getattr(request, "request_id", None)
    return JsonResponse(
        {
            "type": "https://example.com/problems/csrf_failed",
            "title": "CSRF verification failed",
            "status": 403,
            "detail": "The CSRF token is missing or invalid.",
            "code": "csrf_failed",
            "request_id": request_id,
        },
        status=403,
        content_type="application/problem+json",
    )

from collections.abc import Mapping, Sequence
from typing import Any

from rest_framework.response import Response
from rest_framework.views import exception_handler


def _field_errors(data: Any) -> dict[str, list[dict[str, str]]] | None:
    if not isinstance(data, Mapping):
        return None
    errors: dict[str, list[dict[str, str]]] = {}
    for field, values in data.items():
        items = values if isinstance(values, Sequence) and not isinstance(values, str) else [values]
        errors[str(field)] = [
            {
                "code": getattr(item, "code", "invalid"),
                "message": str(item),
            }
            for item in items
        ]
    return errors


def problem_exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    response = exception_handler(exc, context)
    if response is None:
        return None

    status_code = response.status_code
    field_errors = _field_errors(response.data) if status_code == 400 else None
    code = "validation_error" if field_errors else getattr(exc, "default_code", "api_error")
    title = {
        400: "Bad request",
        401: "Authentication required",
        403: "Permission denied",
        404: "Not found",
        405: "Method not allowed",
        429: "Too many requests",
    }.get(status_code, "Request failed")
    detail = title
    if isinstance(response.data, Mapping) and "detail" in response.data:
        detail = str(response.data["detail"])

    request = context.get("request")
    body: dict[str, Any] = {
        "type": f"https://example.com/problems/{code}",
        "title": title,
        "status": status_code,
        "detail": detail,
        "code": str(code),
        "request_id": getattr(request, "request_id", None),
    }
    if field_errors:
        body["errors"] = field_errors
    response.data = body
    response.content_type = "application/problem+json"
    return response

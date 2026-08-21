import uuid
from collections.abc import Awaitable, Callable
from contextvars import Token
from typing import cast

from asgiref.sync import iscoroutinefunction
from django.http import HttpRequest, HttpResponse
from django.utils.decorators import sync_and_async_middleware

from .request_context import request_id_context

REQUEST_ID_META_HEADER = "HTTP_X_REQUEST_ID"
ResponseHandler = Callable[[HttpRequest], HttpResponse]
AsyncResponseHandler = Callable[[HttpRequest], Awaitable[HttpResponse]]


def _set_request_id(request: HttpRequest) -> tuple[str, Token[str | None]]:
    incoming = request.META.get(REQUEST_ID_META_HEADER, "")
    try:
        request_id = str(uuid.UUID(incoming))
    except ValueError, AttributeError:
        request_id = str(uuid.uuid4())
    request.request_id = request_id  # type: ignore[attr-defined]
    return request_id, request_id_context.set(request_id)


@sync_and_async_middleware
def RequestIDMiddleware(  # noqa: N802
    get_response: ResponseHandler | AsyncResponseHandler,
) -> ResponseHandler | AsyncResponseHandler:
    """Attach a request ID without forcing ASGI requests through a sync adapter."""

    if iscoroutinefunction(get_response):
        async_get_response = cast(AsyncResponseHandler, get_response)

        async def async_middleware(request: HttpRequest) -> HttpResponse:
            request_id, token = _set_request_id(request)
            try:
                response = await async_get_response(request)
                response["X-Request-ID"] = request_id
                return response
            finally:
                request_id_context.reset(token)

        return async_middleware

    sync_get_response = cast(ResponseHandler, get_response)

    def middleware(request: HttpRequest) -> HttpResponse:
        request_id, token = _set_request_id(request)
        try:
            response = sync_get_response(request)
            response["X-Request-ID"] = request_id
            return response
        finally:
            request_id_context.reset(token)

    return middleware

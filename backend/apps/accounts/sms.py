import json
from dataclasses import dataclass
from typing import Protocol
from urllib.request import Request, urlopen

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.utils.module_loading import import_string


class SmsBackend(Protocol):
    def send_verification_code(self, *, recipient: str, code: str) -> None: ...


@dataclass(frozen=True)
class SmsMessage:
    recipient: str
    code: str


outbox: list[SmsMessage] = []


class LocmemSmsBackend:
    """Test/demo backend; production selects the webhook backend explicitly."""

    def send_verification_code(self, *, recipient: str, code: str) -> None:
        outbox.append(SmsMessage(recipient=recipient, code=code))


class WebhookSmsBackend:
    """Deliver an OTP to a provider-neutral JSON webhook."""

    def send_verification_code(self, *, recipient: str, code: str) -> None:
        if not settings.SMS_GATEWAY_URL or not settings.SMS_GATEWAY_TOKEN:
            raise ImproperlyConfigured("SMS gateway URL and token must be configured.")
        request = Request(
            settings.SMS_GATEWAY_URL,
            data=json.dumps({"recipient": recipient, "code": code}).encode(),
            headers={
                "Authorization": f"Bearer {settings.SMS_GATEWAY_TOKEN}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urlopen(request, timeout=settings.SMS_GATEWAY_TIMEOUT_SECONDS) as response:
            if not 200 <= response.status < 300:
                raise OSError("The SMS gateway did not accept the verification message.")


def send_verification_code(*, recipient: str, code: str) -> None:
    backend_class = import_string(settings.SMS_BACKEND)
    backend: SmsBackend = backend_class()
    backend.send_verification_code(recipient=recipient, code=code)

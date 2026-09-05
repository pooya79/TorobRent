from __future__ import annotations

import http.client
import ipaddress
import os
import queue
import shutil
import socket
import ssl
import threading
import time
import urllib.robotparser
from collections.abc import Callable, Iterator, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, suppress
from dataclasses import dataclass, field, replace
from enum import StrEnum
from functools import partial
from typing import Protocol, cast
from urllib.parse import urljoin, urlsplit, urlunsplit

from playwright.sync_api import (
    Route,
    WebSocketRoute,
    sync_playwright,
)
from playwright.sync_api import (
    TimeoutError as PlaywrightTimeoutError,
)

MAX_REDIRECTS = 5
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_PAGES = 50
MAX_CONCURRENCY = 4
MAX_BROWSER_RESOURCES = 100
REQUEST_TIMEOUT_SECONDS = 15.0
USER_AGENT = "TorobRentSourceFetcher"


class FetchFailureCode(StrEnum):
    INVALID_SCHEME = "invalid_scheme"
    INVALID_URL = "invalid_url"
    CREDENTIALS = "credentials"
    IP_LITERAL = "ip_literal"
    HOST_NOT_APPROVED = "host_not_approved"
    DNS_FAILURE = "dns_failure"
    NON_PUBLIC_ADDRESS = "non_public_address"
    REDIRECT_LIMIT = "redirect_limit"
    ROBOTS_DENIED = "robots_denied"
    PAGE_LIMIT = "page_limit"
    RESPONSE_TOO_LARGE = "response_too_large"
    TIMEOUT = "timeout"
    TRANSPORT_ERROR = "transport_error"
    BROWSER_RESOURCE_LIMIT = "browser_resource_limit"
    BROWSER_ERROR = "browser_error"


class RobotsDecisionReason(StrEnum):
    ALLOWED_BY_RULES = "allowed_by_rules"
    DISALLOWED_BY_RULES = "disallowed_by_rules"
    ROBOTS_NOT_FOUND = "robots_not_found"
    ROBOTS_ACCESS_DENIED = "robots_access_denied"
    ROBOTS_FETCH_FAILED = "robots_fetch_failed"
    ROBOTS_HTTP_ERROR = "robots_http_error"


@dataclass(frozen=True, slots=True)
class FetchFailure:
    code: FetchFailureCode
    url: str
    detail: str
    transient: bool = False


@dataclass(frozen=True, slots=True)
class FetchedPage:
    url: str
    status_code: int
    body: bytes
    headers: Mapping[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RobotsEvidence:
    robots_url: str
    allowed: bool
    reason: RobotsDecisionReason


@dataclass(frozen=True, slots=True)
class BrowserEvidence:
    requested_resources: tuple[str, ...]
    blocked_resources: tuple[FetchFailure, ...]


@dataclass(frozen=True, slots=True)
class FetchRecord:
    requested_url: str
    page: FetchedPage | None = None
    failure: FetchFailure | None = None
    robots: RobotsEvidence | None = None
    browser: BrowserEvidence | None = None


@dataclass(frozen=True, slots=True)
class FetchBatch:
    records: tuple[FetchRecord, ...]


@dataclass(frozen=True, slots=True)
class NetworkRequest:
    url: str
    connect_ip: str
    host: str
    port: int
    timeout_seconds: float
    max_response_bytes: int


@dataclass(frozen=True, slots=True)
class RawResponse:
    status_code: int
    headers: dict[str, str]
    body: bytes


@dataclass(frozen=True, slots=True)
class BrowserDocument:
    url: str
    status_code: int
    body: bytes
    headers: Mapping[str, str] = field(default_factory=dict)


class HttpTransport(Protocol):
    def get(self, request: NetworkRequest) -> RawResponse: ...


Resolver = Callable[[str, int], Sequence[str]]
BrowserResourceLoader = Callable[[str], FetchRecord]
RedirectGuard = Callable[[str], FetchFailure | None]


class BrowserRenderer(Protocol):
    """A network-isolated renderer whose only resource access is the supplied loader.

    Implementations must disable native browser networking and service workers, fulfill or abort
    every browser request through ``load_resource``, and enforce ``timeout_seconds`` as a wall-clock
    deadline. The Source fetching module treats that behavior as part of this interface.
    """

    def render(
        self,
        document: BrowserDocument,
        *,
        load_resource: BrowserResourceLoader,
        timeout_seconds: float,
    ) -> bytes: ...


class TransportFailure(Exception):
    """A failure attributable to the outbound HTTP connection."""


class TransportTimeout(TransportFailure):
    pass


class ResponseTooLarge(TransportFailure):
    pass


class OperationTimeout(Exception):
    pass


@dataclass(frozen=True, slots=True)
class _CompletedOperation[OperationResult]:
    value: OperationResult | None = None
    error: Exception | None = None


class PinnedHttpTransport:
    """Perform HTTP requests on an already authorized, IP-pinned socket."""

    def __init__(self, *, ssl_context: ssl.SSLContext | None = None) -> None:
        self._ssl_context = ssl_context or ssl.create_default_context()

    def get(self, request: NetworkRequest) -> RawResponse:
        deadline = time.monotonic() + request.timeout_seconds
        parsed = urlsplit(request.url)
        target = parsed.path or "/"
        if parsed.query:
            target = f"{target}?{parsed.query}"
        connection = http.client.HTTPConnection(
            request.host, request.port, timeout=request.timeout_seconds
        )
        deadline_expired = threading.Event()
        deadline_timer: threading.Timer | None = None
        raw_socket: socket.socket | None = None
        try:
            raw_socket = socket.create_connection(
                (request.connect_ip, request.port), timeout=request.timeout_seconds
            )
            remaining_seconds = deadline - time.monotonic()
            if remaining_seconds <= 0:
                raise TransportTimeout("HTTP request timed out.")

            def expire_connection() -> None:
                deadline_expired.set()
                if raw_socket is None:
                    return
                with suppress(OSError, AttributeError):
                    raw_socket.shutdown(socket.SHUT_RDWR)
                    raw_socket.close()

            deadline_timer = threading.Timer(remaining_seconds, expire_connection)
            deadline_timer.daemon = True
            deadline_timer.start()
            if parsed.scheme.lower() == "https":
                raw_socket = self._ssl_context.wrap_socket(raw_socket, server_hostname=request.host)
            connection.sock = raw_socket
            default_port = 443 if parsed.scheme.lower() == "https" else 80
            host_header = (
                request.host if request.port == default_port else f"{request.host}:{request.port}"
            )
            connection.request(
                "GET",
                target,
                headers={
                    "Host": host_header,
                    "User-Agent": USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
                    "Connection": "close",
                },
            )
            response = connection.getresponse()
            body = response.read(request.max_response_bytes + 1)
            if deadline_expired.is_set() or time.monotonic() >= deadline:
                raise TransportTimeout("HTTP request timed out.")
            if len(body) > request.max_response_bytes:
                raise ResponseTooLarge(
                    f"Response exceeded the {request.max_response_bytes}-byte limit."
                )
            return RawResponse(
                status_code=response.status,
                headers={key: value for key, value in response.getheaders()},
                body=body,
            )
        except ResponseTooLarge, TransportTimeout:
            raise
        except TimeoutError as exc:
            raise TransportTimeout("HTTP request timed out.") from exc
        except (OSError, http.client.HTTPException) as exc:
            if deadline_expired.is_set():
                raise TransportTimeout("HTTP request timed out.") from exc
            raise TransportFailure(str(exc)) from exc
        finally:
            if deadline_timer is not None:
                deadline_timer.cancel()
            connection.close()


class PlaywrightBrowserRenderer:
    """Render with native browser networking fully intercepted by the guarded loader."""

    def __init__(self, *, executable_path: str | None = None) -> None:
        self._executable_path = (
            executable_path
            or os.getenv("TOROBRENT_CHROMIUM_PATH")
            or next(
                (
                    path
                    for binary in (
                        "google-chrome",
                        "google-chrome-stable",
                        "chromium",
                        "chromium-browser",
                    )
                    if (path := shutil.which(binary))
                ),
                None,
            )
        )

    def render(
        self,
        document: BrowserDocument,
        *,
        load_resource: BrowserResourceLoader,
        timeout_seconds: float,
    ) -> bytes:
        timeout_ms = max(1, int(timeout_seconds * 1000))
        try:
            with _reserved_dead_proxy_port() as dead_proxy_port, sync_playwright() as playwright:
                launch_args = [
                    "--disable-background-networking",
                    "--disable-component-update",
                    "--disable-default-apps",
                    "--disable-sync",
                    "--dns-prefetch-disable",
                    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                    "--no-first-run",
                    "--webrtc-ip-handling-policy=disable_non_proxied_udp",
                ]
                if self._executable_path:
                    browser = playwright.chromium.launch(
                        headless=True,
                        executable_path=self._executable_path,
                        args=launch_args,
                        proxy={
                            "server": f"http://127.0.0.1:{dead_proxy_port}",
                            "bypass": "<-loopback>",
                        },
                    )
                else:
                    browser = playwright.chromium.launch(
                        headless=True,
                        args=launch_args,
                        proxy={
                            "server": f"http://127.0.0.1:{dead_proxy_port}",
                            "bypass": "<-loopback>",
                        },
                    )
                context = browser.new_context(
                    accept_downloads=False,
                    offline=True,
                    service_workers="block",
                )
                initial_document_pending = True

                def handle_route(route: Route) -> None:
                    nonlocal initial_document_pending
                    request = route.request
                    if (
                        initial_document_pending
                        and request.is_navigation_request()
                        and _without_fragment(request.url) == _without_fragment(document.url)
                    ):
                        initial_document_pending = False
                        route.fulfill(
                            status=document.status_code,
                            headers=dict(document.headers),
                            body=document.body,
                        )
                        return
                    resource = load_resource(request.url)
                    if resource.failure or resource.page is None:
                        route.abort("blockedbyclient")
                        return
                    route.fulfill(
                        status=resource.page.status_code,
                        headers=dict(resource.page.headers),
                        body=resource.page.body,
                    )

                def block_web_socket(web_socket: WebSocketRoute) -> None:
                    load_resource(web_socket.url)
                    web_socket.close(code=1008, reason="Network access is blocked")

                context.route("**/*", handle_route)
                context.route_web_socket("**/*", block_web_socket)
                page = context.new_page()
                try:
                    page.goto(document.url, wait_until="networkidle", timeout=timeout_ms)
                    return page.content().encode("utf-8")
                finally:
                    context.close()
                    browser.close()
        except PlaywrightTimeoutError as exc:
            raise OperationTimeout("Browser rendering exceeded its wall-clock deadline.") from exc
        except OperationTimeout:
            raise
        except Exception as exc:
            raise RuntimeError(f"Browser rendering failed: {exc}") from exc


class SourcePageFetcher:
    """Fetch approved Source URLs, using browser rendering only when the caller requests it."""

    def __init__(
        self,
        *,
        approved_host: str,
        transport: HttpTransport | None = None,
        resolver: Resolver | None = None,
        browser: BrowserRenderer | None = None,
    ) -> None:
        self._approved_host = _normalize_host(approved_host)
        self._transport = transport or PinnedHttpTransport()
        self._resolver = resolver or resolve_addresses
        self._browser = browser or PlaywrightBrowserRenderer()
        self._connection_slots = threading.BoundedSemaphore(MAX_CONCURRENCY)
        self._resolver_slots = threading.BoundedSemaphore(MAX_CONCURRENCY)
        self._browser_slots = threading.BoundedSemaphore(MAX_CONCURRENCY)

    def fetch(self, urls: Sequence[str], *, render: bool = False) -> FetchBatch:
        records: list[FetchRecord | None] = [None] * len(urls)
        validations: dict[int, FetchFailure | None] = {}
        for index, url in enumerate(urls):
            if index >= MAX_PAGES:
                records[index] = FetchRecord(
                    requested_url=url,
                    failure=FetchFailure(
                        FetchFailureCode.PAGE_LIMIT,
                        url,
                        f"Batch exceeded the {MAX_PAGES}-page limit.",
                    ),
                )
            else:
                validations[index] = self._validate_url(url)

        robots_by_origin: dict[
            str, tuple[urllib.robotparser.RobotFileParser | None, FetchRecord]
        ] = {}
        robots_lock = threading.Lock()

        def robots_for(url: str) -> tuple[urllib.robotparser.RobotFileParser | None, FetchRecord]:
            origin = _origin(url)
            with robots_lock:
                cached_robots = robots_by_origin.get(origin)
            if cached_robots is not None:
                return cached_robots
            robots_url = f"{origin}/robots.txt"
            robots_record = self._fetch_url(robots_url)
            fetched_robots = (_robots_parser(robots_url, robots_record), robots_record)
            with robots_lock:
                return robots_by_origin.setdefault(origin, fetched_robots)

        for index, failure in validations.items():
            url = urls[index]
            if failure:
                continue
            robots_for(url)

        allowed_records: list[tuple[int, str, RobotsEvidence]] = []
        for index, failure in validations.items():
            url = urls[index]
            if failure:
                records[index] = FetchRecord(requested_url=url, failure=failure)
                continue
            parser, robots_record = robots_for(url)
            robots_url = robots_record.requested_url
            if robots_record.failure:
                evidence = RobotsEvidence(
                    robots_url, False, RobotsDecisionReason.ROBOTS_FETCH_FAILED
                )
                records[index] = FetchRecord(
                    requested_url=url, failure=robots_record.failure, robots=evidence
                )
                continue
            allowed, reason = _robots_decision(parser, robots_record.page, url)
            evidence = RobotsEvidence(robots_url, allowed, reason)
            if not allowed:
                records[index] = FetchRecord(
                    requested_url=url,
                    failure=FetchFailure(
                        FetchFailureCode.ROBOTS_DENIED,
                        url,
                        "The Source robots policy disallows this URL.",
                    ),
                    robots=evidence,
                )
                continue
            allowed_records.append((index, url, evidence))

        def fetch_allowed(item: tuple[int, str, RobotsEvidence]) -> tuple[int, FetchRecord]:
            index, url, evidence = item
            redirect_evidence = evidence

            def guard_redirect(redirect_url: str) -> FetchFailure | None:
                nonlocal redirect_evidence
                parser, robots_record = robots_for(redirect_url)
                robots_url = robots_record.requested_url
                if robots_record.failure:
                    redirect_evidence = RobotsEvidence(
                        robots_url, False, RobotsDecisionReason.ROBOTS_FETCH_FAILED
                    )
                    return robots_record.failure
                allowed, reason = _robots_decision(parser, robots_record.page, redirect_url)
                redirect_evidence = RobotsEvidence(robots_url, allowed, reason)
                if allowed:
                    return None
                return FetchFailure(
                    FetchFailureCode.ROBOTS_DENIED,
                    redirect_url,
                    "The Source robots policy disallows this URL.",
                )

            record = replace(
                self._fetch_url(url, redirect_guard=guard_redirect),
                robots=redirect_evidence,
            )
            return index, self._render(record) if render else record

        with ThreadPoolExecutor(max_workers=MAX_CONCURRENCY) as executor:
            for index, record in executor.map(fetch_allowed, allowed_records):
                records[index] = record

        return FetchBatch(records=tuple(record for record in records if record is not None))

    def _render(self, record: FetchRecord) -> FetchRecord:
        if record.failure or record.page is None:
            return record
        browser = self._browser
        page = record.page

        requested_resources: list[str] = []
        blocked_resources: list[FetchFailure] = []
        evidence_lock = threading.Lock()
        render_expired = threading.Event()

        def browser_evidence() -> BrowserEvidence:
            with evidence_lock:
                return BrowserEvidence(
                    requested_resources=tuple(requested_resources),
                    blocked_resources=tuple(blocked_resources),
                )

        def load_resource(url: str) -> FetchRecord:
            with evidence_lock:
                if render_expired.is_set():
                    failure = FetchFailure(
                        FetchFailureCode.TIMEOUT,
                        url,
                        "Browser rendering deadline has expired.",
                        transient=True,
                    )
                    blocked_resources.append(failure)
                    return FetchRecord(requested_url=url, failure=failure)
                if len(requested_resources) >= MAX_BROWSER_RESOURCES:
                    failure = FetchFailure(
                        FetchFailureCode.BROWSER_RESOURCE_LIMIT,
                        url,
                        f"Browser exceeded the {MAX_BROWSER_RESOURCES}-resource limit.",
                    )
                    blocked_resources.append(failure)
                    return FetchRecord(requested_url=url, failure=failure)
                requested_resources.append(url)
            resource = self._fetch_url(url)
            if resource.failure:
                with evidence_lock:
                    blocked_resources.append(resource.failure)
            return resource

        try:
            body = _run_with_deadline(
                lambda: browser.render(
                    BrowserDocument(page.url, page.status_code, page.body, page.headers),
                    load_resource=load_resource,
                    timeout_seconds=REQUEST_TIMEOUT_SECONDS,
                ),
                timeout_seconds=REQUEST_TIMEOUT_SECONDS,
                slots=self._browser_slots,
            )
        except OperationTimeout as exc:
            render_expired.set()
            return replace(
                record,
                page=None,
                failure=FetchFailure(
                    FetchFailureCode.TIMEOUT,
                    record.page.url,
                    str(exc),
                    transient=True,
                ),
                browser=browser_evidence(),
            )
        except Exception as exc:
            render_expired.set()
            return replace(
                record,
                page=None,
                failure=FetchFailure(
                    FetchFailureCode.BROWSER_ERROR,
                    record.page.url,
                    str(exc),
                    transient=True,
                ),
                browser=browser_evidence(),
            )
        evidence = browser_evidence()
        if len(body) > MAX_RESPONSE_BYTES:
            return replace(
                record,
                page=None,
                failure=FetchFailure(
                    FetchFailureCode.RESPONSE_TOO_LARGE,
                    record.page.url,
                    f"Rendered page exceeded the {MAX_RESPONSE_BYTES}-byte limit.",
                ),
                browser=evidence,
            )
        return replace(
            record,
            page=replace(record.page, body=body),
            browser=evidence,
        )

    def _fetch_url(
        self, requested_url: str, *, redirect_guard: RedirectGuard | None = None
    ) -> FetchRecord:
        current_url = requested_url
        for redirect_count in range(MAX_REDIRECTS + 1):
            failure = self._validate_url(current_url)
            if failure:
                return FetchRecord(requested_url=requested_url, failure=failure)
            parsed = urlsplit(current_url)
            host = _normalize_host(parsed.hostname or "")
            port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
            try:
                addresses = tuple(
                    _run_with_deadline(
                        partial(self._resolver, host, port),
                        timeout_seconds=REQUEST_TIMEOUT_SECONDS,
                        slots=self._resolver_slots,
                    )
                )
            except OperationTimeout as exc:
                return FetchRecord(
                    requested_url=requested_url,
                    failure=FetchFailure(
                        FetchFailureCode.TIMEOUT,
                        current_url,
                        str(exc),
                        transient=True,
                    ),
                )
            except Exception as exc:
                return FetchRecord(
                    requested_url=requested_url,
                    failure=FetchFailure(
                        FetchFailureCode.DNS_FAILURE,
                        current_url,
                        str(exc),
                        transient=True,
                    ),
                )
            if not addresses:
                return FetchRecord(
                    requested_url=requested_url,
                    failure=FetchFailure(
                        FetchFailureCode.DNS_FAILURE,
                        current_url,
                        "Host did not resolve to an address.",
                    ),
                )
            unsafe_address = next(
                (address for address in addresses if not _is_public_address(address)), None
            )
            if unsafe_address:
                return FetchRecord(
                    requested_url=requested_url,
                    failure=FetchFailure(
                        FetchFailureCode.NON_PUBLIC_ADDRESS,
                        current_url,
                        f"Host resolved to non-public address {unsafe_address}.",
                    ),
                )
            try:
                network_request = NetworkRequest(
                    url=current_url,
                    connect_ip=addresses[0],
                    host=host,
                    port=port,
                    timeout_seconds=REQUEST_TIMEOUT_SECONDS,
                    max_response_bytes=MAX_RESPONSE_BYTES,
                )
                response = _run_with_deadline(
                    partial(self._transport.get, network_request),
                    timeout_seconds=REQUEST_TIMEOUT_SECONDS,
                    slots=self._connection_slots,
                )
            except OperationTimeout as exc:
                return FetchRecord(
                    requested_url=requested_url,
                    failure=FetchFailure(
                        FetchFailureCode.TIMEOUT,
                        current_url,
                        str(exc),
                        transient=True,
                    ),
                )
            except TransportTimeout as exc:
                return FetchRecord(
                    requested_url=requested_url,
                    failure=FetchFailure(
                        FetchFailureCode.TIMEOUT,
                        current_url,
                        str(exc),
                        transient=True,
                    ),
                )
            except ResponseTooLarge as exc:
                return FetchRecord(
                    requested_url=requested_url,
                    failure=FetchFailure(
                        FetchFailureCode.RESPONSE_TOO_LARGE, current_url, str(exc)
                    ),
                )
            except Exception as exc:
                return FetchRecord(
                    requested_url=requested_url,
                    failure=FetchFailure(
                        FetchFailureCode.TRANSPORT_ERROR,
                        current_url,
                        str(exc),
                        transient=True,
                    ),
                )
            if len(response.body) > MAX_RESPONSE_BYTES:
                return FetchRecord(
                    requested_url=requested_url,
                    failure=FetchFailure(
                        FetchFailureCode.RESPONSE_TOO_LARGE,
                        current_url,
                        f"Response exceeded the {MAX_RESPONSE_BYTES}-byte limit.",
                    ),
                )
            location = _header(response.headers, "location")
            if response.status_code in {301, 302, 303, 307, 308} and location:
                if redirect_count == MAX_REDIRECTS:
                    return FetchRecord(
                        requested_url=requested_url,
                        failure=FetchFailure(
                            FetchFailureCode.REDIRECT_LIMIT,
                            current_url,
                            f"Response exceeded the {MAX_REDIRECTS}-redirect limit.",
                        ),
                    )
                redirect_url = urljoin(current_url, location)
                redirect_failure = self._validate_url(redirect_url)
                if redirect_failure is None and redirect_guard is not None:
                    redirect_failure = redirect_guard(redirect_url)
                if redirect_failure is not None:
                    return FetchRecord(requested_url=requested_url, failure=redirect_failure)
                current_url = redirect_url
                continue
            return FetchRecord(
                requested_url=requested_url,
                page=FetchedPage(
                    url=current_url,
                    status_code=response.status_code,
                    body=response.body,
                    headers=response.headers,
                ),
            )
        raise AssertionError("redirect loop must return")

    def _validate_url(self, url: str) -> FetchFailure | None:
        try:
            parsed = urlsplit(url)
            port = parsed.port
        except ValueError:
            return FetchFailure(FetchFailureCode.INVALID_URL, url, "URL is malformed.")
        if parsed.scheme.lower() not in {"http", "https"}:
            return FetchFailure(
                FetchFailureCode.INVALID_SCHEME, url, "Only HTTP and HTTPS URLs are allowed."
            )
        if parsed.username is not None or parsed.password is not None:
            return FetchFailure(FetchFailureCode.CREDENTIALS, url, "URL credentials are forbidden.")
        host = parsed.hostname
        if not host:
            return FetchFailure(FetchFailureCode.INVALID_URL, url, "URL must include a host.")
        if _is_ip_literal(host):
            return FetchFailure(FetchFailureCode.IP_LITERAL, url, "IP-literal URLs are forbidden.")
        try:
            normalized_host = _normalize_host(host)
        except UnicodeError:
            return FetchFailure(FetchFailureCode.INVALID_URL, url, "URL host is malformed.")
        if normalized_host != self._approved_host:
            return FetchFailure(
                FetchFailureCode.HOST_NOT_APPROVED,
                url,
                "URL host does not match the approved Source host.",
            )
        if port is not None and not 1 <= port <= 65535:
            return FetchFailure(FetchFailureCode.INVALID_URL, url, "URL port is invalid.")
        return None


def _normalize_host(host: str) -> str:
    return host.rstrip(".").encode("idna").decode("ascii").lower()


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def _is_public_address(address: str) -> bool:
    try:
        return ipaddress.ip_address(address).is_global
    except ValueError:
        return False


def _header(headers: dict[str, str], name: str) -> str | None:
    normalized_name = name.casefold()
    return next(
        (value for key, value in headers.items() if key.casefold() == normalized_name), None
    )


def _origin(url: str) -> str:
    parsed = urlsplit(url)
    return urlunsplit((parsed.scheme.lower(), parsed.netloc, "", "", ""))


def _without_fragment(url: str) -> str:
    parsed = urlsplit(url)
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))


def _robots_parser(
    robots_url: str, robots_record: FetchRecord
) -> urllib.robotparser.RobotFileParser | None:
    page = robots_record.page
    if page is None or page.status_code != 200:
        return None
    parser = urllib.robotparser.RobotFileParser(robots_url)
    parser.parse(page.body.decode("utf-8", errors="replace").splitlines())
    return parser


def _robots_decision(
    parser: urllib.robotparser.RobotFileParser | None,
    page: FetchedPage | None,
    url: str,
) -> tuple[bool, RobotsDecisionReason]:
    if page is None:
        return False, RobotsDecisionReason.ROBOTS_FETCH_FAILED
    if parser is not None:
        allowed = parser.can_fetch(USER_AGENT, url)
        reason = (
            RobotsDecisionReason.ALLOWED_BY_RULES
            if allowed
            else RobotsDecisionReason.DISALLOWED_BY_RULES
        )
        return allowed, reason
    if page.status_code in {404, 410}:
        return True, RobotsDecisionReason.ROBOTS_NOT_FOUND
    if page.status_code in {401, 403}:
        return False, RobotsDecisionReason.ROBOTS_ACCESS_DENIED
    return False, RobotsDecisionReason.ROBOTS_HTTP_ERROR


def resolve_addresses(host: str, port: int) -> Sequence[str]:
    return tuple(
        dict.fromkeys(
            cast(str, result[4][0])
            for result in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        )
    )


@contextmanager
def _reserved_dead_proxy_port() -> Iterator[int]:
    """Reserve a loopback port without listening so unrouted browser egress fails closed."""

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = cast(int, reservation.getsockname()[1])
        yield port


def _run_with_deadline[OperationResult](
    operation: Callable[[], OperationResult],
    *,
    timeout_seconds: float,
    slots: threading.BoundedSemaphore,
) -> OperationResult:
    deadline = time.monotonic() + timeout_seconds
    if not slots.acquire(timeout=timeout_seconds):
        raise OperationTimeout("Operation timed out waiting for a concurrency slot.")

    completed: queue.Queue[_CompletedOperation[OperationResult]] = queue.Queue(maxsize=1)

    def run() -> None:
        try:
            completed.put(_CompletedOperation(value=operation()))
        except Exception as exc:
            completed.put(_CompletedOperation(error=exc))
        finally:
            slots.release()

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    remaining_seconds = deadline - time.monotonic()
    if remaining_seconds <= 0:
        raise OperationTimeout("Operation exceeded its wall-clock deadline.")
    try:
        result = completed.get(timeout=remaining_seconds)
    except queue.Empty as exc:
        raise OperationTimeout("Operation exceeded its wall-clock deadline.") from exc
    if result.error is not None:
        raise result.error
    return cast(OperationResult, result.value)


_PREFLIGHT_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENCY)


def validate_public_destination(url: str, *, approved_host: str) -> bool:
    """DNS-only preflight; fetching still independently pins and validates every hop."""
    fetcher = SourcePageFetcher(approved_host=approved_host)
    if fetcher._validate_url(url):
        return False
    parts = urlsplit(url)
    try:
        addresses = _run_with_deadline(
            partial(resolve_addresses, approved_host, 443 if parts.scheme == "https" else 80),
            timeout_seconds=REQUEST_TIMEOUT_SECONDS,
            slots=_PREFLIGHT_SLOTS,
        )
        return bool(addresses) and all(_is_public_address(address) for address in addresses)
    except Exception:
        return False

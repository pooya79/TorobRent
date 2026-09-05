import http.client
import socket
import threading
import time
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from typing import Any, cast

import pytest

from apps.source_extraction import fetching as fetching_module
from apps.source_extraction.fetching import (
    MAX_BROWSER_RESOURCES,
    MAX_CONCURRENCY,
    MAX_PAGES,
    MAX_RESPONSE_BYTES,
    BrowserDocument,
    BrowserResourceLoader,
    FetchedPage,
    FetchFailure,
    FetchFailureCode,
    FetchRecord,
    NetworkRequest,
    PinnedHttpTransport,
    PlaywrightBrowserRenderer,
    RawResponse,
    SourcePageFetcher,
    TransportTimeout,
)


class FakeTransport:
    def __init__(self, responses: dict[str, RawResponse]) -> None:
        self.responses = responses
        self.requests: list[NetworkRequest] = []

    def get(self, request: NetworkRequest) -> RawResponse:
        self.requests.append(request)
        return self.responses[request.url]


def public_resolver(host: str, port: int) -> Sequence[str]:
    del host, port
    return ["93.184.216.34"]


def test_http_transport_uses_the_authorized_ip_and_approved_host_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection_attempts: list[tuple[tuple[str, int], float]] = []
    sent_requests: list[tuple[str, str, dict[str, str]]] = []

    class FakeResponse:
        status = 200

        def read(self, amount: int) -> bytes:
            assert amount == 101
            return b"page"

        def getheaders(self) -> list[tuple[str, str]]:
            return [("Content-Type", "text/plain")]

    class FakeConnection:
        def __init__(self, host: str, port: int, *, timeout: float) -> None:
            assert (host, port, timeout) == ("source.example", 80, 15.0)
            self.sock: Any = None

        def request(self, method: str, target: str, *, headers: dict[str, str]) -> None:
            sent_requests.append((method, target, headers))

        def getresponse(self) -> FakeResponse:
            return FakeResponse()

        def close(self) -> None:
            pass

    def connect(address: tuple[str, int], timeout: float) -> socket.socket:
        connection_attempts.append((address, timeout))
        return cast(socket.socket, object())

    monkeypatch.setattr(socket, "create_connection", connect)
    monkeypatch.setattr(http.client, "HTTPConnection", FakeConnection)

    response = PinnedHttpTransport().get(
        NetworkRequest(
            url="http://source.example/listing?ref=42",
            connect_ip="93.184.216.34",
            host="source.example",
            port=80,
            timeout_seconds=15.0,
            max_response_bytes=100,
        )
    )
    assert connection_attempts == [(("93.184.216.34", 80), 15.0)]
    method, target, headers = sent_requests[0]
    assert (method, target) == ("GET", "/listing?ref=42")
    assert headers["Host"] == "source.example"
    assert response.body == b"page"


def test_http_transport_enforces_a_wall_clock_deadline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeSocket:
        def shutdown(self, how: int) -> None:
            assert how == socket.SHUT_RDWR

        def close(self) -> None:
            pass

    class SlowResponse:
        status = 200

        def read(self, amount: int) -> bytes:
            del amount
            return b"late"

        def getheaders(self) -> list[tuple[str, str]]:
            return []

    class SlowConnection:
        def __init__(self, host: str, port: int, *, timeout: float) -> None:
            del host, port, timeout
            self.sock: Any = None

        def request(self, method: str, target: str, *, headers: dict[str, str]) -> None:
            del method, target, headers

        def getresponse(self) -> SlowResponse:
            time.sleep(0.02)
            return SlowResponse()

        def close(self) -> None:
            pass

    monkeypatch.setattr(
        socket,
        "create_connection",
        lambda address, timeout: cast(socket.socket, FakeSocket()),
    )
    monkeypatch.setattr(http.client, "HTTPConnection", SlowConnection)

    with pytest.raises(TransportTimeout):
        PinnedHttpTransport().get(
            NetworkRequest(
                url="http://source.example/listing",
                connect_ip="93.184.216.34",
                host="source.example",
                port=80,
                timeout_seconds=0.005,
                max_response_bytes=100,
            )
        )


@pytest.mark.parametrize(
    ("url", "code"),
    [
        ("ftp://source.example/listing", FetchFailureCode.INVALID_SCHEME),
        ("https://user:secret@source.example/listing", FetchFailureCode.CREDENTIALS),
        ("https://127.0.0.1/listing", FetchFailureCode.IP_LITERAL),
        ("https://cdn.source.example/listing", FetchFailureCode.HOST_NOT_APPROVED),
    ],
)
def test_fetcher_rejects_urls_outside_the_approved_http_host(
    url: str, code: FetchFailureCode
) -> None:
    transport = FakeTransport({})
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=public_resolver,
    )

    result = fetcher.fetch([url])

    assert result.records[0].failure is not None
    assert result.records[0].failure.code is code
    assert transport.requests == []


def test_fetcher_returns_a_structured_failure_for_an_invalid_idna_hostname() -> None:
    transport = FakeTransport({})
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=public_resolver,
    )

    result = fetcher.fetch(["https://\ud800.example/listing"])

    failure = result.records[0].failure
    assert failure is not None
    assert failure.code is FetchFailureCode.INVALID_URL
    assert transport.requests == []


def test_fetcher_rejects_a_hostname_resolving_to_any_non_public_address() -> None:
    transport = FakeTransport({})
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=lambda host, port: ["93.184.216.34", "169.254.169.254"],
    )

    result = fetcher.fetch(["https://source.example/listing"])

    assert result.records[0].failure is not None
    assert result.records[0].failure.code is FetchFailureCode.NON_PUBLIC_ADDRESS
    assert transport.requests == []


@pytest.mark.parametrize(
    "address",
    [
        "10.0.0.1",
        "100.64.0.1",
        "127.0.0.1",
        "169.254.169.254",
        "192.0.2.1",
        "::1",
        "fe80::1",
        "fc00::1",
    ],
)
def test_fetcher_rejects_every_non_public_address_class(address: str) -> None:
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=FakeTransport({}),
        resolver=lambda host, port: [address],
    )

    result = fetcher.fetch(["https://source.example/listing"])

    failure = result.records[0].failure
    assert failure is not None
    assert failure.code is FetchFailureCode.NON_PUBLIC_ADDRESS


def test_fetcher_bounds_dns_resolution_time(monkeypatch: pytest.MonkeyPatch) -> None:
    def stalled_resolver(host: str, port: int) -> Sequence[str]:
        del host, port
        time.sleep(0.02)
        return ["93.184.216.34"]

    monkeypatch.setattr(fetching_module, "REQUEST_TIMEOUT_SECONDS", 0.005)
    transport = FakeTransport({})
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=stalled_resolver,
    )

    result = fetcher.fetch(["https://source.example/listing"])

    failure = result.records[0].failure
    assert failure is not None
    assert failure.code is FetchFailureCode.TIMEOUT
    assert failure.transient is True
    assert transport.requests == []


def test_fetcher_bounds_an_uncooperative_transport(monkeypatch: pytest.MonkeyPatch) -> None:
    class StalledTransport(FakeTransport):
        def get(self, request: NetworkRequest) -> RawResponse:
            self.requests.append(request)
            time.sleep(0.02)
            return RawResponse(200, {}, b"late")

    monkeypatch.setattr(fetching_module, "REQUEST_TIMEOUT_SECONDS", 0.005)
    transport = StalledTransport({})
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=public_resolver,
    )

    result = fetcher.fetch(["https://source.example/listing"])

    failure = result.records[0].failure
    assert failure is not None
    assert failure.code is FetchFailureCode.TIMEOUT
    assert failure.transient is True


def test_fetcher_revalidates_dns_before_following_a_redirect() -> None:
    resolutions = iter([["93.184.216.34"], ["93.184.216.34"], ["127.0.0.1"]])
    transport = FakeTransport({
        "https://source.example/robots.txt": RawResponse(
            status_code=404,
            headers={},
            body=b"",
        ),
        "https://source.example/start": RawResponse(
            status_code=302,
            headers={"location": "/listing"},
            body=b"",
        ),
    })
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=lambda host, port: next(resolutions),
    )

    result = fetcher.fetch(["https://source.example/start"])

    assert result.records[0].failure is not None
    assert result.records[0].failure.code is FetchFailureCode.NON_PUBLIC_ADDRESS
    assert [request.connect_ip for request in transport.requests] == [
        "93.184.216.34",
        "93.184.216.34",
    ]


def test_fetcher_rejects_a_redirect_to_an_unapproved_host_before_dns() -> None:
    transport = FakeTransport({
        "https://source.example/robots.txt": RawResponse(404, {}, b""),
        "https://source.example/start": RawResponse(
            302, {"location": "https://cdn.source.example/listing"}, b""
        ),
    })
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=public_resolver,
    )

    result = fetcher.fetch(["https://source.example/start"])

    failure = result.records[0].failure
    assert failure is not None
    assert failure.code is FetchFailureCode.HOST_NOT_APPROVED
    assert len(transport.requests) == 2


def test_fetcher_checks_robots_before_following_a_redirect() -> None:
    transport = FakeTransport({
        "https://source.example/robots.txt": RawResponse(
            200,
            {},
            b"User-agent: TorobRentSourceFetcher\nDisallow: /private\n",
        ),
        "https://source.example/allowed": RawResponse(
            302,
            {"location": "/private"},
            b"",
        ),
    })
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=public_resolver,
    )

    result = fetcher.fetch(["https://source.example/allowed"])

    record = result.records[0]
    assert record.failure is not None
    assert record.failure.code is FetchFailureCode.ROBOTS_DENIED
    assert record.failure.url == "https://source.example/private"
    assert record.robots is not None
    assert record.robots.allowed is False
    assert [request.url for request in transport.requests] == [
        "https://source.example/robots.txt",
        "https://source.example/allowed",
    ]


def test_fetcher_stops_at_the_fixed_redirect_limit() -> None:
    redirect_urls = [f"https://source.example/redirect/{index}" for index in range(6)]
    transport = FakeTransport({
        "https://source.example/robots.txt": RawResponse(404, {}, b""),
        **{
            url: RawResponse(302, {"location": redirect_urls[index + 1]}, b"")
            for index, url in enumerate(redirect_urls[:-1])
        },
        redirect_urls[-1]: RawResponse(302, {"location": redirect_urls[0]}, b""),
    })
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=public_resolver,
    )

    result = fetcher.fetch([redirect_urls[0]])

    failure = result.records[0].failure
    assert failure is not None
    assert failure.code is FetchFailureCode.REDIRECT_LIMIT
    assert failure.url == redirect_urls[-1]


def test_fetcher_returns_structured_robots_decisions_and_denials() -> None:
    transport = FakeTransport({
        "https://source.example/robots.txt": RawResponse(
            status_code=200,
            headers={},
            body=b"User-agent: TorobRentSourceFetcher\nDisallow: /private\n",
        ),
        "https://source.example/public": RawResponse(
            status_code=200,
            headers={"content-type": "text/html"},
            body=b"public page",
        ),
    })
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=public_resolver,
    )

    result = fetcher.fetch(["https://source.example/public", "https://source.example/private"])

    assert result.records[0].page is not None
    assert result.records[0].robots is not None
    assert result.records[0].robots.allowed is True
    assert result.records[1].failure is not None
    assert result.records[1].failure.code is FetchFailureCode.ROBOTS_DENIED
    assert result.records[1].robots is not None
    assert result.records[1].robots.allowed is False


def test_fetcher_enforces_page_and_response_byte_limits() -> None:
    urls = [f"https://source.example/listing/{index}" for index in range(MAX_PAGES + 1)]
    oversized_body = b"x" * (MAX_RESPONSE_BYTES + 1)
    transport = FakeTransport({
        "https://source.example/robots.txt": RawResponse(404, {}, b""),
        **{url: RawResponse(200, {}, oversized_body) for url in urls[:MAX_PAGES]},
    })
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=public_resolver,
    )

    result = fetcher.fetch(urls)

    assert all(
        record.failure is not None and record.failure.code is FetchFailureCode.RESPONSE_TOO_LARGE
        for record in result.records[:MAX_PAGES]
    )
    page_limit_failure = result.records[MAX_PAGES].failure
    assert page_limit_failure is not None
    assert page_limit_failure.code is FetchFailureCode.PAGE_LIMIT


def test_fetcher_bounds_concurrency_and_preserves_partial_results() -> None:
    class ObservedTransport(FakeTransport):
        def __init__(self) -> None:
            super().__init__({"https://source.example/robots.txt": RawResponse(404, {}, b"")})
            self.active = 0
            self.maximum_active = 0
            self.lock = threading.Lock()

        def get(self, request: NetworkRequest) -> RawResponse:
            if request.url.endswith("robots.txt"):
                return super().get(request)
            with self.lock:
                self.active += 1
                self.maximum_active = max(self.maximum_active, self.active)
            try:
                time.sleep(0.01)
                if request.url.endswith("/3"):
                    raise TransportTimeout("controlled timeout")
                if request.url.endswith("/4"):
                    raise RuntimeError("unexpected adapter failure")
                return RawResponse(200, {}, request.url.encode())
            finally:
                with self.lock:
                    self.active -= 1

    urls = [f"https://source.example/listing/{index}" for index in range(8)]
    transport = ObservedTransport()
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=public_resolver,
    )

    result = fetcher.fetch(urls)

    assert 1 < transport.maximum_active <= MAX_CONCURRENCY
    assert result.records[3].failure is not None
    assert result.records[3].failure.code is FetchFailureCode.TIMEOUT
    assert result.records[3].failure.transient is True
    assert result.records[4].failure is not None
    assert result.records[4].failure.code is FetchFailureCode.TRANSPORT_ERROR
    assert all(
        record.page is not None
        for index, record in enumerate(result.records)
        if index not in {3, 4}
    )
    assert [record.requested_url for record in result.records] == urls


def test_browser_fallback_routes_every_subresource_through_the_approved_boundary() -> None:
    class FakeBrowser:
        def render(
            self,
            document: BrowserDocument,
            *,
            load_resource: BrowserResourceLoader,
            timeout_seconds: float,
        ) -> bytes:
            assert document.body == b"page shell"
            assert timeout_seconds > 0
            same_host = load_resource("https://source.example/app.js")
            assert isinstance(same_host, FetchRecord) and same_host.page is not None
            foreign_host = load_resource("https://evil.example/track.js")
            assert isinstance(foreign_host, FetchRecord) and foreign_host.failure is not None
            metadata = load_resource("http://169.254.169.254/latest/meta-data")
            assert isinstance(metadata, FetchRecord) and metadata.failure is not None
            return b"rendered page"

    transport = FakeTransport({
        "https://source.example/robots.txt": RawResponse(404, {}, b""),
        "https://source.example/listing": RawResponse(200, {}, b"page shell"),
        "https://source.example/app.js": RawResponse(200, {}, b"safe script"),
    })
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=public_resolver,
        browser=FakeBrowser(),
    )

    result = fetcher.fetch(["https://source.example/listing"], render=True)

    record = result.records[0]
    assert record.page is not None
    assert record.page.body == b"rendered page"
    assert record.browser is not None
    assert [failure.code for failure in record.browser.blocked_resources] == [
        FetchFailureCode.HOST_NOT_APPROVED,
        FetchFailureCode.IP_LITERAL,
    ]
    assert [request.url for request in transport.requests] == [
        "https://source.example/robots.txt",
        "https://source.example/listing",
        "https://source.example/app.js",
    ]


def test_playwright_renderer_disables_native_network_and_intercepts_every_channel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fulfilled_urls: list[str] = []
    aborted_urls: list[str] = []
    closed_web_sockets: list[str] = []
    loaded_urls: list[str] = []
    launch_options: dict[str, Any] = {}
    context_options: dict[str, Any] = {}

    class FakeRequest:
        def __init__(self, url: str, *, navigation: bool = False) -> None:
            self.url = url
            self._navigation = navigation

        def is_navigation_request(self) -> bool:
            return self._navigation

    class FakeRoute:
        def __init__(self, url: str, *, navigation: bool = False) -> None:
            self.request = FakeRequest(url, navigation=navigation)

        def fulfill(self, **response: Any) -> None:
            del response
            fulfilled_urls.append(self.request.url)

        def abort(self, error_code: str) -> None:
            assert error_code == "blockedbyclient"
            aborted_urls.append(self.request.url)

    class FakeWebSocket:
        url = "wss://evil.example/socket"

        def close(self, *, code: int, reason: str) -> None:
            assert (code, reason) == (1008, "Network access is blocked")
            closed_web_sockets.append(self.url)

    class FakePage:
        def __init__(self, context: FakeContext) -> None:
            self.context = context

        def goto(self, url: str, *, wait_until: str, timeout: int) -> None:
            assert (wait_until, timeout) == ("networkidle", 15000)
            assert self.context.route_handler is not None
            assert self.context.web_socket_handler is not None
            self.context.route_handler(FakeRoute(url, navigation=True))
            self.context.route_handler(FakeRoute(url, navigation=True))
            self.context.route_handler(FakeRoute("https://source.example/app.js"))
            self.context.route_handler(FakeRoute("https://evil.example/tracker.js"))
            self.context.web_socket_handler(FakeWebSocket())

        def content(self) -> str:
            return "<html>rendered</html>"

    class FakeContext:
        def __init__(self) -> None:
            self.route_handler: Callable[[Any], None] | None = None
            self.web_socket_handler: Callable[[Any], None] | None = None

        def route(self, pattern: str, handler: Callable[[Any], None]) -> None:
            assert pattern == "**/*"
            self.route_handler = handler

        def route_web_socket(self, pattern: str, handler: Callable[[Any], None]) -> None:
            assert pattern == "**/*"
            self.web_socket_handler = handler

        def new_page(self) -> FakePage:
            return FakePage(self)

        def close(self) -> None:
            pass

    fake_context = FakeContext()

    class FakeBrowser:
        def new_context(self, **options: Any) -> FakeContext:
            context_options.update(options)
            return fake_context

        def close(self) -> None:
            pass

    class FakeChromium:
        def launch(self, **options: Any) -> FakeBrowser:
            launch_options.update(options)
            return FakeBrowser()

    class FakePlaywright:
        chromium = FakeChromium()

    class FakePlaywrightManager:
        def __enter__(self) -> FakePlaywright:
            return FakePlaywright()

        def __exit__(self, *args: Any) -> None:
            del args

    monkeypatch.setattr(fetching_module, "sync_playwright", FakePlaywrightManager)

    @contextmanager
    def dead_proxy_port() -> Iterator[int]:
        yield 43123

    monkeypatch.setattr(fetching_module, "_reserved_dead_proxy_port", dead_proxy_port)

    def load_resource(url: str) -> FetchRecord:
        loaded_urls.append(url)
        if url in {
            "https://source.example/listing",
            "https://source.example/app.js",
        }:
            return FetchRecord(url, page=FetchedPage(url, 200, b"safe"))
        return FetchRecord(
            url,
            failure=FetchFailure(FetchFailureCode.HOST_NOT_APPROVED, url, "blocked"),
        )

    body = PlaywrightBrowserRenderer(executable_path="/chromium").render(
        BrowserDocument("https://source.example/listing", 200, b"page"),
        load_resource=load_resource,
        timeout_seconds=15,
    )

    assert body == b"<html>rendered</html>"
    assert context_options == {
        "accept_downloads": False,
        "offline": True,
        "service_workers": "block",
    }
    assert launch_options["proxy"] == {
        "server": "http://127.0.0.1:43123",
        "bypass": "<-loopback>",
    }
    assert "--dns-prefetch-disable" in launch_options["args"]
    assert "--force-webrtc-ip-handling-policy=disable_non_proxied_udp" in launch_options["args"]
    assert fulfilled_urls == [
        "https://source.example/listing",
        "https://source.example/listing",
        "https://source.example/app.js",
    ]
    assert aborted_urls == ["https://evil.example/tracker.js"]
    assert closed_web_sockets == ["wss://evil.example/socket"]
    assert loaded_urls == [
        "https://source.example/listing",
        "https://source.example/app.js",
        "https://evil.example/tracker.js",
        "wss://evil.example/socket",
    ]


def test_browser_fallback_revalidates_dns_for_same_host_subresources() -> None:
    class RebindingBrowser:
        def render(
            self,
            document: BrowserDocument,
            *,
            load_resource: BrowserResourceLoader,
            timeout_seconds: float,
        ) -> bytes:
            del timeout_seconds
            resource = load_resource("https://source.example/rebound.js")
            assert resource.failure is not None
            return document.body

    resolutions = iter([["93.184.216.34"], ["93.184.216.34"], ["127.0.0.1"]])
    transport = FakeTransport({
        "https://source.example/robots.txt": RawResponse(404, {}, b""),
        "https://source.example/listing": RawResponse(200, {}, b"page"),
    })
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=lambda host, port: next(resolutions),
        browser=RebindingBrowser(),
    )

    result = fetcher.fetch(["https://source.example/listing"], render=True)

    browser_evidence = result.records[0].browser
    assert browser_evidence is not None
    assert browser_evidence.blocked_resources[0].code is FetchFailureCode.NON_PUBLIC_ADDRESS
    assert len(transport.requests) == 2


def test_browser_fallback_bounds_resource_requests() -> None:
    class ResourceFloodBrowser:
        def render(
            self,
            document: BrowserDocument,
            *,
            load_resource: BrowserResourceLoader,
            timeout_seconds: float,
        ) -> bytes:
            del timeout_seconds
            last_resource: FetchRecord | None = None
            for index in range(MAX_BROWSER_RESOURCES + 1):
                last_resource = load_resource(f"https://evil.example/resource/{index}")
            assert last_resource is not None and last_resource.failure is not None
            assert last_resource.failure.code is FetchFailureCode.BROWSER_RESOURCE_LIMIT
            return document.body

    transport = FakeTransport({
        "https://source.example/robots.txt": RawResponse(404, {}, b""),
        "https://source.example/listing": RawResponse(200, {}, b"page"),
    })
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=public_resolver,
        browser=ResourceFloodBrowser(),
    )

    result = fetcher.fetch(["https://source.example/listing"], render=True)

    browser_evidence = result.records[0].browser
    assert browser_evidence is not None
    assert len(browser_evidence.requested_resources) == MAX_BROWSER_RESOURCES
    assert browser_evidence.blocked_resources[-1].code is FetchFailureCode.BROWSER_RESOURCE_LIMIT


def test_unexpected_browser_failure_is_isolated_to_its_page() -> None:
    class PartiallyFailingBrowser:
        def render(
            self,
            document: BrowserDocument,
            *,
            load_resource: BrowserResourceLoader,
            timeout_seconds: float,
        ) -> bytes:
            del load_resource, timeout_seconds
            if document.url.endswith("/bad"):
                raise RuntimeError("browser process exited")
            return b"rendered"

    urls = ["https://source.example/bad", "https://source.example/good"]
    transport = FakeTransport({
        "https://source.example/robots.txt": RawResponse(404, {}, b""),
        **{url: RawResponse(200, {}, b"page") for url in urls},
    })
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=public_resolver,
        browser=PartiallyFailingBrowser(),
    )

    result = fetcher.fetch(urls, render=True)

    assert result.records[0].failure is not None
    assert result.records[0].failure.code is FetchFailureCode.BROWSER_ERROR
    assert result.records[1].page is not None
    assert result.records[1].page.body == b"rendered"


def test_browser_timeout_is_bounded_and_retains_blocked_resource_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class SlowBrowser:
        def render(
            self,
            document: BrowserDocument,
            *,
            load_resource: BrowserResourceLoader,
            timeout_seconds: float,
        ) -> bytes:
            blocked = load_resource("https://evil.example/tracker.js")
            assert blocked.failure is not None
            time.sleep(timeout_seconds * 4)
            return document.body

    monkeypatch.setattr(fetching_module, "REQUEST_TIMEOUT_SECONDS", 0.005)
    transport = FakeTransport({
        "https://source.example/robots.txt": RawResponse(404, {}, b""),
        "https://source.example/listing": RawResponse(200, {}, b"page"),
    })
    fetcher = SourcePageFetcher(
        approved_host="source.example",
        transport=transport,
        resolver=public_resolver,
        browser=SlowBrowser(),
    )

    result = fetcher.fetch(["https://source.example/listing"], render=True)

    record = result.records[0]
    assert record.failure is not None
    assert record.failure.code is FetchFailureCode.TIMEOUT
    assert record.browser is not None
    assert record.browser.blocked_resources[0].code is FetchFailureCode.HOST_NOT_APPROVED

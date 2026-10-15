"""The fetcher dials the checked address, re-checks every redirect hop, and bounds time and bytes."""

import asyncio
import socket

import httpx
import pytest

from oss.src.core.links import service
from oss.src.core.links.service import LinksService
from oss.src.core.links.types import LinkPreviewRefused

_ADDRESSES = {
    "example.com": "93.184.215.14",
    "www.example.com": "93.184.215.14",
    "next.example": "93.184.215.15",
}
_PAGE = (
    '<head><meta property="og:title" content="Next">'
    '<meta property="og:image" content="/cover.png"></head>'
)


def _html() -> httpx.Response:
    # A streamed body, as the network gives: `text=` arrives already read.
    async def body():
        yield _PAGE.encode()

    return httpx.Response(200, headers={"content-type": "text/html"}, content=body())


@pytest.fixture
def calls(monkeypatch):
    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [(2, 1, 6, "", (_ADDRESSES[host], 443))]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    return []


def _serve(monkeypatch, calls, handler):
    def record(request):
        calls.append(request)
        return handler(request)

    real = httpx.AsyncClient
    monkeypatch.setattr(
        service.httpx,
        "AsyncClient",
        lambda **kwargs: real(transport=httpx.MockTransport(record), **kwargs),
    )


@pytest.mark.asyncio
async def test_each_hop_is_pinned_to_its_checked_address(monkeypatch, calls):
    def handler(request):
        if request.headers["host"] == "example.com":
            return httpx.Response(302, headers={"location": "https://next.example/p"})
        return _html()

    _serve(monkeypatch, calls, handler)
    preview = await LinksService().preview(url="https://example.com/")

    assert [
        (c.url.host, c.headers["host"], c.extensions["sni_hostname"]) for c in calls
    ] == [
        ("93.184.215.14", "example.com", "example.com"),
        ("93.184.215.15", "next.example", "next.example"),
    ]
    assert preview.url == "https://next.example/p"
    assert preview.image == "https://next.example/cover.png"


@pytest.mark.asyncio
async def test_a_redirect_to_a_private_address_is_not_followed(monkeypatch, calls):
    _serve(
        monkeypatch,
        calls,
        lambda request: httpx.Response(302, headers={"location": "http://127.0.0.1/"}),
    )
    preview = await LinksService().preview(url="https://example.com/")

    assert len(calls) == 1
    assert (preview.url, preview.image) == ("https://example.com/", None)


@pytest.mark.asyncio
async def test_redirects_stop_after_the_limit(monkeypatch, calls):
    _serve(
        monkeypatch,
        calls,
        lambda request: httpx.Response(302, headers={"location": "/again"}),
    )
    preview = await LinksService().preview(url="https://example.com/")

    assert len(calls) == service._MAX_REDIRECTS + 1
    assert preview.url == "https://example.com/"


@pytest.mark.asyncio
async def test_a_refused_link_is_refused_before_any_request(monkeypatch, calls):
    _serve(monkeypatch, calls, lambda request: httpx.Response(200))
    with pytest.raises(LinkPreviewRefused):
        await LinksService().preview(url="http://169.254.169.254/latest/")
    assert calls == []


@pytest.mark.asyncio
async def test_an_endless_body_is_read_only_up_to_the_cap(monkeypatch, calls):
    pulled = []

    async def endless():
        yield _PAGE.encode()
        while True:
            pulled.append(64 * 1024)
            yield b"x" * (64 * 1024)

    _serve(
        monkeypatch,
        calls,
        lambda request: httpx.Response(
            200, headers={"content-type": "text/html"}, content=endless()
        ),
    )
    preview = await LinksService().preview(url="https://example.com/")

    assert sum(pulled) <= service._MAX_BYTES
    assert preview.title == "Next"


@pytest.mark.asyncio
async def test_a_slow_page_yields_the_url_and_domain_only(monkeypatch, calls):
    async def slow(request):
        await asyncio.sleep(5)
        return _html()

    monkeypatch.setattr(service, "_TIMEOUT_SECONDS", 0.1)
    _serve(monkeypatch, calls, slow)
    preview = await LinksService().preview(url="https://www.example.com/")

    assert (preview.url, preview.domain, preview.title) == (
        "https://www.example.com/",
        "example.com",
        None,
    )

"""The link preview fetcher dials only public http(s) targets on ports 80 and 443."""

import ipaddress
import json
import socket
from pathlib import Path

import pytest

from oss.src.core.links.guard import resolve_link_address
from oss.src.core.links.types import LinkPreviewRefused, LinkPreviewUnreachable

_VECTORS = (
    Path(__file__).resolve().parents[6]
    / "sdks"
    / "python"
    / "oss"
    / "tests"
    / "pytest"
    / "unit"
    / "golden"
    / "ssrf_guard_vectors.json"
)


def _vectors() -> list:
    assert _VECTORS.exists(), f"the vector fixture is not at {_VECTORS}"
    return json.loads(_VECTORS.read_text())


def _answers(monkeypatch, *addresses: str) -> None:
    def fake_getaddrinfo(host, port, *args, **kwargs):
        return [(2, 1, 6, "", (address, 443)) for address in addresses]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "host,blocked",
    [(vector["host"], vector["blocked"]) for vector in _vectors()],
)
async def test_a_literal_address_agrees_with_every_vector(host, blocked):
    literal = f"[{host}]" if ipaddress.ip_address(host).version == 6 else host
    if blocked:
        with pytest.raises(LinkPreviewRefused) as refused:
            await resolve_link_address(url=f"https://{literal}/")
        assert refused.value.reason == "non_public_address"
    else:
        assert await resolve_link_address(url=f"https://{literal}/") == str(
            ipaddress.ip_address(host)
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url,reason",
    [
        ("ftp://example.com/file", "unsupported_scheme"),
        ("file:///etc/passwd", "unsupported_scheme"),
        ("javascript:alert(1)", "unsupported_scheme"),
        ("//example.com/path", "unsupported_scheme"),
        ("https://user:pass@example.com/", "credentials"),
        ("https://user@example.com/", "credentials"),
        ("https://example.com:8080/", "unsupported_port"),
        ("http://example.com:22/", "unsupported_port"),
        ("https://example.com:99999/", "invalid_port"),
        ("https:///nohost", "missing_host"),
        ("http://localhost/", "non_public_address"),
    ],
)
async def test_a_link_outside_the_rules_is_refused(url, reason):
    with pytest.raises(LinkPreviewRefused) as refused:
        await resolve_link_address(url=url)
    assert refused.value.reason == reason


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "https://Example.com/a?b=c",
        "http://example.com/",
        "https://example.com:443/",
        "http://example.com:80/x",
    ],
)
async def test_a_public_name_resolves_to_the_checked_address(monkeypatch, url):
    _answers(monkeypatch, "93.184.215.14")
    assert await resolve_link_address(url=url) == "93.184.215.14"


@pytest.mark.asyncio
async def test_a_name_with_any_private_answer_is_refused(monkeypatch):
    _answers(monkeypatch, "93.184.215.14", "10.0.0.7")
    with pytest.raises(LinkPreviewRefused):
        await resolve_link_address(url="https://rebind.example/")


@pytest.mark.asyncio
async def test_an_unresolvable_name_is_unreachable_not_refused(monkeypatch):
    def fake_getaddrinfo(*args, **kwargs):
        raise socket.gaierror("no such host")

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(LinkPreviewUnreachable):
        await resolve_link_address(url="https://nowhere.invalid/")

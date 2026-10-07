"""The link preview fetcher dials only public http(s) targets on ports 80 and 443."""

import ipaddress
import json
from pathlib import Path

import pytest

from oss.src.core.links import guard
from oss.src.core.links.guard import (
    check_link_url,
    is_blocked_address,
    resolve_link_target,
)
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


@pytest.mark.parametrize(
    "host,blocked",
    [(vector["host"], vector["blocked"]) for vector in _vectors()],
)
def test_the_link_guard_agrees_with_every_vector(host, blocked):
    assert is_blocked_address(ipaddress.ip_address(host)) is blocked


@pytest.mark.parametrize(
    "host",
    [
        "127.0.0.1",
        "10.0.0.5",
        "172.16.3.4",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "224.0.0.1",
        "240.0.0.1",
        "::1",
        "::",
        "fe80::1",
        "fc00::1",
        "ff02::1",
        "::ffff:127.0.0.1",
        "::ffff:10.0.0.1",
        "::ffff:169.254.169.254",
    ],
)
def test_non_public_addresses_are_blocked(host):
    assert is_blocked_address(ipaddress.ip_address(host)) is True


@pytest.mark.parametrize("host", ["93.184.215.14", "1.1.1.1", "2606:4700:4700::1111"])
def test_public_addresses_pass(host):
    assert is_blocked_address(ipaddress.ip_address(host)) is False


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com/file",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "//example.com/path",
        "https://user:pass@example.com/",
        "https://user@example.com/",
        "https://example.com:8080/",
        "http://example.com:22/",
        "https://example.com:99999/",
        "https:///nohost",
    ],
)
def test_check_link_url_refuses(url):
    with pytest.raises(LinkPreviewRefused):
        check_link_url(url)


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://Example.com/a?b=c", ("example.com", 443)),
        ("http://example.com/", ("example.com", 80)),
        ("https://example.com:443/", ("example.com", 443)),
        ("http://example.com:80/x", ("example.com", 80)),
        ("https://[2606:4700:4700::1111]/", ("2606:4700:4700::1111", 443)),
    ],
)
def test_check_link_url_accepts(url, expected):
    assert check_link_url(url) == expected


@pytest.mark.asyncio
async def test_a_literal_private_address_is_refused_without_resolving():
    with pytest.raises(LinkPreviewRefused):
        await resolve_link_target("http://127.0.0.1/")


@pytest.mark.asyncio
async def test_a_name_with_any_private_answer_is_refused(monkeypatch):
    async def fake_resolve(resolve, *, timeout=None):
        return [
            (2, 1, 6, "", ("93.184.215.14", 443)),
            (2, 1, 6, "", ("10.0.0.7", 443)),
        ]

    monkeypatch.setattr(guard, "resolve_offloaded", fake_resolve)
    with pytest.raises(LinkPreviewRefused):
        await resolve_link_target("https://rebind.example/")


@pytest.mark.asyncio
async def test_a_public_name_resolves_to_the_checked_address(monkeypatch):
    async def fake_resolve(resolve, *, timeout=None):
        return [(2, 1, 6, "", ("93.184.215.14", 443))]

    monkeypatch.setattr(guard, "resolve_offloaded", fake_resolve)
    target = await resolve_link_target("https://example.com/page")
    assert (target.hostname, target.address) == ("example.com", "93.184.215.14")


@pytest.mark.asyncio
async def test_an_unresolvable_name_is_unreachable_not_refused(monkeypatch):
    async def fake_resolve(resolve, *, timeout=None):
        raise OSError("no such host")

    monkeypatch.setattr(guard, "resolve_offloaded", fake_resolve)
    with pytest.raises(LinkPreviewUnreachable):
        await resolve_link_target("https://nowhere.invalid/")

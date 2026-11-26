import pytest

from oss.src.core.auth.turnstile import get_client_ip
from oss.src.utils.env import env


class _Request:
    def __init__(self, headers: dict[str, str]):
        self._headers = {key.lower(): value for key, value in headers.items()}

    def get_header(self, key: str):
        return self._headers.get(key.lower())


@pytest.fixture(autouse=True)
def _access(monkeypatch):
    monkeypatch.setattr(env.agenta.access, "trusted_proxy_hops", None)
    monkeypatch.setattr(env.agenta.access, "trust_cloudflare_ip", False)


def _hops(monkeypatch, hops):
    monkeypatch.setattr(env.agenta.access, "trusted_proxy_hops", hops)


def test_unset_hops_keeps_the_first_forwarded_entry():
    request = _Request({"x-forwarded-for": "203.0.113.10, 10.0.0.1"})

    assert get_client_ip(request) == "203.0.113.10"


def test_two_hops_ignore_a_spoofed_first_entry(monkeypatch):
    _hops(monkeypatch, 2)
    # A client sent 198.51.100.99 itself; the load balancer appended client and its own IP.
    request = _Request({"x-forwarded-for": "198.51.100.99, 203.0.113.10, 34.0.0.1"})

    assert get_client_ip(request) == "203.0.113.10"


def test_two_hops_without_a_spoof(monkeypatch):
    _hops(monkeypatch, 2)
    request = _Request({"x-forwarded-for": "203.0.113.10, 34.0.0.1"})

    assert get_client_ip(request) == "203.0.113.10"


def test_hops_larger_than_the_header_fall_back_to_the_first_entry(monkeypatch):
    _hops(monkeypatch, 3)

    # Each client keeps its own address; no request is keyed on the proxy.
    assert get_client_ip(_Request({"x-forwarded-for": "203.0.113.10"})) == (
        "203.0.113.10"
    )
    assert get_client_ip(_Request({"x-forwarded-for": "198.51.100.7"})) == (
        "198.51.100.7"
    )


def test_empty_forwarded_entries_are_skipped(monkeypatch):
    _hops(monkeypatch, 2)
    request = _Request({"x-forwarded-for": ",, 203.0.113.10, 34.0.0.1"})

    assert get_client_ip(request) == "203.0.113.10"


def test_cloudflare_header_is_ignored_unless_trusted(monkeypatch):
    request = _Request(
        {"cf-connecting-ip": "198.51.100.99", "x-forwarded-for": "203.0.113.10"}
    )

    assert get_client_ip(request) == "203.0.113.10"

    monkeypatch.setattr(env.agenta.access, "trust_cloudflare_ip", True)

    assert get_client_ip(request) == "198.51.100.99"


def test_blank_cloudflare_header_falls_through_when_trusted(monkeypatch):
    monkeypatch.setattr(env.agenta.access, "trust_cloudflare_ip", True)
    request = _Request({"cf-connecting-ip": " ", "x-forwarded-for": "203.0.113.10"})

    assert get_client_ip(request) == "203.0.113.10"


def test_real_ip_is_the_last_fallback():
    assert get_client_ip(_Request({"x-real-ip": "203.0.113.10"})) == "203.0.113.10"
    assert get_client_ip(_Request({})) is None


def test_ipv6_is_normalized(monkeypatch):
    _hops(monkeypatch, 2)
    request = _Request({"x-forwarded-for": "2001:DB8:0:0::1, 34.0.0.1"})

    assert get_client_ip(request) == "2001:db8::1"


def test_a_value_that_is_not_an_ip_gives_none(monkeypatch):
    assert get_client_ip(_Request({"x-forwarded-for": "not-an-ip"})) is None

    monkeypatch.setattr(env.agenta.access, "trust_cloudflare_ip", True)
    assert get_client_ip(_Request({"cf-connecting-ip": "<script>"})) is None

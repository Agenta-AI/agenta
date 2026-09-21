"""Every copy of the address predicate answers the same, including for RFC 6598.

The guard is duplicated on purpose: `api/oss/src/core/webhooks/utils.py` holds the API's
only copy, `api/oss/src/core/gateways/mcps/oauth/registration.py` asks the inverse question
about this deployment's own address, and the SDK and the runner carry their own because
neither can import the API. Duplication is how `100.64.0.0/10` came to be missing from the
whole set at once: nothing compared them.

They are compared here, against the committed vector fixture that the runner's generated
range table is built from, so a copy that gains a range the others lack fails rather than
diverging quietly (P10).
"""

import ipaddress
import json
from pathlib import Path

import pytest

from oss.src.core.gateways.mcps.oauth import registration
from oss.src.core.webhooks import utils as webhook_utils


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
    # Read at collection, so a fixture that moved is a loud error naming the path rather
    # than a suite that parametrizes over nothing and reports green.
    assert _VECTORS.exists(), f"the vector fixture is not at {_VECTORS}"
    return json.loads(_VECTORS.read_text())


@pytest.mark.parametrize(
    "host,blocked",
    [(vector["host"], vector["blocked"]) for vector in _vectors()],
)
def test_the_webhook_predicate_agrees_with_every_vector(host, blocked):
    ip = ipaddress.ip_address(host)

    assert webhook_utils._is_blocked_ip(ip, allow_insecure=False) is blocked


@pytest.mark.parametrize(
    "host,blocked",
    [(vector["host"], vector["blocked"]) for vector in _vectors()],
)
def test_the_registration_predicate_agrees_with_every_vector(host, blocked):
    """The inverse question, asked about this deployment's own public address before it is
    offered to an authorization server as a client identity document."""
    ip = ipaddress.ip_address(host)

    assert registration._is_public_ip(ip) is not blocked


@pytest.mark.parametrize(
    "host",
    [
        "100.64.0.0",
        "100.64.0.1",
        "100.127.255.255",
        "::ffff:100.64.0.1",
    ],
)
def test_carrier_grade_nat_is_refused(host):
    """Named rather than left to the fixture, because this is the range that was missing
    and a fixture regenerated from a guard that still lacks it would agree with itself.

    A tenant supplies the endpoint URL, so an address here is reached on purpose, and the
    relay attaches the connection's stored credential before it goes."""
    ip = ipaddress.ip_address(host)

    assert webhook_utils._is_blocked_ip(ip, allow_insecure=False) is True
    assert registration._is_public_ip(ip) is False


@pytest.mark.parametrize("host", ["100.63.255.255", "100.128.0.0"])
def test_the_addresses_either_side_of_it_are_untouched(host):
    ip = ipaddress.ip_address(host)

    assert webhook_utils._is_blocked_ip(ip, allow_insecure=False) is False


def test_the_opt_out_still_admits_it():
    """The range joins the others rather than overriding the operator's own decision: a
    deployment that turns the guard off is one host and one network, and turning it off is
    what that switch is for."""
    ip = ipaddress.ip_address("100.64.0.1")

    assert webhook_utils._is_blocked_ip(ip, allow_insecure=True) is False

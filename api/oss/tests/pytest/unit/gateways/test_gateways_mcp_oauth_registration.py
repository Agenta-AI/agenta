"""Unit tests for the registration-strategy detector.

Pure functions, an injected resolver — no DNS, no network, no mock authorization
server needed for these.
"""

from oss.src.core.gateways.mcps.oauth.registration import (
    client_metadata_document,
    client_metadata_url,
    identity_document_client_info,
    is_publicly_resolvable,
)

_API_URL = "https://api.acme.internal"


def test_client_metadata_url_is_fixed_and_deployment_wide():
    url = client_metadata_url(api_url=_API_URL)

    assert url == "https://api.acme.internal/gateways/mcps/oauth/client-metadata.json"


def test_client_metadata_document_carries_the_fixed_redirect_and_no_secret():
    document = client_metadata_document(
        api_url=_API_URL,
        redirect_uri="https://api.acme.internal/gateways/mcps/connect/callback",
    )

    assert [str(u) for u in document.redirect_uris] == [
        "https://api.acme.internal/gateways/mcps/connect/callback"
    ]
    assert document.token_endpoint_auth_method == "none"
    assert not hasattr(document, "client_secret")


def test_identity_document_client_info_is_deterministic():
    redirect_uri = "https://api.acme.internal/gateways/mcps/connect/callback"

    first = identity_document_client_info(api_url=_API_URL, redirect_uri=redirect_uri)
    second = identity_document_client_info(api_url=_API_URL, redirect_uri=redirect_uri)

    assert first.client_id == second.client_id == client_metadata_url(api_url=_API_URL)
    assert first.client_secret is None


def test_public_address_is_detected_as_resolvable():
    assert is_publicly_resolvable(_API_URL, resolve=lambda _h: ["1.1.1.1"]) is True


def test_private_address_is_detected_as_not_resolvable():
    assert is_publicly_resolvable(_API_URL, resolve=lambda _h: ["10.0.0.5"]) is False


def test_mixed_public_and_private_addresses_falls_to_not_resolvable():
    """Conservative by construction: one private address among several is enough to
    fall back, because a wrong "resolvable" answer is the direction that fails
    silently on the authorization server's side (specs-wp20.md)."""
    assert (
        is_publicly_resolvable(_API_URL, resolve=lambda _h: ["1.1.1.1", "10.0.0.5"])
        is False
    )


def test_a_resolution_failure_falls_to_not_resolvable():
    def _raise(_hostname: str):
        raise OSError("name or service not known")

    assert is_publicly_resolvable(_API_URL, resolve=_raise) is False


def test_an_empty_answer_falls_to_not_resolvable():
    assert is_publicly_resolvable(_API_URL, resolve=lambda _h: []) is False


def test_http_scheme_never_attempts_the_document_regardless_of_the_resolver():
    assert (
        is_publicly_resolvable(
            "http://api.acme.internal", resolve=lambda _h: ["1.1.1.1"]
        )
        is False
    )


def test_split_horizon_dns_wrong_in_the_safe_direction():
    """A hostname that is genuinely public but whose local/internal resolver answers
    with a private address (a real split-horizon shape) is misdetected as internal.
    That is "wrong" but harmless: the outbound path WP17 already ships is unaffected
    by which client mechanism produced its registration (specs-wp20.md "Wrong in
    each direction, direction 2")."""
    internal_resolver_view = lambda _h: ["10.0.0.5"]  # noqa: E731

    assert is_publicly_resolvable(_API_URL, resolve=internal_resolver_view) is False


def test_a_positive_answer_cannot_distinguish_reachable_from_merely_public_looking():
    """The detector documents its own blind spot rather than hiding it: a resolved
    address that classifies as public (not private/loopback/link-local/reserved/
    multicast/unspecified) is treated as resolvable even though public IP space can
    still be firewalled or NAT'd in a way DNS alone cannot reveal. Nothing on our
    side observes that failure (specs-wp20.md "Wrong in each direction, direction
    1") — this test pins the fact that the detector proceeds on DNS evidence alone,
    it does not attempt to verify reachability beyond it."""
    assert is_publicly_resolvable(_API_URL, resolve=lambda _h: ["8.8.8.8"]) is True

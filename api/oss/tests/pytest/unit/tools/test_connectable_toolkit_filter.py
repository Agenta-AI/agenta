"""Which Composio toolkits the catalog offers, and why.

`can_connect_toolkit` mirrors the four branches of `initiate_connection`: no-auth,
the api_key branch (any non-OAuth mode, credential supplied by the person), Composio's
managed app, and unmanaged DCR OAuth. A toolkit none of them can name is one someone can
start connecting and never finish, so the all-apps listing drops it.

The cases below are real shapes from the live catalog (1412 toolkits, probed 2026-08-27),
one per branch plus the excluded set, so the test fails if a branch stops being covered.
"""

from __future__ import annotations

import pytest

from oss.src.core.gateway.connections.providers.composio.adapter import (
    CONNECTABLE_AUTH_SCHEMES,
    can_connect_toolkit,
)


def _listing(slug: str, schemes: list, managed: list | None = None, no_auth=False):
    """A toolkit as the LISTING returns it: schemes are plain strings."""
    return {
        "slug": slug,
        "auth_schemes": schemes,
        "composio_managed_auth_schemes": managed or [],
        "no_auth": no_auth,
    }


def _detail(slug: str, modes: list, managed: list | None = None):
    """A toolkit as the DETAIL endpoint returns it: modes inside auth_config_details."""
    return {
        "slug": slug,
        "auth_config_details": [{"name": slug, "mode": m} for m in modes],
        "composio_managed_auth_schemes": managed or [],
    }


CONNECTABLE = [
    # no-auth branch
    pytest.param(_listing("text_to_pdf", ["NO_AUTH"], no_auth=True), id="no_auth"),
    # api_key branch: it picks the first non-OAuth mode, so BASIC qualifies too
    pytest.param(_listing("mixmax", ["API_KEY"]), id="api_key"),
    pytest.param(_listing("mixpanel", ["BASIC"]), id="basic"),
    pytest.param(_listing("onepage", ["BEARER_TOKEN"]), id="bearer"),
    # managed-app branch
    pytest.param(_listing("gmail", ["OAUTH2"], managed=["OAUTH2"]), id="managed_oauth"),
    # unmanaged DCR branch — the MCP family, made connectable by f2cd74a014
    pytest.param(_listing("granola_mcp", ["DCR_OAUTH"]), id="unmanaged_dcr"),
    # Unmanaged OAuth stays VISIBLE on purpose: it fails today only for want of a
    # bring-your-own-app branch, and hiding twitter or xero is not the fix for that.
    pytest.param(_listing("twitter", ["OAUTH2"]), id="unmanaged_oauth_stays"),
]

UNCONNECTABLE = [
    # No branch can name S2S_OAUTH2: it reads as OAuth so api_key skips it, and with no
    # managed app the flow falls through to `use_composio_managed_auth` with nothing.
    pytest.param(_listing("paypal", ["S2S_OAUTH2"]), id="s2s_oauth2"),
    pytest.param(_listing("sap_successfactors", ["SAML"]), id="saml"),
    # Advertises nothing at all; there is no scheme to build a config from.
    pytest.param(_listing("breezy_hr", []), id="no_schemes_listed"),
]


@pytest.mark.parametrize("toolkit", CONNECTABLE)
def test_a_toolkit_some_branch_can_name_is_offered(toolkit):
    assert can_connect_toolkit(toolkit) is True


@pytest.mark.parametrize("toolkit", UNCONNECTABLE)
def test_a_toolkit_no_branch_can_name_is_dropped(toolkit):
    assert can_connect_toolkit(toolkit) is False


@pytest.mark.parametrize(
    "toolkit",
    [
        pytest.param(_detail("gmail", ["OAUTH2"], managed=["OAUTH2"]), id="managed"),
        pytest.param(_detail("granola_mcp", ["DCR_OAUTH"]), id="dcr"),
        pytest.param(_detail("codeinterpreter", ["NO_AUTH"]), id="no_auth"),
        pytest.param(_detail("mixmax", ["API_KEY"]), id="api_key"),
    ],
)
def test_the_detail_shape_reaches_the_same_verdict(toolkit):
    # The connect flow reads `auth_config_details`; the catalog reads `auth_schemes`.
    # One toolkit must not be connectable through one shape and not the other.
    assert can_connect_toolkit(toolkit) is True


def test_the_detail_shape_also_drops_what_no_branch_can_name():
    assert can_connect_toolkit(_detail("paypal", ["S2S_OAUTH2"])) is False


def test_a_managed_app_wins_whatever_the_scheme_is_called():
    # Composio brokering its own app is enough on its own: we never name the scheme.
    toolkit = _listing("odd_one", ["SOMETHING_NEW"], managed=["OAUTH2"])
    assert can_connect_toolkit(toolkit) is True


def test_the_scheme_set_matches_the_branches_it_documents():
    # A tripwire, not a tautology: adding a scheme here without adding the branch that
    # handles it silently un-hides a toolkit nobody can connect. Whoever edits the set
    # has to edit this list too, which is where they read the comment above it.
    assert CONNECTABLE_AUTH_SCHEMES == frozenset(
        {"NO_AUTH", "API_KEY", "BASIC", "BEARER_TOKEN", "OAUTH1", "OAUTH2", "DCR_OAUTH"}
    )
    assert "S2S_OAUTH2" not in CONNECTABLE_AUTH_SCHEMES
    assert "SAML" not in CONNECTABLE_AUTH_SCHEMES


def test_scheme_names_are_matched_case_and_space_insensitively():
    # Composio has returned lowercase modes on the detail endpoint before.
    assert can_connect_toolkit(_listing("x", [" oauth2 "], managed=["OAUTH2"])) is True
    assert can_connect_toolkit(_detail("y", ["dcr_oauth"])) is True

"""Regression: `GET /toolkits/{slug}` auth-scheme parsing for toolkits with no Composio-
managed auth config.

Live evidence: telegram has NO `composio_managed_auth_schemes` at all (Composio only
offers `use_custom_auth` for it — see the connections adapter's identical 404, "Default
auth config not found for toolkit telegram... Use type use_custom_auth with your own
credentials instead"). Before this fix, `_parse_integration_detail` read only
`composio_managed_auth_schemes`, so ``integration.auth_schemes`` came back ``None`` for
telegram — every caller that picks a connect mode from that field (the settings
ConnectModal's `resolveAvailableModes`, and any future caller doing the same for the
agent connect widget) falls back to "oauth", which Composio then 404s on. Falling back to
`auth_config_details` (the same field the connections adapter already reads to choose
`use_custom_auth`'s authScheme) fixes the signal at the source.
"""

from __future__ import annotations

from oss.src.core.gateway.catalog.dtos import CatalogAuthScheme
from oss.src.core.gateway.catalog.providers.composio.adapter import (
    _parse_integration_detail,
)


def test_no_managed_auth_falls_back_to_auth_config_details():
    """telegram-shaped payload: empty managed schemes, a real custom auth_config_details."""
    item = {
        "slug": "telegram",
        "name": "Telegram",
        "meta": {"description": "d", "categories": []},
        "composio_managed_auth_schemes": [],
        "auth_config_details": [{"name": "Telegram", "mode": "API_KEY"}],
    }
    integration = _parse_integration_detail(item)
    assert integration.auth_schemes == [CatalogAuthScheme.API_KEY]


def test_no_managed_auth_bearer_token_mode_maps_to_api_key():
    """Any non-oauth custom mode (not just the literal 'API_KEY') counts as api_key —
    mirrors the connections adapter's own `"oauth" not in mode.lower()` heuristic."""
    item = {
        "slug": "telegram",
        "name": "Telegram",
        "meta": {},
        "auth_config_details": [{"name": "Telegram", "mode": "BEARER_TOKEN"}],
    }
    integration = _parse_integration_detail(item)
    assert integration.auth_schemes == [CatalogAuthScheme.API_KEY]


def test_no_auth_toolkit_reports_no_auth_schemes():
    """A NO_AUTH-only toolkit (e.g. codeinterpreter) must not be reported as api_key —
    it needs no auth_scheme selection at all."""
    item = {
        "slug": "codeinterpreter",
        "name": "Code Interpreter",
        "meta": {},
        "auth_config_details": [{"mode": "NO_AUTH"}],
    }
    integration = _parse_integration_detail(item)
    assert integration.auth_schemes is None


def test_managed_auth_schemes_present_skips_fallback():
    """Regression guard: an integration WITH managed auth (e.g. github) keeps reading
    from `composio_managed_auth_schemes` and never touches the fallback."""
    item = {
        "slug": "github",
        "name": "GitHub",
        "meta": {},
        "composio_managed_auth_schemes": [{"name": "oauth2"}],
        # If the fallback fired here it would ALSO report api_key — assert it doesn't.
        "auth_config_details": [
            {"name": "OAuth", "mode": "OAUTH2"},
            {"name": "API Key", "mode": "API_KEY"},
        ],
    }
    integration = _parse_integration_detail(item)
    assert integration.auth_schemes == [CatalogAuthScheme.OAUTH]

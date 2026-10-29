"""PY-C7: the provider->env-var copies must never drift again (minimax was missing).

WP14 removed the third copy (`platform.secrets._PROVIDER_ENV_VARS`) along with the whole-vault
`resolve_provider_keys` dump it existed for; two copies remain.
"""

from __future__ import annotations

from agenta.sdk.agents.capabilities import PROVIDER_ENV_VARS
from agenta.sdk.agents.connections import resolver as offline_resolver
from agenta.sdk.agents.platform import connections as platform_connections


def test_minimax_present_in_canonical_map() -> None:
    assert PROVIDER_ENV_VARS.get("minimax") == "MINIMAX_API_KEY"


def test_all_copies_match_canonical_map() -> None:
    assert platform_connections._PROVIDER_ENV_VARS == PROVIDER_ENV_VARS
    assert offline_resolver._PROVIDER_ENV_VARS == PROVIDER_ENV_VARS

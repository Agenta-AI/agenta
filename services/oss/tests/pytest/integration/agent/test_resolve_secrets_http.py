"""``resolve_harness_secrets`` against a mocked ``GET /secrets/``.

Best-effort by design: it maps only ``provider_key`` vault entries to env vars, dedupes by
env var, and returns ``{}`` on any error rather than failing the run.
"""

from __future__ import annotations

import pytest

from oss.src.agent import secrets
from oss.src.agent.secrets import resolve_harness_secrets

pytestmark = pytest.mark.integration


async def test_no_api_base_returns_empty(install_http):
    install_http(secrets, api_base=None)
    assert await resolve_harness_secrets() == {}


async def test_maps_only_provider_keys_with_dedupe(install_http):
    install_http(
        secrets,
        status=200,
        payload=[
            {
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {"key": "sk-1"}},
            },
            # duplicate env var -> first one wins (setdefault).
            {
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {"key": "sk-2"}},
            },
            {
                "kind": "provider_key",
                "data": {"kind": "anthropic", "provider": {"key": "sk-ant"}},
            },
            # not a provider key -> ignored.
            {"kind": "other", "data": {"kind": "openai", "provider": {"key": "x"}}},
            # unmapped provider -> ignored.
            {
                "kind": "provider_key",
                "data": {"kind": "made_up", "provider": {"key": "y"}},
            },
            # missing key -> ignored.
            {"kind": "provider_key", "data": {"kind": "groq", "provider": {}}},
        ],
    )

    env = await resolve_harness_secrets()

    assert env == {"OPENAI_API_KEY": "sk-1", "ANTHROPIC_API_KEY": "sk-ant"}


async def test_http_error_returns_empty(install_http):
    install_http(secrets, status=400)
    assert await resolve_harness_secrets() == {}


async def test_network_exception_returns_empty(install_http):
    install_http(secrets, raises=RuntimeError("network down"))
    assert await resolve_harness_secrets() == {}

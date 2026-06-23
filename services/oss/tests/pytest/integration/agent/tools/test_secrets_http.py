from __future__ import annotations

import pytest

from oss.src.agent.tools import secrets

pytestmark = pytest.mark.integration


async def test_named_secrets_are_resolved_by_tools_adapter(install_http):
    capture = install_http(
        secrets,
        payload={"secrets": {"TOKEN": "value", "EMPTY": None}},
    )

    resolved = await secrets.resolve_named_secrets(["TOKEN", "EMPTY", "MISSING"])

    assert resolved == {"TOKEN": "value"}
    assert capture == {
        "method": "POST",
        "url": "https://api.x/api/secrets/resolve",
        "json": {"names": ["TOKEN", "EMPTY", "MISSING"]},
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Access tok",
        },
    }


async def test_named_secrets_without_api_base_return_empty(install_http):
    install_http(secrets, api_base=None)

    assert await secrets.resolve_named_secrets(["TOKEN"]) == {}


async def test_named_secret_http_failure_returns_empty(install_http):
    install_http(secrets, status=500)

    assert await secrets.resolve_named_secrets(["TOKEN"]) == {}

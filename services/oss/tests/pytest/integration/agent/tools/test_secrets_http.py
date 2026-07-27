from __future__ import annotations

import pytest

from oss.src.agent.tools import secrets
from agenta.sdk.agents.platform import secrets as platform_secrets

pytestmark = pytest.mark.integration


async def test_named_secrets_are_resolved_by_tools_adapter(install_http):
    capture = install_http(
        platform_secrets,
        payload={
            "kind": "custom_secret",
            "slug": "TOKEN",
            "data": {"secret": {"format": "text", "content": "value"}},
        },
    )

    resolved = await secrets.resolve_named_secrets(["TOKEN"])

    assert resolved == {"TOKEN": "value"}
    assert capture == {
        "method": "GET",
        "url": "https://api.x/api/secrets/TOKEN",
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Access tok",
        },
    }


async def test_named_secrets_without_api_base_return_empty(install_http):
    install_http(platform_secrets, api_base=None)

    assert await secrets.resolve_named_secrets(["TOKEN"]) == {}


async def test_named_secret_http_failure_returns_empty(install_http):
    install_http(platform_secrets, status=500)

    assert await secrets.resolve_named_secrets(["TOKEN"]) == {}

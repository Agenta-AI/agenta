"""Contract checks for the pinned official MCP OAuth SDK.

The dashboard has separate begin and callback requests, while the SDK provider keeps an
inline HTTPX auth coroutine. These tests pin the boundary we rely on: the vault adapter
implements the SDK storage protocol and the public gateway DTOs carry only secret handles.
"""

import importlib.metadata
import inspect
from uuid import uuid4

from mcp.client.auth.oauth2 import OAuthClientProvider, TokenStorage
from mcp.shared.auth import OAuthClientMetadata

from oss.src.core.gateways.mcps.oauth.dtos import MCPOAuthCompletion
from oss.src.core.gateways.mcps.oauth.storage import SecretsTokenStorage


def test_mcp_sdk_version_and_token_storage_contract_are_pinned():
    assert importlib.metadata.version("mcp") == "1.29.0"

    expected_methods = {
        "get_tokens",
        "set_tokens",
        "get_client_info",
        "set_client_info",
    }
    assert expected_methods <= set(TokenStorage.__annotations__) | set(
        dir(TokenStorage)
    )
    for method in expected_methods:
        assert inspect.iscoroutinefunction(getattr(SecretsTokenStorage, method))


def test_sdk_provider_accepts_the_secrets_backed_storage_contract():
    """Construction exercises the SDK's real public provider/storage boundary.

    No redirect is performed here: a dashboard callback is a later HTTP request, and
    this test deliberately proves provider construction cannot open a local browser.
    """

    storage = SecretsTokenStorage(
        vault_service=None,
        project_id=uuid4(),
        server_url="https://mcp.example.test/",
    )

    async def redirect_handler(_url: str) -> None:
        raise AssertionError("unit test must not follow an authorization redirect")

    async def callback_handler() -> tuple[str, str | None]:
        raise AssertionError("unit test must not wait for a browser callback")

    provider = OAuthClientProvider(
        server_url="https://mcp.example.test/",
        client_metadata=OAuthClientMetadata(
            redirect_uris=["https://api.example.test/gateways/mcps/connect/callback"],
            grant_types=["authorization_code", "refresh_token"],
            response_types=["code"],
        ),
        storage=storage,
        redirect_handler=redirect_handler,
        callback_handler=callback_handler,
    )

    assert provider.context.storage is storage
    assert provider.context.redirect_handler is redirect_handler
    assert provider.context.callback_handler is callback_handler


def test_completion_wire_shape_contains_a_secret_handle_never_tokens():
    completion = MCPOAuthCompletion(
        project_id=uuid4(),
        server_url="https://mcp.example.test/",
        secret_id=uuid4(),
    )

    payload = completion.model_dump(mode="json")
    assert set(payload) == {"project_id", "server_url", "secret_id"}
    assert "access_token" not in payload
    assert "refresh_token" not in payload

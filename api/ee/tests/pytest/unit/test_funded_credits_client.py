"""Unit tests for the funded-credits proxy admin client
(``ee.src.core.funded_credits.client``) against a mocked proxy."""

import httpx
import pytest

from ee.src.core.funded_credits.client import FundedCreditsProxyClient
from ee.src.core.funded_credits.types import (
    KeyAliasExistsError,
    ProxyRequestError,
)


def _client_with_handler(handler) -> FundedCreditsProxyClient:
    return FundedCreditsProxyClient(
        base_url="https://proxy.internal.test",
        master_key="sk-master-test",
        transport=httpx.MockTransport(handler),
    )


class TestGenerateKey:
    async def test_sends_master_key_and_required_body(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            seen["auth"] = request.headers.get("Authorization")
            seen["body"] = httpx.Request.read(request)
            return httpx.Response(200, json={"key": "sk-virtual-abc"})

        client = _client_with_handler(handler)
        minted = await client.generate_key(
            key_alias="org-123",
            max_budget=10.0,
            models=["some-model"],
            metadata={"organization_id": "org-123"},
        )

        assert minted.key == "sk-virtual-abc"
        assert minted.key_alias == "org-123"
        assert seen["url"] == "https://proxy.internal.test/key/generate"
        assert seen["auth"] == "Bearer sk-master-test"

        import json

        body = json.loads(seen["body"])
        assert body["key_alias"] == "org-123"
        assert body["max_budget"] == 10.0
        assert body["models"] == ["some-model"]
        assert body["metadata"] == {"organization_id": "org-123"}
        assert "team_id" not in body
        assert "rpm_limit" not in body

    async def test_optional_limits_and_team_are_sent(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            import json

            seen["body"] = json.loads(httpx.Request.read(request))
            return httpx.Response(200, json={"key": "sk-virtual-abc"})

        client = _client_with_handler(handler)
        await client.generate_key(
            key_alias="org-123",
            max_budget=1.0,
            models=["some-model"],
            metadata={},
            team_id="team-1",
            rpm_limit=30,
            tpm_limit=100_000,
        )

        assert seen["body"]["team_id"] == "team-1"
        assert seen["body"]["rpm_limit"] == 30
        assert seen["body"]["tpm_limit"] == 100_000

    async def test_server_error_raises_proxy_request_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(500, text="internal error")

        client = _client_with_handler(handler)
        with pytest.raises(ProxyRequestError) as excinfo:
            await client.generate_key(
                key_alias="org-123",
                max_budget=1.0,
                models=["some-model"],
                metadata={},
            )
        assert excinfo.value.status_code == 500

    async def test_alias_conflict_raises_key_alias_exists(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                400,
                json={"error": {"message": "Unique key_alias required; alias exists"}},
            )

        client = _client_with_handler(handler)
        with pytest.raises(KeyAliasExistsError):
            await client.generate_key(
                key_alias="org-123",
                max_budget=1.0,
                models=["some-model"],
                metadata={},
            )

    async def test_missing_key_in_response_raises(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"expires": None})

        client = _client_with_handler(handler)
        with pytest.raises(ProxyRequestError):
            await client.generate_key(
                key_alias="org-123",
                max_budget=1.0,
                models=["some-model"],
                metadata={},
            )

    async def test_connection_failure_raises_proxy_request_error(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("refused")

        client = _client_with_handler(handler)
        with pytest.raises(ProxyRequestError) as excinfo:
            await client.generate_key(
                key_alias="org-123",
                max_budget=1.0,
                models=["some-model"],
                metadata={},
            )
        assert excinfo.value.status_code is None


class TestBlockKey:
    async def test_posts_to_key_block(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            import json

            seen["url"] = str(request.url)
            seen["body"] = json.loads(httpx.Request.read(request))
            return httpx.Response(200, json={})

        client = _client_with_handler(handler)
        await client.block_key(key="sk-virtual-abc")

        assert seen["url"] == "https://proxy.internal.test/key/block"
        assert seen["body"] == {"key": "sk-virtual-abc"}

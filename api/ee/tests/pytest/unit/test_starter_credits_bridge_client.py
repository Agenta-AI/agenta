"""Unit tests for the starter-credits proxy admin client
(``ee.src.core.starter_credits_bridge.client``) against a mocked proxy."""

import json

import httpx
import pytest

from ee.src.core.starter_credits_bridge.client import StarterCreditsProxyClient
from ee.src.core.starter_credits_bridge.types import (
    KeyAliasExistsError,
    ProxyRequestError,
)


def _client_with_handler(handler) -> StarterCreditsProxyClient:
    return StarterCreditsProxyClient(
        base_url="https://proxy.internal.test",
        master_key="sk-master-test",
        transport=httpx.MockTransport(handler),
    )


def _read_body(request: httpx.Request) -> dict:
    return json.loads(httpx.Request.read(request))


class TestGenerateKey:
    async def test_sends_master_key_and_required_body(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            seen["auth"] = request.headers.get("Authorization")
            seen["body"] = _read_body(request)
            return httpx.Response(200, json={"key": "sk-virtual-abc"})

        client = _client_with_handler(handler)
        minted = await client.generate_key(
            key_alias="org-123",
            max_budget=10.0,
            models=["some-model"],
            metadata={"organization_id": "org-123", "origin": "starter-credits-bridge"},
            team_id="team-1",
        )

        assert minted.key == "sk-virtual-abc"
        assert minted.key_alias == "org-123"
        assert seen["url"] == "https://proxy.internal.test/key/generate"
        assert seen["auth"] == "Bearer sk-master-test"

        body = seen["body"]
        assert body["key_alias"] == "org-123"
        assert body["max_budget"] == 10.0
        assert body["models"] == ["some-model"]
        assert body["metadata"]["origin"] == "starter-credits-bridge"
        assert body["team_id"] == "team-1"
        assert "max_parallel_requests" not in body
        assert "rpm_limit" not in body
        assert "tpm_limit" not in body

    async def test_per_key_limits_are_sent(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["body"] = _read_body(request)
            return httpx.Response(200, json={"key": "sk-virtual-abc"})

        client = _client_with_handler(handler)
        await client.generate_key(
            key_alias="org-123",
            max_budget=10.0,
            models=["some-model"],
            metadata={},
            team_id="team-1",
            max_parallel_requests=2,
            rpm_limit=30,
            tpm_limit=200_000,
        )

        assert seen["body"]["max_parallel_requests"] == 2
        assert seen["body"]["rpm_limit"] == 30
        assert seen["body"]["tpm_limit"] == 200_000

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
                team_id="team-1",
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
                team_id="team-1",
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
                team_id="team-1",
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
                team_id="team-1",
            )
        assert excinfo.value.status_code is None


class TestKeyLifecycle:
    async def test_update_key_posts_metadata(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            seen["body"] = _read_body(request)
            return httpx.Response(200, json={})

        client = _client_with_handler(handler)
        await client.update_key(
            key="sk-virtual-abc",
            metadata={"secret_id": "sec-1", "origin": "starter-credits-bridge"},
        )

        assert seen["url"] == "https://proxy.internal.test/key/update"
        assert seen["body"] == {
            "key": "sk-virtual-abc",
            "metadata": {"secret_id": "sec-1", "origin": "starter-credits-bridge"},
        }

    async def test_delete_keys_by_alias(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            seen["body"] = _read_body(request)
            return httpx.Response(200, json={})

        client = _client_with_handler(handler)
        await client.delete_keys(key_aliases=["org-123"])

        assert seen["url"] == "https://proxy.internal.test/key/delete"
        assert seen["body"] == {"key_aliases": ["org-123"]}

    async def test_list_keys_returns_dict_entries(self):
        def handler(request: httpx.Request) -> httpx.Response:
            assert request.url.params["key_alias"] == "org-123"
            assert request.url.params["return_full_object"] == "true"
            return httpx.Response(
                200,
                json={
                    "keys": [
                        {"key_alias": "org-123", "metadata": {"origin": "x"}},
                        "sk-opaque-hash",
                    ]
                },
            )

        client = _client_with_handler(handler)
        keys = await client.list_keys(key_alias="org-123")

        assert keys == [{"key_alias": "org-123", "metadata": {"origin": "x"}}]

    async def test_block_key_posts_to_key_block(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            seen["body"] = _read_body(request)
            return httpx.Response(200, json={})

        client = _client_with_handler(handler)
        await client.block_key(key="sk-virtual-abc")

        assert seen["url"] == "https://proxy.internal.test/key/block"
        assert seen["body"] == {"key": "sk-virtual-abc"}


class TestTeamInfo:
    async def test_get_team_info_queries_team_id(self):
        def handler(request: httpx.Request) -> httpx.Response:
            assert str(request.url).startswith("https://proxy.internal.test/team/info")
            assert request.url.params["team_id"] == "team-1"
            return httpx.Response(
                200,
                json={"team_id": "team-1", "team_info": {"max_budget": 500.0}},
            )

        client = _client_with_handler(handler)
        payload = await client.get_team_info(team_id="team-1")

        assert payload["team_info"]["max_budget"] == 500.0

    async def test_missing_team_raises(self):
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404, json={"error": {"message": "team not found"}})

        client = _client_with_handler(handler)
        with pytest.raises(ProxyRequestError) as excinfo:
            await client.get_team_info(team_id="team-1")
        assert excinfo.value.status_code == 404

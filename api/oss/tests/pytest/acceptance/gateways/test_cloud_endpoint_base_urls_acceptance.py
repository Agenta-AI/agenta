"""WP32's OSS/EE local-cloud socket acceptance, with no AWS/GCP credentials."""

import os
from urllib.parse import urlsplit
from uuid import uuid4

import pytest


_MOCKS_ENABLED = os.getenv("AGENTA_GATEWAYS_MOCKS_ENABLED", "").lower() == "true"
_UPSTREAM_TOKEN = os.getenv("AGENTA_GATEWAYS_MOCKS_UPSTREAM_TOKEN")
_MOCK_LLM_URL = os.getenv("AGENTA_MOCK_LLM_GATEWAY_URL", "http://mock-llm-gateway:9091")

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.skipif(
        not _MOCKS_ENABLED,
        reason="WP32 local-cloud acceptance requires AGENTA_GATEWAYS_MOCKS_ENABLED=true",
    ),
]


def _assert_ok(response):
    assert response.status_code == 200, response.text
    return response.json()


def _mock_origin() -> str:
    parsed = urlsplit(_MOCK_LLM_URL)
    return f"{parsed.scheme}://{parsed.netloc}"


def _cloud_fixture(deployment_kind: str) -> tuple[str, dict, dict]:
    origin = _mock_origin()
    if deployment_kind == "bedrock":
        return (
            origin,
            {"aws_bearer_token_bedrock": _UPSTREAM_TOKEN},
            {"region": "us-east-1"},  # must lose to explicit origin
        )
    return (
        f"{origin}/v1/projects/wp32-project/locations/europe-west4",
        {"vertex_ai_credentials": "agenta-gateway-mock"},
        {
            "region": "us-east-1",  # must lose to explicit prefix
            "extras": {"vertex_project": "wrong-project"},
        },
    )


def _create_cloud_secret(authed_api, *, extras: dict) -> str:
    assert _UPSTREAM_TOKEN, "gateway mock upstream token must be configured"
    return _assert_ok(
        authed_api(
            "POST",
            "/secrets/",
            json={
                "header": {"name": f"wp32-{uuid4().hex[:8]}"},
                "secret": {
                    "kind": "custom_provider",
                    "data": {
                        "kind": "custom",
                        "provider": {"key": _UPSTREAM_TOKEN, "extras": extras},
                        "models": [],
                    },
                },
            },
        )
    )["id"]


@pytest.mark.parametrize("deployment_kind", ["bedrock", "vertex_ai"])
def test_oss_and_ee_cloud_fixtures_use_explicit_base_url_on_every_socket_door(
    authed_api, gateway_api, deployment_kind
):
    base_url, secret_extras, route_extras = _cloud_fixture(deployment_kind)
    secret_id = _create_cloud_secret(authed_api, extras=secret_extras)
    slug = f"wp32-{deployment_kind}-{uuid4().hex[:8]}"
    endpoint = None
    try:
        endpoint = _assert_ok(
            authed_api(
                "POST",
                "/gateways/llms/endpoints/",
                json={
                    "endpoint": {
                        "slug": slug,
                        "provider_key": "cloud-fixture",
                        "deployment_kind": deployment_kind,
                        "secret_id": secret_id,
                        "data": {
                            "route": {
                                "base_url": base_url,
                                "headers": {
                                    "X-Agenta-Mock-Profile": f"wp32-{deployment_kind}"
                                },
                                **route_extras,
                            },
                            "models": {"allowlist": ["claude-3-5-sonnet"]},
                        },
                    }
                },
            )
        )["endpoint"]

        fetched = _assert_ok(
            authed_api("GET", f"/gateways/llms/endpoints/{endpoint['id']}")
        )["endpoint"]
        assert fetched["data"]["route"]["base_url"] == base_url

        calls = (
            ("chat/completions", {"model": "claude-3-5-sonnet", "messages": []}),
            ("responses", {"model": "claude-3-5-sonnet", "input": []}),
            (
                "messages",
                {"model": "claude-3-5-sonnet", "max_tokens": 8, "messages": []},
            ),
        )
        for door, payload in calls:
            response = gateway_api(
                "POST", f"/gateways/llms/custom/{slug}/v1/{door}", json=payload
            )
            assert response.status_code == 200, response.text
            assert (
                response.headers["x-agenta-mock-profile"] == f"wp32-{deployment_kind}"
            )
    finally:
        if endpoint is not None:
            authed_api("DELETE", f"/gateways/llms/endpoints/{endpoint['id']}")
        authed_api("DELETE", f"/secrets/{secret_id}")

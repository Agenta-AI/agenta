"""Stored Bedrock/Vertex endpoint fixtures, without cloud credentials or sockets."""

import json

import pytest

from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMEndpointCreate,
    LLMEndpointData,
    LLMEndpointRoute,
    LLMModelFilter,
    LLMProtocol,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.providers.passthrough.routing import build_url
from oss.src.core.gateways.llms.providers.passthrough.static_fields import (
    apply_static_fields,
)
from oss.src.dbs.postgres.gateways.llms.dao import LLMEndpointsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine


pytestmark = [pytest.mark.asyncio, pytest.mark.integration]


_BEDROCK_BASE = "https://bedrock-vpce.private.example:8443"
_VERTEX_BASE = (
    "https://vertex-private.example:9443/v1/projects/acme-prod/locations/europe-west4"
)


def _create(*, slug: str, deployment_kind: LLMDeploymentKind, base_url: str):
    return LLMEndpointCreate(
        slug=slug,
        provider_key="cloud-fixture",
        deployment_kind=deployment_kind,
        data=LLMEndpointData(
            route=LLMEndpointRoute(
                base_url=base_url,
                region="us-east-1",  # a differing fallback must never win
                extras={"vertex_project": "wrong-project"},
            ),
            models=LLMModelFilter(allowlist=["claude-3-5-sonnet"]),
        ),
    )


def _route(endpoint, *, model="claude-3-5-sonnet"):
    return LLMResolvedRoute(
        provider_key=endpoint.provider_key,
        deployment_kind=endpoint.deployment_kind,
        model=model,
        base_url=endpoint.data.route.base_url,
        region=endpoint.data.route.region,
        extras=endpoint.data.route.extras,
    )


async def test_registered_bedrock_fixture_uses_its_custom_host_for_every_door(
    seeded_project,
):
    dao = LLMEndpointsDAO(engine=get_transactions_engine())
    endpoint = await dao.create_endpoint(
        project_id=seeded_project["project_id"],
        user_id=seeded_project["user_id"],
        endpoint=_create(
            slug="wp32-bedrock-private",
            deployment_kind=LLMDeploymentKind.BEDROCK,
            base_url=_BEDROCK_BASE,
        ),
    )
    assert endpoint is not None

    persisted = await dao.fetch_endpoint(
        project_id=seeded_project["project_id"], endpoint_id=endpoint.id
    )
    assert persisted is not None
    route = _route(persisted)

    assert build_url(route, LLMProtocol.CHAT_COMPLETIONS) == (
        f"{_BEDROCK_BASE}/v1/chat/completions"
    )
    assert build_url(route, LLMProtocol.RESPONSES) == f"{_BEDROCK_BASE}/v1/responses"
    assert build_url(route, LLMProtocol.MESSAGES) == (
        f"{_BEDROCK_BASE}/anthropic/v1/messages"
    )


async def test_registered_vertex_fixture_uses_its_custom_prefix_on_every_door_and_rewrite(
    seeded_project,
):
    dao = LLMEndpointsDAO(engine=get_transactions_engine())
    endpoint = await dao.create_endpoint(
        project_id=seeded_project["project_id"],
        user_id=seeded_project["user_id"],
        endpoint=_create(
            slug="wp32-vertex-private",
            deployment_kind=LLMDeploymentKind.VERTEX,
            base_url=_VERTEX_BASE,
        ),
    )
    assert endpoint is not None

    persisted = await dao.fetch_endpoint(
        project_id=seeded_project["project_id"], endpoint_id=endpoint.id
    )
    assert persisted is not None
    route = _route(persisted)

    assert build_url(route, LLMProtocol.CHAT_COMPLETIONS) == (
        f"{_VERTEX_BASE}/endpoints/openapi/chat/completions"
    )
    assert build_url(route, LLMProtocol.RESPONSES) == (
        f"{_VERTEX_BASE}/endpoints/openapi/responses"
    )
    assert build_url(route, LLMProtocol.MESSAGES) == (
        f"{_VERTEX_BASE}/publishers/anthropic/models/claude-3-5-sonnet:rawPredict"
    )
    assert build_url(route, LLMProtocol.MESSAGES, stream=True) == (
        f"{_VERTEX_BASE}/publishers/anthropic/models/claude-3-5-sonnet:streamRawPredict"
    )

    rewritten = apply_static_fields(
        deployment_kind=LLMDeploymentKind.VERTEX,
        protocol=LLMProtocol.MESSAGES,
        body=json.dumps({"model": "claude-3-5-sonnet", "messages": []}).encode(),
    )
    assert json.loads(rewritten) == {
        "messages": [],
        "anthropic_version": "vertex-2023-10-16",
    }

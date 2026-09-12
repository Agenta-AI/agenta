"""DTO <-> DBE mapping round-trips (entities.md §2, §3, §4.3, §4.4).

Pure Python object transforms — no database, no session. `map_*_create_to_dbe`
returns a DBE that has never been flushed, so `id`/`created_at`/... are filled in
by hand here to stand in for what a real INSERT ... RETURNING would populate,
exactly the way `session.refresh()` would before a real mapping-back call.
"""

from datetime import datetime, timezone
from uuid import uuid4

from oss.src.core.gateways.mcps.dtos import MCPAuthScheme, GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMEndpointCreate,
    LLMEndpointData,
    LLMEndpointFlags,
    LLMEndpointRoute,
    LLMEndpointSettings,
    LLMModelFilter,
)
from oss.src.core.gateways.mcps.dtos import (
    MCPEndpointSettings,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointFlags,
    MCPOAuthData,
    MCPEndpointRoute,
    MCPToolFilter,
)
from oss.src.dbs.postgres.gateways.llms.mappings import (
    map_llm_endpoint_create_to_dbe,
    map_llm_endpoint_dbe_to_dto,
)
from oss.src.dbs.postgres.gateways.mcps.mappings import (
    map_mcp_endpoint_create_to_dbe,
    map_mcp_endpoint_dbe_to_dto,
)


def _stamp_lifecycle(dbe):
    """Stand in for what a flush/refresh would populate on the row."""
    dbe.id = uuid4()
    dbe.created_at = datetime.now(timezone.utc)
    dbe.updated_at = None
    dbe.deleted_at = None
    dbe.updated_by_id = None
    dbe.deleted_by_id = None
    return dbe


# --- serialization: seed DTOs dump to the shape the mappings expect ---------- #


def test_llm_endpoint_data_serializes_exclude_none():
    data = LLMEndpointData(
        route=LLMEndpointRoute(base_url="http://mock-llm-gateway:9091/v1"),
        models=LLMModelFilter(allowlist=["gpt-4o"]),
        settings=LLMEndpointSettings(max_output_tokens=4096),
    )
    dumped = data.model_dump(mode="json", exclude_none=True)
    assert dumped["route"]["base_url"] == "http://mock-llm-gateway:9091/v1"
    assert dumped["models"]["allowlist"] == ["gpt-4o"]
    assert "extras" not in dumped


def test_llm_endpoint_flags_serializes_exclude_none():
    flags = LLMEndpointFlags()
    assert flags.model_dump(mode="json", exclude_none=True) == {"is_active": True}


def test_mcp_endpoint_data_serializes_exclude_none():
    data = MCPEndpointData(
        route=MCPEndpointRoute(base_url="https://mcp.acme.com"),
        tools=MCPToolFilter(allowlist=["search"]),
        settings=MCPEndpointSettings(timeout_seconds=10.0),
        oauth=MCPOAuthData(resource="https://mcp.acme.com"),
    )
    dumped = data.model_dump(mode="json", exclude_none=True)
    assert dumped["route"]["base_url"] == "https://mcp.acme.com"
    assert dumped["tools"]["allowlist"] == ["search"]
    assert dumped["oauth"]["resource"] == "https://mcp.acme.com"


def test_mcp_endpoint_flags_serializes_exclude_none():
    flags = MCPEndpointFlags()
    assert flags.model_dump(mode="json", exclude_none=True) == {
        "is_active": True,
        "is_valid": True,
    }


# --- LLM endpoint round-trip --------------------------------------------------- #


def test_llm_endpoint_create_round_trips_through_dbe():
    project_id = uuid4()
    user_id = uuid4()
    secret_id = uuid4()

    create = LLMEndpointCreate(
        slug="acme-azure",
        name="Acme Azure",
        description="Acme's Azure OpenAI deployment_kind",
        provider_key="azure",
        deployment_kind=LLMDeploymentKind.AZURE,
        secret_id=secret_id,
        data=LLMEndpointData(
            route=LLMEndpointRoute(base_url="http://mock-llm-gateway:9091/azure"),
            models=LLMModelFilter(allowlist=["gpt-4o"]),
            settings=LLMEndpointSettings(max_output_tokens=4096),
        ),
        flags=LLMEndpointFlags(is_active=True),
        tags={"env": "prod"},
        meta={"note": "created by test"},
    )

    dbe = map_llm_endpoint_create_to_dbe(
        project_id=project_id,
        user_id=user_id,
        #
        dto=create,
    )
    assert dbe.project_id == project_id
    assert dbe.created_by_id == user_id
    _stamp_lifecycle(dbe)

    endpoint = map_llm_endpoint_dbe_to_dto(dbe=dbe)

    assert endpoint.id == dbe.id
    assert endpoint.slug == create.slug
    assert endpoint.name == create.name
    assert endpoint.description == create.description
    assert endpoint.provider_key == create.provider_key
    assert endpoint.deployment_kind == create.deployment_kind
    assert endpoint.secret_id == secret_id
    assert endpoint.namespace == GatewayEndpointNamespace.CUSTOM
    assert endpoint.data.route.base_url == create.data.route.base_url
    assert endpoint.data.models.allowlist == create.data.models.allowlist
    assert endpoint.data.settings.max_output_tokens == 4096
    assert endpoint.flags.is_active is True
    assert endpoint.tags == create.tags
    assert endpoint.meta == create.meta
    assert endpoint.created_by_id == user_id


# --- MCP endpoint round-trip --------------------------------------------------- #


def test_mcp_endpoint_create_round_trips_through_dbe():
    project_id = uuid4()
    user_id = uuid4()
    secret_id = uuid4()

    create = MCPEndpointCreate(
        slug="acme-notion",
        name="Acme Notion",
        description="Acme's self-hosted Notion MCP server",
        auth_mode=MCPAuthScheme.OAUTH,
        secret_id=secret_id,
        data=MCPEndpointData(
            route=MCPEndpointRoute(base_url="https://mcp.acme.com"),
            tools=MCPToolFilter(allowlist=["search"]),
            settings=MCPEndpointSettings(timeout_seconds=10.0),
        ),
        flags=MCPEndpointFlags(is_active=True),
        tags={"env": "prod"},
        meta={"note": "created by test"},
    )

    dbe = map_mcp_endpoint_create_to_dbe(
        project_id=project_id,
        user_id=user_id,
        #
        dto=create,
    )
    assert dbe.project_id == project_id
    assert dbe.created_by_id == user_id
    _stamp_lifecycle(dbe)

    endpoint = map_mcp_endpoint_dbe_to_dto(dbe=dbe)

    assert endpoint.id == dbe.id
    assert endpoint.slug == create.slug
    assert endpoint.name == create.name
    assert endpoint.description == create.description
    assert endpoint.auth_mode == create.auth_mode
    assert endpoint.secret_id == secret_id
    assert endpoint.namespace == GatewayEndpointNamespace.CUSTOM
    assert endpoint.connection_id is None
    assert endpoint.provider_key is None
    assert endpoint.integration_key is None
    assert endpoint.data.route.base_url == create.data.route.base_url
    assert endpoint.data.tools.allowlist == ["search"]
    assert endpoint.flags.is_active is True
    assert endpoint.tags == create.tags
    assert endpoint.meta == create.meta
    assert endpoint.created_by_id == user_id


# --- MCP grant round-trip ------------------------------------------------------ #

"""DTO <-> DBE mapping round-trips (entities.md §2, §3, §4.3, §4.4).

Pure Python object transforms — no database, no session. `map_*_create_to_dbe`
returns a DBE that has never been flushed, so `id`/`created_at`/... are filled in
by hand here to stand in for what a real INSERT ... RETURNING would populate,
exactly the way `session.refresh()` would before a real mapping-back call.
"""

from datetime import datetime, timezone
from uuid import uuid4

from oss.src.core.gateways.dtos import GatewayAuthScheme, GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import (
    LlmDeploymentKind,
    LlmEndpointConfig,
    LlmEndpointCreate,
    LlmEndpointData,
    LlmEndpointFlags,
    LlmEndpointRoute,
)
from oss.src.core.gateways.mcps.dtos import (
    McpEndpointConfig,
    McpEndpointCreate,
    McpEndpointData,
    McpEndpointFlags,
    McpGrantCreate,
    McpGrantFlags,
    McpOAuthData,
    McpToolPolicy,
    McpToolPolicyMode,
)
from oss.src.dbs.postgres.gateways.llms.mappings import (
    map_llm_endpoint_create_to_dbe,
    map_llm_endpoint_dbe_to_dto,
)
from oss.src.dbs.postgres.gateways.mcps.mappings import (
    map_mcp_endpoint_create_to_dbe,
    map_mcp_endpoint_dbe_to_dto,
    map_mcp_grant_create_to_dbe,
    map_mcp_grant_dbe_to_dto,
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
    data = LlmEndpointData(
        route=LlmEndpointRoute(base_url="https://api.openai.com/v1"),
        model_slugs=["gpt-4o"],
        config=LlmEndpointConfig(max_output_tokens=4096),
    )
    dumped = data.model_dump(mode="json", exclude_none=True)
    assert dumped["route"]["base_url"] == "https://api.openai.com/v1"
    assert dumped["model_slugs"] == ["gpt-4o"]
    assert "extras" not in dumped


def test_llm_endpoint_flags_serializes_exclude_none():
    flags = LlmEndpointFlags()
    assert flags.model_dump(mode="json", exclude_none=True) == {"is_active": True}


def test_mcp_endpoint_data_serializes_exclude_none():
    data = McpEndpointData(
        url="https://mcp.acme.com",
        tool_policy=McpToolPolicy(mode=McpToolPolicyMode.INCLUDE, names=["search"]),
        config=McpEndpointConfig(timeout_seconds=10.0),
        oauth=McpOAuthData(resource="https://mcp.acme.com"),
    )
    dumped = data.model_dump(mode="json", exclude_none=True)
    assert dumped["url"] == "https://mcp.acme.com"
    assert dumped["tool_policy"]["mode"] == "include"
    assert dumped["oauth"]["resource"] == "https://mcp.acme.com"


def test_mcp_endpoint_flags_serializes_exclude_none():
    flags = McpEndpointFlags()
    assert flags.model_dump(mode="json", exclude_none=True) == {"is_active": True}


def test_mcp_grant_flags_serializes_exclude_none():
    flags = McpGrantFlags()
    assert flags.model_dump(mode="json", exclude_none=True) == {
        "is_active": True,
        "is_valid": True,
    }


# --- LLM endpoint round-trip --------------------------------------------------- #


def test_llm_endpoint_create_round_trips_through_dbe():
    project_id = uuid4()
    user_id = uuid4()
    secret_id = uuid4()

    create = LlmEndpointCreate(
        slug="acme-azure",
        name="Acme Azure",
        description="Acme's Azure OpenAI deployment",
        provider_key="azure",
        deployment=LlmDeploymentKind.AZURE,
        secret_id=secret_id,
        data=LlmEndpointData(
            route=LlmEndpointRoute(base_url="https://acme.openai.azure.com"),
            model_slugs=["gpt-4o"],
            config=LlmEndpointConfig(max_output_tokens=4096),
        ),
        flags=LlmEndpointFlags(is_active=True),
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
    assert endpoint.deployment == create.deployment
    assert endpoint.secret_id == secret_id
    assert endpoint.namespace == GatewayEndpointNamespace.CUSTOM
    assert endpoint.data.route.base_url == create.data.route.base_url
    assert endpoint.data.model_slugs == create.data.model_slugs
    assert endpoint.data.config.max_output_tokens == 4096
    assert endpoint.flags.is_active is True
    assert endpoint.tags == create.tags
    assert endpoint.meta == create.meta
    assert endpoint.created_by_id == user_id


# --- MCP endpoint round-trip --------------------------------------------------- #


def test_mcp_endpoint_create_round_trips_through_dbe():
    project_id = uuid4()
    user_id = uuid4()
    secret_id = uuid4()

    create = McpEndpointCreate(
        slug="acme-notion",
        name="Acme Notion",
        description="Acme's self-hosted Notion MCP server",
        auth_mode=GatewayAuthScheme.OAUTH,
        secret_id=secret_id,
        data=McpEndpointData(
            url="https://mcp.acme.com",
            tool_policy=McpToolPolicy(mode=McpToolPolicyMode.INCLUDE, names=["search"]),
            config=McpEndpointConfig(timeout_seconds=10.0),
        ),
        flags=McpEndpointFlags(is_active=True),
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
    assert endpoint.data.url == create.data.url
    assert endpoint.data.tool_policy.mode == McpToolPolicyMode.INCLUDE
    assert endpoint.data.tool_policy.names == ["search"]
    assert endpoint.flags.is_active is True
    assert endpoint.tags == create.tags
    assert endpoint.meta == create.meta
    assert endpoint.created_by_id == user_id


# --- MCP grant round-trip ------------------------------------------------------ #


def test_mcp_grant_create_round_trips_through_dbe_project_owned():
    project_id = uuid4()
    endpoint_id = uuid4()
    secret_id = uuid4()

    create = McpGrantCreate(
        endpoint_id=endpoint_id,
        user_id=None,
        secret_id=secret_id,
    )

    dbe = map_mcp_grant_create_to_dbe(
        project_id=project_id,
        user_id=None,
        #
        dto=create,
    )
    assert dbe.project_id == project_id
    assert dbe.user_id is None
    assert dbe.created_by_id is None
    _stamp_lifecycle(dbe)

    grant = map_mcp_grant_dbe_to_dto(dbe=dbe)

    assert grant.id == dbe.id
    assert grant.endpoint_id == endpoint_id
    assert grant.user_id is None
    assert grant.secret_id == secret_id
    assert grant.flags.is_active is True
    assert grant.flags.is_valid is True


def test_mcp_grant_create_round_trips_through_dbe_user_owned():
    project_id = uuid4()
    endpoint_id = uuid4()
    secret_id = uuid4()
    owner_id = uuid4()

    create = McpGrantCreate(
        endpoint_id=endpoint_id,
        user_id=owner_id,
        secret_id=secret_id,
    )

    dbe = map_mcp_grant_create_to_dbe(
        project_id=project_id,
        user_id=owner_id,
        #
        dto=create,
    )
    assert dbe.user_id == owner_id
    assert dbe.created_by_id == owner_id
    _stamp_lifecycle(dbe)

    grant = map_mcp_grant_dbe_to_dto(dbe=dbe)

    assert grant.user_id == owner_id
    assert grant.endpoint_id == endpoint_id
    assert grant.secret_id == secret_id

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.agent_templates.bindings import TemplateBindingResolver
from oss.src.core.agent_templates.dtos import (
    GatewayTemplateChoice,
    MCPTemplateChoice,
    SkipTemplateChoice,
)
from oss.src.core.agent_templates.exceptions import TemplatePackageInvalid
from oss.src.core.agent_templates.models import (
    GatewayConnectionOption,
    MCPConnectionOption,
    ParsedMCPServer,
    ParsedTemplateAgent,
    ParsedTemplatePackage,
    TemplateConnectionRequirement,
)


PROJECT_ID = uuid4()


def _package(*requirements: TemplateConnectionRequirement) -> ParsedTemplatePackage:
    return ParsedTemplatePackage(
        source={"kind": "internal", "key": "sample"},
        version="1.0.0",
        digest="sha256:" + "1" * 64,
        agent=ParsedTemplateAgent(
            key="sample",
            name="Sample",
            description="Sample agent.",
            instructions="# Sample",
            connections=list(requirements),
        ),
        mcp_servers={
            "mail-drafts": ParsedMCPServer(
                name="mail-drafts", url="https://mcp.example.com/mail"
            )
        },
    )


def _gateway_requirement(*integrations: str) -> TemplateConnectionRequirement:
    return TemplateConnectionRequirement(
        key="mailbox",
        required=False,
        purpose="Prepare mailbox drafts.",
        options=[
            GatewayConnectionOption(
                kind="gateway", provider="composio", integration=integration
            )
            for integration in integrations
        ],
    )


def _mcp_requirement() -> TemplateConnectionRequirement:
    return TemplateConnectionRequirement(
        key="mailbox",
        required=False,
        purpose="Prepare mailbox drafts.",
        options=[MCPConnectionOption(kind="mcp", server="mail-drafts")],
    )


def _connection(
    integration: str, slug: str, *, active: bool = True, valid: bool = True
):
    return SimpleNamespace(
        provider_key="composio",
        integration_key=integration,
        slug=slug,
        is_active=active,
        is_valid=valid,
        data={"token": "must-not-leak"},
    )


def _endpoint(
    *,
    namespace: str,
    slug: str,
    url: str,
    provider: str | None = None,
    active: bool = True,
    valid: bool = True,
):
    return SimpleNamespace(
        namespace=namespace,
        slug=slug,
        provider_key=provider,
        integration_key=None,
        flags=SimpleNamespace(is_active=active, is_valid=valid),
        data=SimpleNamespace(route=SimpleNamespace(base_url=url)),
        secret_id=uuid4(),
    )


@pytest.mark.asyncio
async def test_gateway_choice_binds_only_active_valid_project_connection():
    connections = AsyncMock()
    connections.query_connections.return_value = [_connection("gmail", "gmail-primary")]
    mcps = AsyncMock()
    resolver = TemplateBindingResolver(
        connections_service=connections, mcp_service=mcps
    )

    plan = await resolver.resolve(
        project_id=PROJECT_ID,
        package=_package(_gateway_requirement("gmail")),
        choices=[
            GatewayTemplateChoice(
                connection_key="mailbox",
                kind="gateway",
                provider="composio",
                integration="gmail",
            )
        ],
    )

    assert plan.tools == [
        {
            "type": "gateway_connection",
            "connection": {
                "provider": "composio",
                "integration": "gmail",
                "slug": "gmail-primary",
            },
        }
    ]
    assert plan.unresolved == []
    connections.query_connections.assert_awaited_once_with(
        project_id=PROJECT_ID,
        provider_key="composio",
        integration_key="gmail",
        is_active=None,
    )


@pytest.mark.asyncio
async def test_connection_invalidated_after_ui_selection_becomes_unresolved():
    connections = AsyncMock()
    connections.query_connections.return_value = [
        _connection("gmail", "gmail-primary", valid=False)
    ]
    resolver = TemplateBindingResolver(
        connections_service=connections, mcp_service=AsyncMock()
    )

    plan = await resolver.resolve(
        project_id=PROJECT_ID,
        package=_package(_gateway_requirement("gmail")),
        choices=[
            GatewayTemplateChoice(
                connection_key="mailbox",
                kind="gateway",
                provider="composio",
                integration="gmail",
            )
        ],
    )

    assert plan.tools == []
    assert plan.unresolved[0].connection_key == "mailbox"
    assert "token" not in plan.model_dump_json().lower()


@pytest.mark.asyncio
async def test_selected_valid_alternative_is_not_replaced_by_primary():
    connections = AsyncMock()
    connections.query_connections.return_value = [
        _connection("gitlab", "gitlab-primary"),
    ]
    resolver = TemplateBindingResolver(
        connections_service=connections, mcp_service=AsyncMock()
    )

    plan = await resolver.resolve(
        project_id=PROJECT_ID,
        package=_package(_gateway_requirement("github", "gitlab")),
        choices=[
            GatewayTemplateChoice(
                connection_key="mailbox",
                kind="gateway",
                provider="composio",
                integration="gitlab",
            )
        ],
    )

    assert plan.tools[0]["connection"]["integration"] == "gitlab"


@pytest.mark.asyncio
async def test_foreign_choice_is_rejected():
    resolver = TemplateBindingResolver(
        connections_service=AsyncMock(), mcp_service=AsyncMock()
    )

    with pytest.raises(TemplatePackageInvalid) as error:
        await resolver.resolve(
            project_id=PROJECT_ID,
            package=_package(_gateway_requirement("gmail")),
            choices=[
                GatewayTemplateChoice(
                    connection_key="mailbox",
                    kind="gateway",
                    provider="composio",
                    integration="slack",
                )
            ],
        )

    assert error.value.code == "template_connection_choice_invalid"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("namespace", "provider", "expected_connection"),
    [
        ("custom", None, {"type": "gateway", "namespace": "custom", "slug": "mail"}),
        (
            "standard",
            "composio",
            {"type": "gateway", "namespace": "standard", "provider": "composio"},
        ),
        (
            "builtin",
            "agenta",
            {"type": "gateway", "namespace": "builtin", "provider": "agenta"},
        ),
    ],
)
async def test_mcp_choice_maps_existing_project_endpoint(
    namespace: str, provider: str | None, expected_connection: dict
):
    mcps = AsyncMock()
    mcps.query_endpoints.return_value = [
        _endpoint(
            namespace=namespace,
            provider=provider,
            slug="mail",
            url="https://mcp.example.com/mail",
        )
    ]
    resolver = TemplateBindingResolver(
        connections_service=AsyncMock(), mcp_service=mcps
    )

    plan = await resolver.resolve(
        project_id=PROJECT_ID,
        package=_package(_mcp_requirement()),
        choices=[
            MCPTemplateChoice(
                connection_key="mailbox", kind="mcp", server="mail-drafts"
            )
        ],
    )

    assert plan.mcps == [{"name": "mail", "connection": expected_connection}]
    assert "secret" not in plan.model_dump_json().lower()


@pytest.mark.asyncio
async def test_skip_becomes_plain_unresolved_work():
    resolver = TemplateBindingResolver(
        connections_service=AsyncMock(), mcp_service=AsyncMock()
    )

    plan = await resolver.resolve(
        project_id=PROJECT_ID,
        package=_package(_gateway_requirement("gmail")),
        choices=[SkipTemplateChoice(connection_key="mailbox", kind="skip")],
    )

    assert plan.tools == []
    assert plan.unresolved[0].selected_option == {"kind": "skip"}

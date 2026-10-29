from typing import Any
from uuid import UUID

from oss.src.core.agent_templates.dtos import (
    GatewayTemplateChoice,
    MCPTemplateChoice,
    SkipTemplateChoice,
    TemplateConnectionChoice,
)
from oss.src.core.agent_templates.exceptions import TemplatePackageInvalid
from oss.src.core.agent_templates.models import (
    ParsedTemplatePackage,
    TemplateBindingPlan,
    TemplateConnectionRequirement,
    UnresolvedTemplateBinding,
)
from oss.src.core.gateway.connections.service import ConnectionsService
from oss.src.core.gateways.mcps.service import MCPGatewayService


def _value(value: Any) -> Any:
    return value.value if hasattr(value, "value") else value


def _choice_payload(choice: TemplateConnectionChoice) -> dict[str, Any]:
    return choice.model_dump(mode="json", exclude={"connection_key"})


def _unresolved(
    requirement: TemplateConnectionRequirement,
    choice: TemplateConnectionChoice | None,
) -> UnresolvedTemplateBinding:
    return UnresolvedTemplateBinding(
        connection_key=requirement.key,
        purpose=requirement.purpose,
        setup_notes=requirement.setup_notes,
        selected_option=_choice_payload(choice) if choice is not None else None,
    )


class TemplateBindingResolver:
    def __init__(
        self,
        *,
        connections_service: ConnectionsService,
        mcp_service: MCPGatewayService,
    ) -> None:
        self._connections_service = connections_service
        self._mcp_service = mcp_service

    async def resolve(
        self,
        *,
        project_id: UUID,
        package: ParsedTemplatePackage,
        choices: list[TemplateConnectionChoice],
    ) -> TemplateBindingPlan:
        requirements = {item.key: item for item in package.agent.connections}
        choices_by_key: dict[str, TemplateConnectionChoice] = {}
        for choice in choices:
            if choice.connection_key in choices_by_key:
                raise TemplatePackageInvalid(
                    "template_connection_choice_invalid",
                    "Each template connection can be selected only once.",
                )
            if choice.connection_key not in requirements:
                raise TemplatePackageInvalid(
                    "template_connection_choice_invalid",
                    "A connection choice does not belong to this template.",
                )
            choices_by_key[choice.connection_key] = choice

        plan = TemplateBindingPlan()
        for requirement in package.agent.connections:
            choice = choices_by_key.get(requirement.key)
            if choice is None or isinstance(choice, SkipTemplateChoice):
                plan.unresolved.append(_unresolved(requirement, choice))
                continue

            self._validate_declared_choice(requirement, choice)
            if isinstance(choice, GatewayTemplateChoice):
                tool = await self._resolve_gateway(
                    project_id=project_id,
                    requirement=requirement,
                    choice=choice,
                )
                if tool is None:
                    plan.unresolved.append(_unresolved(requirement, choice))
                else:
                    plan.tools.append(tool)
                continue

            mcp = await self._resolve_mcp(
                project_id=project_id,
                package=package,
                choice=choice,
            )
            if mcp is None:
                plan.unresolved.append(_unresolved(requirement, choice))
            else:
                plan.mcps.append(mcp)

        return plan

    @staticmethod
    def _validate_declared_choice(
        requirement: TemplateConnectionRequirement,
        choice: GatewayTemplateChoice | MCPTemplateChoice,
    ) -> None:
        selected = _choice_payload(choice)
        declared = [option.model_dump(mode="json") for option in requirement.options]
        if selected not in declared:
            raise TemplatePackageInvalid(
                "template_connection_choice_invalid",
                "The selected connection option is not declared by the template.",
                details={"connection_key": requirement.key},
            )

    async def _resolve_gateway(
        self,
        *,
        project_id: UUID,
        requirement: TemplateConnectionRequirement,
        choice: GatewayTemplateChoice,
    ) -> dict[str, Any] | None:
        connections = await self._connections_service.query_connections(
            project_id=project_id,
            provider_key=choice.provider,
            integration_key=choice.integration,
            is_active=None,
        )
        candidates = [
            connection
            for connection in connections
            if _value(connection.provider_key) == choice.provider
            and connection.integration_key == choice.integration
            and connection.is_active
            and connection.is_valid
            and isinstance(connection.slug, str)
            and connection.slug
        ]
        if not candidates:
            return None
        connection = sorted(candidates, key=lambda item: item.slug)[0]
        tool: dict[str, Any] = {
            "type": "gateway_connection",
            "connection": {
                "provider": choice.provider,
                "integration": choice.integration,
                "slug": connection.slug,
            },
        }
        if requirement.policy is not None:
            tool["policy"] = requirement.policy.model_dump(
                mode="json", exclude_none=True
            )
        return tool

    async def _resolve_mcp(
        self,
        *,
        project_id: UUID,
        package: ParsedTemplatePackage,
        choice: MCPTemplateChoice,
    ) -> dict[str, Any] | None:
        declaration = package.mcp_servers.get(choice.server)
        if declaration is None:
            raise TemplatePackageInvalid(
                "missing_mcp_server",
                "The selected MCP server is not declared by the template.",
            )
        endpoints = await self._mcp_service.query_endpoints(project_id=project_id)
        candidates = []
        for endpoint in endpoints:
            flags = endpoint.flags
            route = endpoint.data.route
            if (
                flags.is_active
                and flags.is_valid
                and route.base_url == declaration.url
                and isinstance(endpoint.slug, str)
                and endpoint.slug
            ):
                candidates.append(endpoint)
        if not candidates:
            return None
        endpoint = sorted(candidates, key=lambda item: item.slug)[0]
        namespace = _value(endpoint.namespace)
        connection: dict[str, Any] = {
            "type": "gateway",
            "namespace": namespace,
        }
        if namespace == "custom":
            connection["slug"] = endpoint.slug
        else:
            provider = endpoint.provider_key
            if not isinstance(provider, str) or not provider:
                return None
            connection["provider"] = provider
        return {"name": endpoint.slug, "connection": connection}

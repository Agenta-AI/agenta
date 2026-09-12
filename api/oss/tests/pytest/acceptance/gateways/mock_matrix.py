"""Declarative contract for the local gateway mock acceptance matrix.

The cases deliberately describe public gateway routes rather than reaching into a
service or adapter. This keeps the acceptance layer honest: every enabled case
crosses the deployed API, and custom cases also exercise their configured mock
server over a real socket.

This module provides test-facing route descriptions and normal HTTP setup for custom endpoints.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final, Literal
from uuid import uuid4


class GatewayPlane(StrEnum):
    LLM = "llm"
    MCP = "mcp"


class GatewayNamespace(StrEnum):
    BUILTIN = "builtin"
    STANDARD = "standard"
    CUSTOM = "custom"


class CredentialOwner(StrEnum):
    PLATFORM = "platform"
    PROJECT = "project"
    DIRECT = "direct"


Operation = Literal["chat", "models", "tools_list", "tools_call"]


@dataclass(frozen=True)
class GatewayMockCase:
    """One independently dispatched row from ``mocks.md``'s development matrix."""

    key: str
    plane: GatewayPlane
    namespace: GatewayNamespace
    credential_owner: CredentialOwner
    operations: frozenset[Operation]
    upstream_profile: str | None = None
    provider: str | None = None
    requires_custom_endpoint: bool = False

    def route(self, *, name: str | None = None) -> str:
        """Return the public relay route, before an LLM operation suffix.

        ``name`` is only needed for persisted custom endpoints. Generated entries
        intentionally have no test-only identifier: their catalogue key is their
        public name.
        """
        if self.plane is GatewayPlane.LLM:
            if self.namespace is GatewayNamespace.CUSTOM:
                assert name, "custom LLM case needs its generated endpoint slug"
                return f"/gateways/llms/custom/{name}/v1"
            assert self.provider
            return f"/gateways/llms/{self.namespace}/{self.provider}/v1"

        if self.namespace is GatewayNamespace.CUSTOM:
            assert name, "custom MCP case needs its generated endpoint slug"
            return f"/gateways/mcps/custom/{name}"
        assert self.provider
        if self.namespace is GatewayNamespace.STANDARD:
            return f"/gateways/mcps/standard/{self.provider}"
        return f"/gateways/mcps/{self.namespace}/{self.provider}/mock"


LLM_MOCK_CASES: Final[tuple[GatewayMockCase, ...]] = (
    GatewayMockCase(
        key="llm_builtin_agenta",
        plane=GatewayPlane.LLM,
        namespace=GatewayNamespace.BUILTIN,
        provider="agenta",
        credential_owner=CredentialOwner.PLATFORM,
        operations=frozenset({"chat", "models"}),
    ),
    GatewayMockCase(
        key="llm_builtin_mock",
        plane=GatewayPlane.LLM,
        namespace=GatewayNamespace.BUILTIN,
        provider="mock",
        credential_owner=CredentialOwner.PLATFORM,
        operations=frozenset({"chat", "models"}),
    ),
    GatewayMockCase(
        key="llm_standard_mock",
        plane=GatewayPlane.LLM,
        namespace=GatewayNamespace.STANDARD,
        provider="mock",
        credential_owner=CredentialOwner.PROJECT,
        operations=frozenset({"chat", "models"}),
    ),
    GatewayMockCase(
        key="llm_custom_mock",
        plane=GatewayPlane.LLM,
        namespace=GatewayNamespace.CUSTOM,
        credential_owner=CredentialOwner.DIRECT,
        operations=frozenset({"chat", "models"}),
        upstream_profile="llm-custom-mock",
        requires_custom_endpoint=True,
    ),
)


MCP_MOCK_CASES: Final[tuple[GatewayMockCase, ...]] = (
    GatewayMockCase(
        key="mcp_builtin_mock",
        plane=GatewayPlane.MCP,
        namespace=GatewayNamespace.BUILTIN,
        provider="mock",
        credential_owner=CredentialOwner.PLATFORM,
        operations=frozenset({"tools_list", "tools_call"}),
    ),
    GatewayMockCase(
        key="mcp_standard_mock",
        plane=GatewayPlane.MCP,
        namespace=GatewayNamespace.STANDARD,
        provider="mock",
        credential_owner=CredentialOwner.PROJECT,
        operations=frozenset({"tools_list", "tools_call"}),
    ),
    GatewayMockCase(
        key="mcp_custom_mock",
        plane=GatewayPlane.MCP,
        namespace=GatewayNamespace.CUSTOM,
        credential_owner=CredentialOwner.DIRECT,
        operations=frozenset({"tools_list", "tools_call"}),
        upstream_profile="mcp-custom-mock",
        requires_custom_endpoint=True,
    ),
)


GATEWAY_MOCK_CASES: Final[tuple[GatewayMockCase, ...]] = (
    *LLM_MOCK_CASES,
    *MCP_MOCK_CASES,
)


def unique_slug(prefix: str) -> str:
    """A normal resource slug for a test-project-owned fixture."""
    return f"{prefix}-{uuid4().hex[:8]}"

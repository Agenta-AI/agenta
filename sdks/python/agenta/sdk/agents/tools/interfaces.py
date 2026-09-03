"""Injected dependencies used by the tool resolver."""

from __future__ import annotations

from typing import Mapping, Protocol, Sequence

from .models import (
    GatewayConnectionResolution,
    GatewayConnectionToolConfig,
    GatewayToolConfig,
    GatewayToolResolution,
    PermissionMode,
    PlatformToolConfig,
    ReferenceToolConfig,
)


class ToolSecretProvider(Protocol):
    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        """Return available values for the requested secret names."""


class GatewayToolResolver(Protocol):
    async def resolve(
        self,
        tools: Sequence[GatewayToolConfig],
    ) -> GatewayToolResolution:
        """Resolve legacy per-tool gateway declarations into callback specifications."""


class GatewayConnectionResolver(Protocol):
    async def resolve_connections(
        self,
        tools: Sequence[GatewayConnectionToolConfig],
        *,
        mode: PermissionMode,
    ) -> GatewayConnectionResolution:
        """Resolve ``gateway_connection`` declarations into the two runtime tools.

        Returns a fixed pair of specifications plus the compiled policy the runner enforces.
        ``mode`` is the agent-wide permission default the compiler applies to an ``inherit``
        value."""


class WorkflowToolResolver(Protocol):
    async def resolve(
        self,
        tools: Sequence[ReferenceToolConfig],
    ) -> GatewayToolResolution:
        """Resolve ``type:"reference"`` workflow declarations into callback specifications.

        Returns the same shape as the gateway resolver (callback specs + the single shared
        :class:`ToolCallback` to the server-side execute endpoint) so a referenced workflow tool
        rides the existing ``callback`` executor with no new runner ``kind``."""


class PlatformToolResolver(Protocol):
    async def resolve(
        self,
        tools: Sequence[PlatformToolConfig],
    ) -> GatewayToolResolution:
        """Resolve ``type:"platform"`` declarations into callback specifications.

        Returns the same shape as the gateway/workflow resolvers (callback specs + the single shared
        :class:`ToolCallback`). Each spec carries a direct ``call`` descriptor pointing at the
        existing Agenta endpoint, so the runner calls it directly with no ``/tools/call`` hop."""

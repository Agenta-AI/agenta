"""Injected dependencies used by the tool resolver."""

from __future__ import annotations

from typing import Mapping, Protocol, Sequence

from .models import GatewayToolConfig, GatewayToolResolution


class ToolSecretProvider(Protocol):
    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        """Return available values for the requested secret names."""


class GatewayToolResolver(Protocol):
    async def resolve(
        self,
        tools: Sequence[GatewayToolConfig],
    ) -> GatewayToolResolution:
        """Resolve gateway declarations into callback specifications."""

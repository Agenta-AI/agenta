"""Injected dependencies used by MCP resolution."""

from __future__ import annotations

from typing import Mapping, Protocol, Sequence


class MCPSecretProvider(Protocol):
    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        """Return available values for the requested MCP secret names."""

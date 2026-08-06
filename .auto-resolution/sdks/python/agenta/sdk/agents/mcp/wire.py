"""Serialization of resolved MCP servers to the runner contract."""

from __future__ import annotations

from typing import Any, Dict, Sequence

from .models import ResolvedMCPServer


def mcp_server_to_wire(server: ResolvedMCPServer) -> Dict[str, Any]:
    return server.to_wire()


def mcp_servers_to_wire(
    servers: Sequence[ResolvedMCPServer],
) -> list[Dict[str, Any]]:
    return [mcp_server_to_wire(server) for server in servers]

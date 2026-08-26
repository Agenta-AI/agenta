"""Compile a saved gateway connection policy into per-tool runtime decisions."""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from .models import (
    GatewayPermissions,
    Permission,
    PermissionMode,
    effective_permission,
)


class CatalogToolInfo(BaseModel):
    """One catalog tool, as the compiler needs it.

    The SDK's own input model for the two fields the API returns per tool. It must not
    import an API model; the shared contract is these two field names.
    """

    model_config = ConfigDict(frozen=True)

    key: str = Field(min_length=1)
    # ``True`` is a read, ``False`` is a write, ``None`` is unknown. Unknown is not the
    # same as a write to a reader, so it stays tri-state all the way to the runner. Strict,
    # because the value arrives from a provider catalog over HTTP.
    read_only: Optional[StrictBool] = None


class CompiledTool(BaseModel):
    model_config = ConfigDict(frozen=True)

    permission: Permission
    read_only: Optional[bool] = None


class CompiledGatewayPolicy(BaseModel):
    """What one connection compiles to: what runs, and what no longer exists."""

    model_config = ConfigDict(frozen=True)

    # Executable tools, each already resolved to allow, ask, or deny.
    tools: Dict[str, CompiledTool] = Field(default_factory=dict)
    # Configured keys the catalog no longer carries. They never become executable; the
    # resolver reports them as warnings so a stale authored intent is never silent.
    stale_keys: List[str] = Field(default_factory=list)


def compile_gateway_permissions(
    policy: GatewayPermissions,
    catalog: Sequence[CatalogToolInfo],
    mode: PermissionMode,
) -> CompiledGatewayPolicy:
    """Resolve every catalog tool to one effective permission.

    For each catalog tool: take the exact entry in ``policy.tools`` when the key is there,
    otherwise ``policy.default``. An ``inherit`` result defers to the agent-wide ``mode``,
    which under ``allow_reads`` allows a read and asks for everything else.

    Pure: it performs no input and output, and it never reads the catalog for policy. A
    provider ``read_only`` hint cannot loosen an authored ``allow``, ``ask``, or ``deny``.
    """
    tools: Dict[str, CompiledTool] = {}
    for tool in catalog:
        value = policy.tools.get(tool.key, policy.default)
        permission = (
            effective_permission(
                spec_permission=None,
                read_only=tool.read_only,
                mode=mode,
            )
            if value == "inherit"
            else value
        )
        tools[tool.key] = CompiledTool(permission=permission, read_only=tool.read_only)

    stale_keys = [key for key in policy.tools if key not in tools]
    return CompiledGatewayPolicy(tools=tools, stale_keys=stale_keys)

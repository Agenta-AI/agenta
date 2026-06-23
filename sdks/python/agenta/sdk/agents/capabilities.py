"""A MINIMAL per-harness connection-capability table for the connection resolver.

This module carries only what the *connection resolver* needs right now: which provider
families a harness can reach and which :class:`~agenta.sdk.agents.connections.Connection`
modes it supports. The resolver consults it to fail loud (Concern 3b in
``docs/design/agent-workflows/projects/provider-model-auth/design.md``) when a ``ModelRef``
asks for a provider or a connection mode the selected harness cannot reach.

This is deliberately a small subset. The full capability-table mechanism (the rich per-harness
descriptor, the ``/inspect`` exposure, and the frontend cross-reference) is owned by the sibling
``docs/design/agent-workflows/projects/harness-capabilities/`` project; the provider/model/auth
project (this one) contributes only the ``providers`` and ``connection_modes`` entries. When the
harness-capabilities table lands, this minimal table folds into it.

A server-authoritative copy of the same shape lives on the API side
(``api/oss/src/core/secrets/capabilities.py``); the duplication is intentional. The API copy
guards a direct API caller; this SDK copy serves the standalone-SDK and frontend paths. Keep the
two tables in agreement.
"""

from __future__ import annotations

from typing import Dict, List

from pydantic import BaseModel, Field


class HarnessConnectionCapabilities(BaseModel):
    """The connection-relevant capabilities of one harness.

    - ``providers``: the provider families the harness can reach (``["*"]`` means any).
    - ``connection_modes``: which :class:`Connection` ``mode`` values it supports, a subset of
      ``["default", "self_managed", "agenta"]``.
    """

    providers: List[str] = Field(default_factory=list)
    connection_modes: List[str] = Field(default_factory=list)


# Pi and the Agenta harness (Pi under the hood) reach any provider; Claude is narrow (Anthropic
# only, reached directly or via Bedrock/Vertex). All three support every connection mode.
_ALL_MODES = ["default", "self_managed", "agenta"]

HARNESS_CONNECTION_CAPABILITIES: Dict[str, HarnessConnectionCapabilities] = {
    "pi": HarnessConnectionCapabilities(providers=["*"], connection_modes=_ALL_MODES),
    "agenta": HarnessConnectionCapabilities(
        providers=["*"], connection_modes=_ALL_MODES
    ),
    "claude": HarnessConnectionCapabilities(
        providers=["anthropic"], connection_modes=_ALL_MODES
    ),
}


def harness_allows_provider(harness: str, provider: str) -> bool:
    """Whether ``harness`` can reach ``provider``.

    A harness with no entry is treated permissively (returns ``True``) so an unknown or
    newly-added harness is not broken by a stale table. A ``"*"`` entry matches any provider;
    otherwise the match is case-insensitive on the provider family.
    """
    entry = HARNESS_CONNECTION_CAPABILITIES.get(harness)
    if entry is None:
        return True
    if "*" in entry.providers:
        return True
    return provider.lower() in {p.lower() for p in entry.providers}


def harness_allows_mode(harness: str, mode: str) -> bool:
    """Whether ``harness`` supports the connection ``mode``.

    A harness with no entry is treated permissively (returns ``True``), matching
    :func:`harness_allows_provider`.
    """
    entry = HARNESS_CONNECTION_CAPABILITIES.get(harness)
    if entry is None:
        return True
    return mode in entry.connection_modes

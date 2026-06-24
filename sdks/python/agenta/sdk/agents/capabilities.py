"""The per-harness connection-capability table (the data behind ``/inspect``).

This is the harness-layer artifact that says, per harness, which provider families it can
reach, which deployment surfaces (direct / azure / bedrock / vertex), which
:class:`~agenta.sdk.agents.connections.Connection` modes it supports, and how it selects a
model. The agent service publishes it on the ``/inspect`` response ``meta`` so the frontend can
filter the project's stored connections to the ones the selected harness can use; the agent
service ALSO imports this same table for its own server-side fail-loud reject (so a direct API
caller is guarded too). The vault never sees this table: the capability check is a harness-layer
concern, and the vault resolve stays harness-agnostic.

The provider lists are the REAL harness facts, derived from
``docs/design/agent-workflows/projects/provider-model-auth/harness-provider-matrix.md``:

- **Pi** reaches eight Agenta-vault-mapped providers directly (the ones whose ``provider_key``
  secret drives a Pi provider via its env-key map). Pi also reaches ~24 more providers that have
  no Agenta vault kind; those are out of scope unless a ``custom_provider`` secret is made for
  them, so they are not enumerated here. Pi's cloud deployments (azure/bedrock/vertex) are
  *declared* but Pi *consumption* of them stages with the model-config sibling, so v1 fails loud:
  ``deployments`` is ``["direct"]`` for the live reach.
- **Claude** reaches anthropic only, direct or via a custom gateway. Bedrock/Vertex on Claude are
  declared but not wired in v1 (fail loud), so ``deployments`` is ``["direct"]``.
- **agenta** is Pi under the hood, so it shares Pi's reach.

The sibling ``docs/design/agent-workflows/projects/harness-capabilities/`` project owns the
general capability-table mechanism; this module is the provider/model/auth contribution
(providers / deployments / connection_modes / model_selection) that folds into it.
"""

from __future__ import annotations

from typing import Dict, List

from pydantic import BaseModel, Field

# The eight Agenta-vault-mapped providers Pi reaches directly via its env-key map (a stored
# ``provider_key`` secret of these drives Pi). Kept in agreement with ``connections/resolver.py``
# ``_PROVIDER_ENV_VARS`` and the API ``_PROVIDER_ENV_VARS``.
PI_VAULT_PROVIDERS: List[str] = [
    "openai",
    "anthropic",
    "gemini",
    "mistral",
    "groq",
    "minimax",
    "together_ai",
    "openrouter",
]

# Both modes every harness supports today. (No ``default`` mode: the project default is just
# ``agenta`` with no slug.)
_ALL_MODES = ["agenta", "self_managed"]


class HarnessConnectionCapabilities(BaseModel):
    """The connection-relevant capabilities of one harness (the ``/inspect`` ``meta`` shape).

    - ``providers``: the provider families the harness can reach (a literal list; never ``"*"``).
    - ``deployments``: the deployment surfaces it can *consume* in v1 (``direct`` for both
      harnesses today; cloud surfaces are declared in the matrix but fail loud, so they are not
      listed as consumable).
    - ``connection_modes``: which :class:`Connection` ``mode`` values it supports
      (``["agenta", "self_managed"]``).
    - ``model_selection``: how a model is named for the harness (``"provider/id"`` exact for Pi,
      ``"alias"`` for Claude).
    """

    providers: List[str] = Field(default_factory=list)
    deployments: List[str] = Field(default_factory=lambda: ["direct"])
    connection_modes: List[str] = Field(default_factory=lambda: list(_ALL_MODES))
    model_selection: str = "provider/id"


HARNESS_CONNECTION_CAPABILITIES: Dict[str, HarnessConnectionCapabilities] = {
    "pi": HarnessConnectionCapabilities(
        providers=list(PI_VAULT_PROVIDERS),
        deployments=["direct"],
        connection_modes=list(_ALL_MODES),
        model_selection="provider/id",
    ),
    "agenta": HarnessConnectionCapabilities(
        providers=list(PI_VAULT_PROVIDERS),
        deployments=["direct"],
        connection_modes=list(_ALL_MODES),
        model_selection="provider/id",
    ),
    "claude": HarnessConnectionCapabilities(
        providers=["anthropic"],
        deployments=["direct"],
        connection_modes=list(_ALL_MODES),
        model_selection="alias",
    ),
}


def harness_capabilities_document() -> Dict[str, Dict[str, object]]:
    """The capability table as a plain JSON-able dict, keyed by harness type.

    This is the exact shape the agent service publishes on the ``/inspect`` response ``meta``
    (under ``harness_capabilities``). A plain dict so it serializes without a model import on the
    consumer side (the frontend / a direct ``/inspect`` reader).
    """
    return {
        harness: caps.model_dump()
        for harness, caps in HARNESS_CONNECTION_CAPABILITIES.items()
    }


def harness_allows_provider(harness: str, provider: str) -> bool:
    """Whether ``harness`` can reach ``provider``.

    A harness with no entry is treated permissively (returns ``True``) so an unknown or
    newly-added harness is not broken by a stale table. The match is case-insensitive on the
    provider family.
    """
    entry = HARNESS_CONNECTION_CAPABILITIES.get(harness)
    if entry is None:
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


def harness_allows_deployment(harness: str, deployment: str) -> bool:
    """Whether ``harness`` can CONSUME the resolved ``deployment`` in v1.

    A harness with no entry is treated permissively. ``direct`` is always allowed. The cloud
    surfaces (azure/bedrock/vertex/custom) are allowed only when the harness lists them as
    consumable; v1 lists only ``direct``, so a resolved cloud deployment fails loud here.
    """
    entry = HARNESS_CONNECTION_CAPABILITIES.get(harness)
    if entry is None:
        return True
    return deployment in entry.deployments

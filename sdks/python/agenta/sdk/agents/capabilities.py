"""The per-harness connection-capability table (the data behind ``/inspect``).

This is the harness-layer artifact that says, per harness, which provider families it can
reach, which deployment surfaces (direct / custom / bedrock / vertex_ai), which
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
- **Claude** reaches anthropic only, direct, via a custom gateway, or through Anthropic on
  Bedrock/Vertex. The runner passes the selected model id through to Claude Code and lets the
  configured backend fail loudly if it rejects it.
- **pi_agenta** is Pi under the hood (Pi with Agenta's forced opinion), so it shares
  ``pi_core``'s reach.

The sibling ``docs/design/agent-workflows/projects/harness-capabilities/`` project owns the
general capability-table mechanism; this module is the provider/model/auth contribution
(providers / deployments / connection_modes / model_selection) that folds into it.
"""

from __future__ import annotations

from typing import Dict, List

from pydantic import BaseModel, Field

from agenta.sdk.utils.assets import supported_llm_models

# The eight Agenta-vault-mapped providers Pi reaches directly via its env-key map (a stored
# ``provider_key`` secret of these drives Pi). Kept in agreement with the SDK resolver
# provider-env maps.
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

# Claude Code selects a model by alias, not a ``provider/id`` string. These are the aliases the
# Claude harness accepts (``default``/``sonnet``/``opus``/``haiku``) plus their ``[1m]``
# long-context variants. They live under the ``anthropic`` provider in the ``models`` map (Claude
# reaches anthropic only). Revisit if the runner's accepted alias set changes (see
# ``docs/design/agent-workflows/projects/model-config/``).
CLAUDE_MODEL_ALIASES: List[str] = [
    "default",
    "sonnet",
    "opus",
    "haiku",
    "default[1m]",
    "sonnet[1m]",
    "opus[1m]",
    "haiku[1m]",
]

# Both modes every harness supports today. (No ``default`` mode: the project default is just
# ``agenta`` with no slug.)
_ALL_MODES = ["agenta", "self_managed"]


def _pi_models() -> Dict[str, List[str]]:
    """The per-provider model ids Pi reaches: the catalog entry for each vault provider.

    Defensive against a provider missing from ``supported_llm_models`` (skip it) so a catalog
    edit never breaks the capability document. The ids are provider-prefixed (``openai/gpt-...``),
    the same shape the playground model picker already renders.
    """
    return {
        provider: list(supported_llm_models[provider])
        for provider in PI_VAULT_PROVIDERS
        if provider in supported_llm_models
    }


class HarnessConnectionCapabilities(BaseModel):
    """The connection-relevant capabilities of one harness (the ``/inspect`` ``meta`` shape).

    - ``providers``: the provider families the harness can reach (a literal list; never ``"*"``).
    - ``deployments``: the deployment surfaces it can *consume* in v1 (``direct`` for both
      harnesses today; Claude additionally consumes custom gateway, Bedrock, and Vertex
      deployments.
    - ``connection_modes``: which :class:`Connection` ``mode`` values it supports
      (``["agenta", "self_managed"]``).
    - ``model_selection``: how a model is named for the harness (``"provider/id"`` exact for Pi,
      ``"alias"`` for Claude).
    - ``models``: the selectable models per provider family. Pi publishes each vault provider's
      catalog ids (provider-prefixed, e.g. ``openai/gpt-...``); Claude publishes its alias set
      under ``anthropic``. The frontend renders the harness-filtered model picker straight from
      this map instead of the full shared catalog.
    """

    providers: List[str] = Field(default_factory=list)
    deployments: List[str] = Field(default_factory=lambda: ["direct"])
    connection_modes: List[str] = Field(default_factory=lambda: list(_ALL_MODES))
    model_selection: str = "provider/id"
    models: Dict[str, List[str]] = Field(default_factory=dict)


HARNESS_CONNECTION_CAPABILITIES: Dict[str, HarnessConnectionCapabilities] = {
    "pi_core": HarnessConnectionCapabilities(
        providers=list(PI_VAULT_PROVIDERS),
        deployments=["direct"],
        connection_modes=list(_ALL_MODES),
        model_selection="provider/id",
        models=_pi_models(),
    ),
    "pi_agenta": HarnessConnectionCapabilities(
        providers=list(PI_VAULT_PROVIDERS),
        deployments=["direct"],
        connection_modes=list(_ALL_MODES),
        model_selection="provider/id",
        models=_pi_models(),
    ),
    "claude": HarnessConnectionCapabilities(
        providers=["anthropic"],
        deployments=["direct", "custom", "bedrock", "vertex_ai", "vertex"],
        connection_modes=list(_ALL_MODES),
        model_selection="alias",
        models={"anthropic": list(CLAUDE_MODEL_ALIASES)},
    ),
}


def harness_capabilities_document() -> Dict[str, Dict[str, object]]:
    """The capability table as a plain JSON-able dict, keyed by harness type.

    The connection-capability source of truth, used server-side for the agent-layer capability
    checks (``harness_allows_provider`` / ``_mode`` / ``_deployment``). A plain dict so it
    serializes without a model import on the consumer side.

    NOT shipped on ``/inspect`` anymore. The frontend reads harness capabilities from the
    ``harnesses`` catalog (``GET /catalog/harnesses/{ag_harness}``), built from
    :func:`harness_catalog_document`, resolved by ``x-ag-harness-ref`` — like every other catalog
    type — instead of an inlined, agent-only ``meta`` field on every inspect call.
    """
    return {
        harness: caps.model_dump()
        for harness, caps in HARNESS_CONNECTION_CAPABILITIES.items()
    }


def harness_catalog_document() -> Dict[str, Dict[str, object]]:
    """The ``harnesses`` catalog as a plain JSON-able dict, keyed by harness id.

    One record per harness. ``capabilities`` is a FIELD (the connection-capability shape) so a
    record can grow other harness facts (display name, default model, ...) without changing the
    envelope. Served by ``GET /catalog/harnesses/`` and ``/{ag_harness}``; referenced from a
    template's harness field via ``x-ag-harness-ref``.
    """
    return {
        harness: {"harness": harness, "capabilities": caps.model_dump()}
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
    surfaces are allowed only when the harness lists them as consumable. ``pi_core``/``pi_agenta``
    list only ``direct``; Claude also lists ``custom``/``bedrock``/``vertex_ai``.
    """
    entry = HARNESS_CONNECTION_CAPABILITIES.get(harness)
    if entry is None:
        return True
    normalized = "vertex_ai" if deployment == "vertex" else deployment
    return normalized in entry.deployments

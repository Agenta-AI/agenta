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
  secret drives a Pi provider via its env-key map), plus ``openai-codex`` (OpenAI's ChatGPT/Codex
  subscription), which Pi reaches through its own OAuth login rather than a vault key — usable
  under ``self_managed`` (and the ``agenta`` default's ``runtime_provided`` fallback). Pi also
  reaches ~24 more providers that have no Agenta vault kind; those are out of scope unless a
  ``custom_provider`` secret is made for them, so they are not enumerated here. Pi's cloud
  deployments (azure/bedrock/vertex) are *declared* but Pi *consumption* of them stages with the
  model-config sibling, so v1 fails loud: ``deployments`` is ``["direct"]`` for the live reach.
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

# Subscription/OAuth-only providers Pi also reaches. ``openai-codex`` is OpenAI's ChatGPT/Codex
# subscription: Pi authenticates it with an OAuth login (``~/.pi/agent/auth.json``, ``pi`` then
# ``/login``), NOT an Agenta vault ``provider_key`` (no vault secret kind maps to it). ``self_managed``
# is broader than this one provider: it covers any way a harness signs itself in without an
# Agenta-stored key, including machine credentials such as environment variables. This provider's
# on-ramp under ``self_managed`` happens to be the subscription OAuth. It is also reachable under
# the ``agenta`` default's ``runtime_provided`` fallback, so it belongs in Pi's reachable providers
# even though it carries no vault key. Its model ids are carried explicitly below because they are
# not in the litellm-derived ``supported_llm_models`` catalog. See
# ``docs/design/agent-workflows/projects/provider-model-auth/harness-provider-matrix.md`` and the
# subscription-sidecar recipe.
PI_SUBSCRIPTION_MODELS: Dict[str, List[str]] = {
    # Bare ids (like the ``openai`` catalog); the ``openai-codex`` provider disambiguates from the
    # plain ``openai`` models that share these names. The runner normalizes any of these onto the
    # harness's ``openai-codex/<id>`` model. This is the full ``openai-codex`` model set Pi's
    # vendored catalog exposes (``@earendil-works/pi-ai`` ``models.generated`` ->
    # ``openai-codex``, served via ``chatgpt.com/backend-api``); keep it in sync when the pinned
    # Pi version changes its codex model list.
    "openai-codex": [
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.5",
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.3-codex-spark",
    ],
}
PI_SUBSCRIPTION_PROVIDERS: List[str] = list(PI_SUBSCRIPTION_MODELS)

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

# Canonical provider -> env-var map (the harness's own env, e.g. Pi/Claude/litellm). The single
# source of truth; ``platform/secrets.py`` and ``connections/resolver.py`` import this instead of
# hand-copying it, so the three can no longer drift.
PROVIDER_ENV_VARS: Dict[str, str] = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "mistral": "MISTRAL_API_KEY",
    "mistralai": "MISTRAL_API_KEY",
    "minimax": "MINIMAX_API_KEY",
    "groq": "GROQ_API_KEY",
    "together_ai": "TOGETHERAI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


def _pi_models() -> Dict[str, List[str]]:
    """The per-provider model ids Pi reaches: the catalog entry for each vault provider, plus the
    explicit ids for the subscription/OAuth providers (``openai-codex``) that the shared catalog
    does not list.

    Defensive against a provider missing from ``supported_llm_models`` (skip it) so a catalog
    edit never breaks the capability document. The ids match the shared catalog's shape (mostly
    provider-prefixed like ``anthropic/...``; some, e.g. ``openai``, are bare like ``gpt-5.5``),
    the same shape the playground model picker already renders.
    """
    models = {
        provider: list(supported_llm_models[provider])
        for provider in PI_VAULT_PROVIDERS
        if provider in supported_llm_models
    }
    # The subscription/OAuth providers are not in the litellm-derived catalog, so carry their ids
    # explicitly (like the Claude alias set).
    for provider, ids in PI_SUBSCRIPTION_MODELS.items():
        models[provider] = list(ids)
    return models


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
        providers=list(PI_VAULT_PROVIDERS) + list(PI_SUBSCRIPTION_PROVIDERS),
        deployments=["direct"],
        connection_modes=list(_ALL_MODES),
        model_selection="provider/id",
        models=_pi_models(),
    ),
    "pi_agenta": HarnessConnectionCapabilities(
        providers=list(PI_VAULT_PROVIDERS) + list(PI_SUBSCRIPTION_PROVIDERS),
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

    A harness with no entry is unknown, so it gets no capability (closed, not permissive). The
    match is case-insensitive on the provider family.
    """
    entry = HARNESS_CONNECTION_CAPABILITIES.get(harness)
    if entry is None:
        return False
    return provider.lower() in {p.lower() for p in entry.providers}


def harness_allows_mode(harness: str, mode: str) -> bool:
    """Whether ``harness`` supports the connection ``mode``.

    A harness with no entry is unknown, so it gets no capability, matching
    :func:`harness_allows_provider`.
    """
    entry = HARNESS_CONNECTION_CAPABILITIES.get(harness)
    if entry is None:
        return False
    return mode in entry.connection_modes


def harness_allows_deployment(harness: str, deployment: str) -> bool:
    """Whether ``harness`` can CONSUME the resolved ``deployment`` in v1.

    A harness with no entry is unknown, so it gets no capability (closed). The cloud surfaces
    are allowed only when the harness lists them as consumable. ``pi_core``/``pi_agenta`` list
    only ``direct``; Claude also lists ``custom``/``bedrock``/``vertex_ai``.
    """
    entry = HARNESS_CONNECTION_CAPABILITIES.get(harness)
    if entry is None:
        return False
    normalized = "vertex_ai" if deployment == "vertex" else deployment
    return normalized in entry.deployments

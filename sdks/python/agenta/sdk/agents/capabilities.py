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
  subscription), which Pi reaches through its own OAuth login rather than a vault key, usable
  under ``self_managed``. Pi also
  reaches ~24 more providers that have no Agenta vault kind; those are out of scope unless a
  ``custom_provider`` secret is made for them, so they are not enumerated here. Pi consumes the
  ``direct`` deployment for all of them, plus the ``custom`` (OpenAI-compatible) deployment for
  the ``openai`` family only — the runner's ``models.json`` builder speaks openai-completions.
  The published ``custom`` capability lets the UI surface the connection; server-side pair
  validation (:func:`harness_allows_pair`) is authoritative because the flat ``providers`` and
  ``deployments`` lists cannot express the openai-only cross-product on their own. Pi's cloud
  deployments (azure/bedrock/vertex) are *declared* but Pi *consumption* of them stages with the
  model-config sibling, so v1 fails loud for those.
- **Claude** reaches anthropic only, direct, via a custom gateway, or through Anthropic on
  Bedrock/Vertex. The runner passes the selected model id through to Claude Code and lets the
  configured backend fail loudly if it rejects it.
- **Codex** reaches openai only, direct, through managed keys or subscription OAuth.
- **pi_agenta** is Pi under the hood (Pi with Agenta's forced opinion), so it shares
  ``pi_core``'s reach.

The sibling ``docs/design/agent-workflows/projects/harness-capabilities/`` project owns the
general capability-table mechanism; this module is the provider/model/auth contribution
(providers / deployments / connection_modes / model_selection) that folds into it.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional

from pydantic import BaseModel, Field, model_validator

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
# on-ramp under ``self_managed`` happens to be the subscription OAuth. Its model ids are carried
# explicitly below because they are
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

# Claude Code selects a model by alias, not a ``provider/id`` string. These are stable request
# values for the picker. A live Claude session can expose a context-hinted variant such as
# ``claude-fable-5[1m]`` while promotional long-context access is available, then expose the bare
# ``claude-fable-5`` value later. The runner safely widens a bare request to the hinted option
# when that is the only available variant, so the catalog must keep the stable bare value. They
# live under the ``anthropic`` provider in the ``models`` map (Claude reaches anthropic only).
# Revisit if the model family changes (see the ``sync-model-catalog`` skill and
# ``docs/design/agent-workflows/projects/model-config/``).
CLAUDE_MODEL_ALIASES: List[str] = [
    "default",
    "sonnet",
    "haiku",
    "opus[1m]",
    "claude-fable-5",
]

# The curated Codex model set the harness advertises under the ``openai`` family. The
# ``gpt-5.1-codex`` family is API-listed but backend-deprecated, so it is excluded. Keep this in
# sync with ``data/codex_models.curated.json`` and the ``sync-model-catalog`` skill. See decision
# D-006.
CODEX_MODELS: List[str] = [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.2",
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
    # The vault kind is ``together_ai`` (underscore), but the Pi harness reads ``TOGETHER_API_KEY``
    # (see ``@earendil-works/pi-ai`` ``env-api-keys.js``). This differs from litellm's
    # ``TOGETHERAI_API_KEY`` (the classic app-runner path); this table feeds the Pi harness, so it
    # must use Pi's name or the key never reaches the harness.
    "together_ai": "TOGETHER_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


# The curated models a connection starts with when it saves no model list of its own: product
# policy, not a provider fact, so it lives in the versioned catalog rather than on every stored
# connection (design: provider-connections-models/provider-discovery.md, "Default models"). The
# ids are the shared catalog spelling (``provider/id``); each harness republishes them below in
# the spelling it accepts. A saved list on a connection — including an empty one — always wins.
PROVIDER_DEFAULT_MODELS: Dict[str, List[str]] = {
    "openai": [
        "openai/gpt-5.6-luna",
        "openai/gpt-5.6-terra",
        "openai/gpt-5.6-sol",
    ],
    # ``anthropic/claude-opus-5`` belongs here too, but the pinned pi-ai catalog predates it;
    # add it when the ``sync-model-catalog`` skill regenerates ``data/pi_models.generated.json``.
    "anthropic": [
        "anthropic/claude-fable-5",
        "anthropic/claude-sonnet-5",
        "anthropic/claude-haiku-4-5",
    ],
    "gemini": [
        "gemini/gemini-3.5-flash",
        "gemini/gemini-3.1-pro-preview",
    ],
    "mistral": [
        "mistral/mistral-medium-latest",
        "mistral/mistral-small-latest",
    ],
    "groq": [
        "groq/openai/gpt-oss-120b",
        "groq/llama-3.1-8b-instant",
    ],
    "minimax": [
        "minimax/MiniMax-M3",
        "minimax/MiniMax-M2.7-highspeed",
    ],
    "together_ai": [
        "together_ai/moonshotai/Kimi-K2.7-Code",
        "together_ai/zai-org/GLM-5.2",
    ],
    "openrouter": [
        "openrouter/z-ai/glm-5.2",
        "openrouter/deepseek/deepseek-v4-flash",
        "openrouter/deepseek/deepseek-v4-pro",
        "openrouter/openai/gpt-5.6-luna",
        "openrouter/xiaomi/mimo-v2.5",
        "openrouter/tencent/hy3",
    ],
}


# A harness that selects by alias (Claude) names a TIER, not a model id, so a curated id has to
# be translated before it can be matched. Keyed by prefix because the alias tracks the tier
# across versions (``claude-sonnet-5`` and its successor both answer to ``sonnet``). Only ids a
# harness could otherwise not name belong here: ``claude-fable-5`` is its own alias, and opus has
# no curated default until the catalog refresh adds ``claude-opus-5``.
MODEL_ID_ALIASES: Dict[str, str] = {
    "anthropic/claude-sonnet-": "sonnet",
    "anthropic/claude-haiku-": "haiku",
}


def _model_catalog(harness: str) -> List[Dict[str, object]]:
    """The curated catalog entries for a harness, as plain dicts (published ADDITIVELY alongside
    ``models``).

    Defensive: a missing or malformed data file returns an empty catalog rather than taking down
    the whole capability table. Readers fall back to the ``models`` map when the catalog is empty.
    The catalog decorates the accepted set; it never gates selection (design: model-catalog-schema).
    """
    # Defensive: a bad data file must not break /inspect. pragma: no cover.
    try:
        from agenta.sdk.agents.model_catalog import model_catalog_entries

        return model_catalog_entries(harness)
    except Exception:  # noqa: BLE001
        return []


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


def _spelling_index(model_ids: Iterable[str]) -> Dict[str, str]:
    """Index model ids by every spelling they answer to (full id and provider-less tail)."""
    index: Dict[str, str] = {}
    for model_id in model_ids:
        bare = model_id.split("/", 1)[1] if "/" in model_id else model_id
        index.setdefault(model_id, model_id)
        index.setdefault(bare, model_id)
    return index


def _tier_aliases(model_id: str) -> List[str]:
    """The alias spellings a curated model id also answers to (see :data:`MODEL_ID_ALIASES`)."""
    return [
        alias
        for prefix, alias in MODEL_ID_ALIASES.items()
        if model_id.startswith(prefix)
    ]


def _harness_default_models(
    *,
    providers: List[str],
    models: Dict[str, List[str]],
    model_catalog: List[Dict[str, object]],
) -> Dict[str, List[str]]:
    """:data:`PROVIDER_DEFAULT_MODELS`, narrowed and respelled for one harness.

    Each harness names a model its own way (Pi mostly ``provider/id``, Claude by alias, Codex by
    bare id), so a curated id is matched against the ids this harness advertises — its accepted
    ``models`` map first, then its catalog — and republished in the spelling that harness accepts.
    A harness that names tiers rather than ids reaches its spelling through
    :data:`MODEL_ID_ALIASES`. A curated id the harness cannot select is dropped rather than
    guessed at, which is also how a provider outside the harness's reach ends up with no defaults
    at all.
    """
    defaults: Dict[str, List[str]] = {}

    for provider in providers:
        curated = PROVIDER_DEFAULT_MODELS.get(provider)
        if not curated:
            continue

        # Scoped by provider: a gateway's ids repeat another provider's spelling
        # (``openrouter/openai/gpt-5.6-luna``), so a flat index would cross-match them.
        catalog_ids = [
            str(entry.get("id"))
            for entry in model_catalog
            if entry.get("id") is not None and entry.get("provider") == provider
        ]
        indexes = (
            _spelling_index(models.get(provider) or []),
            _spelling_index(catalog_ids),
        )
        selected: List[str] = []
        for curated_id in curated:
            bare_id = curated_id.split("/", 1)[1] if "/" in curated_id else curated_id
            # Full id, then the provider-less tail, then the tier alias: a harness that names
            # models outright must never be handed an alias it does not publish.
            spellings = (curated_id, bare_id, *_tier_aliases(curated_id))
            for index in indexes:
                match = next(
                    (index[spelling] for spelling in spellings if spelling in index),
                    None,
                )
                if match:
                    if match not in selected:
                        selected.append(match)
                    break

        if selected:
            defaults[provider] = selected

    return defaults


class UserMCPServerCapabilities(BaseModel):
    connection_types: List[str] = Field(default_factory=lambda: ["http"])
    credentials: List[str] = Field(
        default_factory=lambda: ["none", "header_secret_refs"]
    )


class HarnessMCPCapabilities(BaseModel):
    user_servers: Optional[UserMCPServerCapabilities] = None


class HarnessConnectionCapabilities(BaseModel):
    """The connection-relevant capabilities of one harness (the ``/inspect`` ``meta`` shape).

    - ``providers``: the provider families the harness can reach (a literal list; never ``"*"``).
    - ``deployments``: the deployment surfaces it can *consume* in v1 (``direct`` and ``custom``
      for Pi, where ``custom`` is the OpenAI-compatible surface; Claude additionally consumes the
      Anthropic custom gateway, Bedrock, and Vertex deployments). The list is per-axis only;
      cross-product pairing (which provider a ``custom`` deployment accepts) lives in
      :func:`harness_allows_pair`.
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
    # The subset of ``models`` pre-selected for a connection that saved no model list of its own,
    # per provider family, in the harness's own model spelling. Derived from
    # :data:`PROVIDER_DEFAULT_MODELS` below, so a harness only ever advertises defaults it can
    # actually select, and a provider it cannot reach has none.
    default_models: Dict[str, List[str]] = Field(default_factory=dict)
    # The curated per-model catalog (label / description / pricing / ratings), one flat list keyed
    # by the same ids as ``models``. Published ADDITIVELY next to ``models`` during the migration
    # (design: model-catalog-schema); the frontend prefers it when present and falls back to
    # ``models``. Loosely typed as dicts here so this module stays decoupled from the entry schema
    # in ``model_catalog.py`` and the ``/inspect`` payload stays plain JSON.
    model_catalog: List[Dict[str, object]] = Field(default_factory=list)
    mcp: Optional[HarnessMCPCapabilities] = None

    @model_validator(mode="after")
    def _derive_default_models(self) -> "HarnessConnectionCapabilities":
        if not self.default_models:
            self.default_models = _harness_default_models(
                providers=self.providers,
                models=self.models,
                model_catalog=self.model_catalog,
            )
        return self


HARNESS_CONNECTION_CAPABILITIES: Dict[str, HarnessConnectionCapabilities] = {
    "pi_core": HarnessConnectionCapabilities(
        # ``custom`` is published so the UI surfaces OpenAI-compatible connections; the
        # openai-only pairing is enforced server-side by ``harness_allows_pair``, not by this
        # flat list (which cannot express the cross-product on its own).
        providers=list(PI_VAULT_PROVIDERS) + list(PI_SUBSCRIPTION_PROVIDERS),
        deployments=["direct", "custom"],
        connection_modes=list(_ALL_MODES),
        model_selection="provider/id",
        models=_pi_models(),
        model_catalog=_model_catalog("pi_core"),
    ),
    "pi_agenta": HarnessConnectionCapabilities(
        # See ``pi_core``: ``custom`` is UI-surface only; ``harness_allows_pair`` is authoritative.
        providers=list(PI_VAULT_PROVIDERS) + list(PI_SUBSCRIPTION_PROVIDERS),
        deployments=["direct", "custom"],
        connection_modes=list(_ALL_MODES),
        model_selection="provider/id",
        models=_pi_models(),
        model_catalog=_model_catalog("pi_agenta"),
    ),
    "claude": HarnessConnectionCapabilities(
        providers=["anthropic"],
        deployments=["direct", "custom", "bedrock", "vertex_ai", "vertex"],
        connection_modes=list(_ALL_MODES),
        model_selection="alias",
        models={"anthropic": list(CLAUDE_MODEL_ALIASES)},
        model_catalog=_model_catalog("claude"),
        mcp=HarnessMCPCapabilities(
            user_servers=UserMCPServerCapabilities(),
        ),
    ),
    # Codex reaches OpenAI through managed direct connections and self_managed subscription OAuth
    # via the mounted CODEX_HOME login. It accepts user HTTP MCP servers like Claude.
    "codex": HarnessConnectionCapabilities(
        providers=["openai"],
        deployments=["direct"],
        connection_modes=list(_ALL_MODES),
        model_selection="provider/id",
        models={"openai": list(CODEX_MODELS)},
        model_catalog=_model_catalog("codex"),
        mcp=HarnessMCPCapabilities(
            user_servers=UserMCPServerCapabilities(),
        ),
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
        harness: caps.model_dump(exclude_none=True)
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
        harness: {
            "harness": harness,
            "capabilities": caps.model_dump(exclude_none=True),
        }
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
    ``direct`` and ``custom`` (the OpenAI-compatible surface); Claude also lists
    ``bedrock``/``vertex_ai``.
    """
    entry = HARNESS_CONNECTION_CAPABILITIES.get(harness)
    if entry is None:
        return False
    normalized = "vertex_ai" if deployment == "vertex" else deployment
    return normalized in entry.deployments


# The provider family each harness's ``custom`` deployment surface accepts. This is Decision 3's
# cross-product restriction: Pi's custom surface speaks openai-completions (the ``openai`` family
# only), and Claude's custom gateway is Anthropic only. The flat ``providers``/``deployments``
# lists cannot express this pairing, so :func:`harness_allows_pair` consults this map. A harness
# absent here accepts no ``custom`` deployment.
HARNESS_CUSTOM_DEPLOYMENT_PROVIDERS: Dict[str, str] = {
    "pi_core": "openai",
    "pi_agenta": "openai",
    "claude": "anthropic",
}


def harness_allows_pair(harness: str, provider: str, deployment: str) -> bool:
    """Whether ``harness`` can consume the full (provider family, deployment) pair.

    The authoritative resolved-pair check (design Decision 3). ``harness_allows_provider`` and
    ``harness_allows_deployment`` gate each axis independently; this gates their cross product,
    which those flat lists cannot express on their own. A ``direct`` (or cloud) deployment is
    allowed for any provider the harness already reaches, so the pair reduces to the two
    independent checks there. A ``custom`` deployment is narrower: Pi consumes it only with the
    ``openai`` family and Claude only with ``anthropic`` (per
    :data:`HARNESS_CUSTOM_DEPLOYMENT_PROVIDERS`). An unknown harness is closed.

    The allowed triples:

    - ``pi_core``/``pi_agenta`` + ``openai`` + ``direct`` or ``custom`` -> allowed;
    - ``pi_core``/``pi_agenta`` + any other family + ``custom`` -> rejected;
    - ``claude`` + ``anthropic`` + ``direct``/``custom``/``bedrock``/``vertex_ai`` -> allowed;
    - ``claude`` + ``openai`` + anything -> rejected (Claude reaches anthropic only);
    - unknown harness -> rejected.
    """
    if HARNESS_CONNECTION_CAPABILITIES.get(harness) is None:
        return False
    if not harness_allows_provider(harness, provider):
        return False
    if not harness_allows_deployment(harness, deployment):
        return False
    normalized = "vertex_ai" if deployment == "vertex" else deployment
    if normalized == "custom":
        allowed = HARNESS_CUSTOM_DEPLOYMENT_PROVIDERS.get(harness)
        return allowed is not None and provider.lower() == allowed.lower()
    return True

"""Agenta-platform-backed connection resolution over the existing secrets API.

``VaultConnectionResolver`` is the connected-path ``ConnectionResolver`` adapter. It fetches
``GET /secrets/`` with the caller's request auth, builds an in-memory catalog from existing
``provider_key`` and ``custom_provider`` vault records, selects exactly one connection for the
``ModelRef``, and returns a least-privilege ``ResolvedConnection`` plan.

There is deliberately no ``/vault/connections`` route here. The vault remains the existing
``/secrets`` store; connection is only a runtime read view inside the service/SDK agent path.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

import httpx

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.net import assert_endpoint_url_allowed

from ..capabilities import (
    CLAUDE_MODEL_ALIASES,
    HARNESS_CONNECTION_CAPABILITIES,
    PROVIDER_ENV_VARS,
)
from ..connections.endpoints import build_resolved_connection
from ..connections import (
    AmbiguousConnectionError,
    ConnectionNotFoundError,
    ConnectionResolutionError,
    Endpoint,
    MissingProviderError,
    ModelRef,
    ProviderMismatchError,
    ResolvedConnection,
    RuntimeAuthContext,
    UnsupportedConnectionModeError,
)
from .connection import PlatformConnection

log = get_module_logger(__name__)

# Canonical map lives in capabilities.py; this alias keeps the local name callers already use.
_PROVIDER_ENV_VARS: Dict[str, str] = PROVIDER_ENV_VARS

# The Claude harness selects a model by a bare alias (``haiku``/``sonnet``/``opus`` + ``[1m]``)
# or by a dated id (``claude-opus-4-8``), never with a ``provider/`` prefix. Those bare ids are
# unambiguously Anthropic, so the F-017 "needs a provider prefix" rule must not reject them: a
# bare alias resolves to ``anthropic`` here before the fail-loud check. The canonical alias set
# lives in ``capabilities.py`` (the ``/inspect`` surface) so the two never drift.
_CLAUDE_ALIASES: Set[str] = {alias.lower() for alias in CLAUDE_MODEL_ALIASES}


def _build_catalog_provider_index() -> Dict[str, str]:
    """Invert ``supported_llm_models`` to ``{model_id: provider}`` for unambiguous ids only.

    A model id offered by more than one provider (e.g. the same open-weight model on two
    gateways) is dropped: inference must never guess between providers. Both the bare id and any
    provider-prefixed form map to the same provider so either spelling resolves.
    """
    from agenta.sdk.utils.assets import supported_llm_models

    owners: Dict[str, Set[str]] = {}
    for provider, models in supported_llm_models.items():
        for entry in models:
            bare = entry.split("/", 1)[1] if "/" in entry else entry
            for key in {entry.lower(), bare.lower()}:
                owners.setdefault(key, set()).add(provider)
    return {key: next(iter(prov)) for key, prov in owners.items() if len(prov) == 1}


_CATALOG_PROVIDER_INDEX: Dict[str, str] = _build_catalog_provider_index()


def infer_provider_from(model: ModelRef) -> Optional[str]:
    """Discover the provider for a bare (provider-less) model id, or ``None`` if undecidable.

    Discovery, not precedence: only fills a MISSING provider (an explicit ``provider`` is always
    honored), and never guesses. Three sources, in order of specificity:

    1. Claude harness aliases (``haiku``/``sonnet``/``opus`` + ``[1m]``) — harness shorthands that
       live outside any model catalog, so they can only be matched by name.
    2. The ``claude-*`` structural prefix — Anthropic's dated-id naming convention, which resolves
       newer ids the shared catalog has not been updated with yet.
    3. The shared ``supported_llm_models`` catalog — every other known model id, when it maps to
       exactly one provider.

    Returns ``None`` for an unknown or cross-provider-ambiguous id, which then fails loud (F-017)
    rather than resolving mis-credentialed.
    """
    if model.provider:
        return None
    bare = (model.model or "").strip().lower()
    if not bare:
        return None
    if bare in _CLAUDE_ALIASES or bare.startswith("claude-"):
        return "anthropic"
    return _CATALOG_PROVIDER_INDEX.get(bare)


def _harness_default_provider(harness: Optional[str]) -> str:
    """The provider to suggest in a missing-provider hint for ``harness``.

    Claude reaches Anthropic only, so its hint must read ``anthropic/<model>``; every other
    harness defaults to ``openai`` (the existing hint). Derived from the capability table's
    provider list so a harness's reachable providers stay the single source of truth.
    """
    caps = HARNESS_CONNECTION_CAPABILITIES.get(harness or "")
    if caps and caps.providers:
        if "openai" in caps.providers:
            return "openai"
        return caps.providers[0]
    return "openai"


# Extras keys the current UI stores on custom_provider secrets, normalized to harness env.
_SNAKE_EXTRA_ENV_ALIASES: Dict[str, str] = {
    "aws_region_name": "AWS_REGION",
    "aws_access_key_id": "AWS_ACCESS_KEY_ID",
    "aws_secret_access_key": "AWS_SECRET_ACCESS_KEY",
    "aws_session_token": "AWS_SESSION_TOKEN",
    "aws_bearer_token_bedrock": "AWS_BEARER_TOKEN_BEDROCK",
    "vertex_ai_project": "GOOGLE_CLOUD_PROJECT",
    "vertex_ai_location": "GOOGLE_CLOUD_LOCATION",
    "vertex_ai_credentials": "GOOGLE_APPLICATION_CREDENTIALS",
}

_ALLOWED_EXTRA_ENV_KEYS: Set[str] = {
    # API keys / auth tokens.
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_OAUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "GEMINI_API_KEY",
    "MISTRAL_API_KEY",
    "MINIMAX_API_KEY",
    "GROQ_API_KEY",
    "TOGETHERAI_API_KEY",
    "TOGETHER_API_KEY",
    "OPENROUTER_API_KEY",
    # Bedrock / AWS.
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
    "AWS_BEARER_TOKEN_BEDROCK",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
    # Vertex / GCP.
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_API_KEY",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_LOCATION",
    # Azure.
    "AZURE_OPENAI_API_KEY",
}


def _as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _stripped(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _provider_env_var(provider: Optional[str]) -> Optional[str]:
    return _PROVIDER_ENV_VARS.get(provider.lower()) if provider else None


def _header_name(secret: Dict[str, Any]) -> Optional[str]:
    return _stripped(_as_dict(secret.get("header")).get("name"))


def _data(secret: Dict[str, Any]) -> Dict[str, Any]:
    return _as_dict(secret.get("data"))


def _settings(secret: Dict[str, Any]) -> Dict[str, Any]:
    return _as_dict(_data(secret).get("provider"))


def _extras(settings: Dict[str, Any]) -> Dict[str, Any]:
    return _as_dict(settings.get("extras"))


def _model_slugs(data: Dict[str, Any]) -> Set[str]:
    slugs: Set[str] = set()
    for model in data.get("models") or []:
        if isinstance(model, dict):
            slug = _stripped(model.get("slug"))
        else:
            slug = _stripped(model)
        if slug:
            slugs.add(slug)
    return slugs


def _model_keys(data: Dict[str, Any], *, slug: str, deployment: str) -> Set[str]:
    keys = {_stripped(key) for key in data.get("model_keys") or []}
    keys = {key for key in keys if key}
    if keys:
        return keys
    return {f"{slug}/{deployment}/{model}" for model in _model_slugs(data)}


def _normalized_extra_env(extras: Dict[str, Any]) -> Dict[str, str]:
    env: Dict[str, str] = {}
    for key, value in extras.items():
        if value in (None, ""):
            continue
        env_key = _SNAKE_EXTRA_ENV_ALIASES.get(str(key))
        if env_key is None and str(key) in _ALLOWED_EXTRA_ENV_KEYS:
            env_key = str(key)
        if env_key:
            env[env_key] = str(value)
    return env


@dataclass
class _ConnectionCandidate:
    slug: str
    kind: str
    provider: Optional[str]
    deployment: str
    api_key: Optional[str] = None
    env: Dict[str, str] = field(default_factory=dict)
    endpoint: Optional[Endpoint] = None
    model_slugs: Set[str] = field(default_factory=set)
    model_keys: Set[str] = field(default_factory=set)

    def matches_provider(self, provider: Optional[str]) -> bool:
        return bool(
            provider and self.provider and self.provider.lower() == provider.lower()
        )

    def matches_model(self, model: ModelRef) -> bool:
        values = _model_lookup_values(model, self.deployment)
        return bool(values & self.model_slugs) or bool(values & self.model_keys)

    def selected_model_id(self, model: ModelRef) -> str:
        full = model.to_model_string()
        for key in self.model_keys:
            if key == full:
                parts = key.split("/", 2)
                return parts[2] if len(parts) == 3 else model.model
        if model.model in self.model_slugs:
            return model.model
        prefix = f"{self.deployment}/"
        if model.model.startswith(prefix):
            return model.model[len(prefix) :]
        return model.model

    def resolved_provider(self, model: ModelRef) -> str:
        return model.provider or self.provider or self.slug

    def resolved_env(self, provider: str) -> Dict[str, str]:
        env = dict(self.env)
        env_var = _provider_env_var(provider) or _provider_env_var(self.provider)
        # Bedrock's key is a bearer token with its own channel below — never the family's
        # API-key env var (a bedrock key in ANTHROPIC_API_KEY would mis-auth the direct API).
        if self.api_key and env_var and self.deployment != "bedrock":
            env.setdefault(env_var, self.api_key)
        if self.deployment == "azure" and self.api_key:
            env.setdefault("AZURE_OPENAI_API_KEY", self.api_key)
        # A bedrock key rides AWS_BEARER_TOKEN_BEDROCK — the one channel both harnesses accept.
        if self.deployment == "bedrock" and self.api_key:
            env.setdefault("AWS_BEARER_TOKEN_BEDROCK", self.api_key)
        return env


def _model_lookup_values(model: ModelRef, deployment: str) -> Set[str]:
    values = {model.model, model.to_model_string()}
    if model.provider:
        values.add(f"{model.provider}/{model.model}")
    prefix = f"{deployment}/"
    if model.model.startswith(prefix):
        values.add(model.model[len(prefix) :])
    return {value for value in values if value}


def _provider_key_candidate(secret: Dict[str, Any]) -> Optional[_ConnectionCandidate]:
    data = _data(secret)
    provider = _stripped(data.get("kind"))
    key = _stripped(_settings(secret).get("key"))
    if not provider:
        return None
    # A provider_key is identified by its provider — it has no slug concept, never `header.name`.
    return _ConnectionCandidate(
        slug=provider,
        kind="provider_key",
        provider=provider,
        deployment="direct",
        api_key=key,
    )


def _custom_provider_candidate(
    secret: Dict[str, Any],
) -> Optional[_ConnectionCandidate]:
    data = _data(secret)
    settings = _settings(secret)
    extras = _extras(settings)
    slug = _header_name(secret) or _stripped(data.get("provider_slug"))
    provider_kind = _stripped(data.get("kind")) or "custom"
    if not slug:
        return None

    env = _normalized_extra_env(extras)
    region = env.get("AWS_REGION") or env.get("AWS_DEFAULT_REGION")
    raw_url = _stripped(settings.get("url"))
    if raw_url:
        try:
            assert_endpoint_url_allowed(raw_url)
        except ValueError:
            log.warning("agent: custom_provider url blocked by SSRF guard, dropping")
            raw_url = None
    endpoint = Endpoint(
        base_url=raw_url,
        api_version=_stripped(settings.get("version")),
        region=region,
    )
    if not endpoint.to_wire():
        endpoint = None

    data_kind = provider_kind.lower()
    provider = data_kind if data_kind in _PROVIDER_ENV_VARS else None
    # Vault custom-provider records use data.kind for two different roles: a known
    # provider family (for example openrouter) or a deployment surface (for example
    # bedrock). Pi consumes the known provider families through its direct surface.
    deployment = "direct" if provider is not None else provider_kind
    api_key = _stripped(settings.get("key")) or _stripped(extras.get("api_key"))

    return _ConnectionCandidate(
        slug=slug,
        kind="custom_provider",
        provider=provider,
        deployment=deployment,
        api_key=api_key,
        env=env,
        endpoint=endpoint,
        model_slugs=_model_slugs(data),
        # Stored model keys remain namespaced by the vault provider kind. Runtime
        # deployment normalization must not change how a committed model selector matches.
        model_keys=_model_keys(data, slug=slug, deployment=provider_kind),
    )


def _catalog(secrets: Iterable[Any]) -> List[_ConnectionCandidate]:
    candidates: List[_ConnectionCandidate] = []
    for item in secrets:
        secret = _as_dict(item)
        kind = secret.get("kind")
        candidate: Optional[_ConnectionCandidate]
        if kind == "provider_key":
            candidate = _provider_key_candidate(secret)
        elif kind == "custom_provider":
            candidate = _custom_provider_candidate(secret)
        else:
            candidate = None
        if candidate is not None:
            candidates.append(candidate)
    return candidates


def _candidate_pool(
    candidates: Sequence[_ConnectionCandidate], model: ModelRef
) -> List[_ConnectionCandidate]:
    model_matches = [
        candidate for candidate in candidates if candidate.matches_model(model)
    ]
    if model_matches:
        return model_matches
    if model.provider:
        return [
            candidate
            for candidate in candidates
            if candidate.matches_provider(model.provider)
        ]
    return []


def _choose_default(
    candidates: Sequence[_ConnectionCandidate],
    model: ModelRef,
    harness: Optional[str] = None,
) -> _ConnectionCandidate:
    pool = _candidate_pool(candidates, model)
    if not pool and not model.provider:
        # A bare model id (no provider prefix) matched nothing by model id, so there is no
        # provider to look a credential up against. Fail loud with an actionable message rather
        # than degrade to no-credential and surface later as a misleading "add your key" error.
        # The hint names the harness-reachable provider (anthropic for Claude, not openai).
        raise MissingProviderError(
            model=model.model, hint_provider=_harness_default_provider(harness)
        )
    if len(pool) == 1:
        return pool[0]
    default_named = [candidate for candidate in pool if candidate.slug == "default"]
    if len(default_named) == 1:
        return default_named[0]
    provider = model.provider or ""
    raise AmbiguousConnectionError(provider=provider)


def _choose_named(
    candidates: Sequence[_ConnectionCandidate], model: ModelRef, slug: str
) -> _ConnectionCandidate:
    named = [candidate for candidate in candidates if candidate.slug == slug]
    if not named:
        raise ConnectionNotFoundError(slug=slug, provider=model.provider)
    if len(named) > 1:
        narrowed = _candidate_pool(named, model)
        if len(narrowed) == 1:
            return narrowed[0]
        if len(narrowed) > 1:
            raise AmbiguousConnectionError(provider=model.provider or "", slug=slug)
        raise AmbiguousConnectionError(provider=model.provider or "", slug=slug)
    chosen = named[0]
    if (
        chosen.kind == "provider_key"
        and model.provider
        and not chosen.matches_provider(model.provider)
    ):
        raise ProviderMismatchError(
            expected=model.provider, actual=chosen.provider or ""
        )
    if (
        chosen.kind == "custom_provider"
        and chosen.provider
        and model.provider
        and not chosen.matches_provider(model.provider)
        and not chosen.matches_model(model)
    ):
        raise ProviderMismatchError(expected=model.provider, actual=chosen.provider)
    return chosen


def _resolve_from_secrets(
    *, secrets: Sequence[Any], model: ModelRef, harness: Optional[str] = None
) -> ResolvedConnection:
    connection = model.connection
    # A bare Claude alias (haiku/sonnet/opus + [1m]) or a dated claude-* id is unambiguously
    # Anthropic: infer the provider so the F-017 fail-loud rule does not reject a documented
    # Claude model id. Inference only fills a missing provider; an explicit provider is honored.
    inferred = infer_provider_from(model)
    if inferred:
        model = model.model_copy(update={"provider": inferred})
    if connection.mode == "self_managed":
        return build_resolved_connection(
            provider=model.provider or "",
            model=model.model,
            credential_mode="runtime_provided",
            values={},
        )
    if connection.mode != "agenta":
        raise UnsupportedConnectionModeError(mode=str(connection.mode))

    candidates = _catalog(secrets)
    slug = _stripped(connection.slug)
    chosen = (
        _choose_named(candidates, model, slug)
        if slug
        else _choose_default(candidates, model, harness)
    )
    provider = chosen.resolved_provider(model)
    env = chosen.resolved_env(provider)
    return build_resolved_connection(
        provider=provider,
        model=chosen.selected_model_id(model),
        deployment=chosen.deployment,
        credential_mode="env" if env else "runtime_provided",
        values=env,
        endpoint=chosen.endpoint,
    )


class VaultConnectionResolver:
    """Resolve a ``ModelRef`` from the existing ``GET /secrets/`` response.

    The class name stays for compatibility with existing imports, but it no longer calls a
    connection-specific route. Every resolve fetches the caller-scoped vault list, builds an
    in-memory catalog, selects one connection deterministically, and returns only that
    connection's env.
    """

    def __init__(self, connection: Optional[PlatformConnection] = None) -> None:
        self._connection = connection or PlatformConnection()

    async def resolve(
        self,
        *,
        model: ModelRef,
        context: RuntimeAuthContext,
    ) -> ResolvedConnection:
        if model.connection.mode == "self_managed":
            return await _StaticSecretsResolver([]).resolve(
                model=model, context=context
            )

        api_base = self._connection.base_url()
        if not api_base:
            raise ConnectionResolutionError(
                "no Agenta backend configured for connection resolution"
            )

        try:
            async with httpx.AsyncClient(timeout=self._connection.timeout) as client:
                response = await client.get(
                    f"{api_base}/secrets/",
                    headers=self._connection.headers(),
                )
        except Exception as exc:  # pylint: disable=broad-except
            log.warning(
                "agent: secrets fetch for connection resolution failed", exc_info=True
            )
            raise ConnectionResolutionError(
                "connection resolution request failed"
            ) from exc

        if response.status_code >= 400:
            log.warning("agent: vault secrets fetch HTTP %s", response.status_code)
            raise ConnectionResolutionError(
                f"connection resolution failed (HTTP {response.status_code})"
            )

        data = response.json() or []
        if not isinstance(data, list):
            raise ConnectionResolutionError("connection resolution returned a non-list")
        return _resolve_from_secrets(secrets=data, model=model, harness=context.harness)


class _StaticSecretsResolver:
    def __init__(self, secrets: Sequence[Any]) -> None:
        self._secrets = secrets

    async def resolve(
        self,
        *,
        model: ModelRef,
        context: RuntimeAuthContext,
    ) -> ResolvedConnection:
        return _resolve_from_secrets(
            secrets=self._secrets, model=model, harness=context.harness
        )

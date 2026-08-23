"""Agenta-platform-backed connection resolution over the existing secrets API.

``VaultConnectionResolver`` is the connected-path ``ConnectionResolver`` adapter. It fetches
``GET /secrets/`` with the caller's request auth, builds an in-memory catalog from existing
``provider_key`` and ``custom_provider`` vault records, selects exactly one connection for the
``ModelRef``, and returns a least-privilege ``ResolvedConnection`` plan.

There is deliberately no ``/vault/connections`` route here. The vault remains the existing
``/secrets`` store; connection is only a runtime read view inside the service/SDK agent path.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, replace
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

import httpx

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.net import assert_endpoint_url_allowed

from ..capabilities import (
    CLAUDE_MODEL_ALIASES,
    HARNESS_CONNECTION_CAPABILITIES,
    PROVIDER_ENV_VARS,
)
from ..connections.credentials import credential_extras, secret_value_configured
from ..connections.endpoints import build_resolved_connection
from ..connections import (
    AmbiguousConnectionError,
    ConnectionNotFoundError,
    ConnectionResolutionError,
    EndpointResolutionError,
    Endpoint,
    MissingCredentialError,
    MissingProviderError,
    ModelRef,
    ProviderMismatchError,
    ResolvedConnection,
    RuntimeAuthContext,
    UnsupportedConnectionModeError,
    WriteOnlySecretError,
)
from ..model_catalog import model_input_modalities
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


def _credential_channels(
    provider: str, candidate: "_ConnectionCandidate"
) -> List[Tuple[str, ...]]:
    """The environment variables this candidate's credential could ride, best first.

    Each entry is one COMPLETE channel: every variable in it must be present for that
    channel to authenticate. Deliberately the variables the harness itself would read for
    this candidate, never merely the provider family's — a Bedrock or Azure candidate
    authenticates through its own channel, and reading a family key (say
    ``OPENAI_API_KEY``) for it would send one service's credential to another. The set
    mirrors the credential material the plaintext path accepts for the same connection
    (``CREDENTIAL_EXTRAS_KEYS``), so a standalone run can supply from the environment
    exactly what the vault would have supplied.
    """
    if candidate.deployment == "bedrock":
        return [
            ("AWS_BEARER_TOKEN_BEDROCK",),
            ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"),
        ]
    if candidate.deployment in ("vertex_ai", "vertex"):
        return [("GOOGLE_APPLICATION_CREDENTIALS",)]
    if candidate.deployment == "azure":
        return [("AZURE_OPENAI_API_KEY",)]

    env_var = _provider_env_var(provider) or _provider_env_var(candidate.provider)
    return [(env_var,)] if env_var else []


def _environment_credential(
    provider: str, candidate: "_ConnectionCandidate"
) -> Optional[Dict[str, str]]:
    """This run's own credential for the candidate, or ``None`` when it has none.

    A channel counts only when EVERY variable in it is set: half an AWS key pair
    authenticates nothing, and passing it on would fail at the provider with a
    misleading error instead of here with an actionable one.
    """
    for channel in _credential_channels(provider, candidate):
        values = {name: (os.environ.get(name) or "").strip() for name in channel}
        if all(values.values()):
            return values

    return None


def _header_name(secret: Dict[str, Any]) -> Optional[str]:
    return _stripped(_as_dict(secret.get("header")).get("name"))


def _data(secret: Dict[str, Any]) -> Dict[str, Any]:
    return _as_dict(secret.get("data"))


def _settings(secret: Dict[str, Any]) -> Dict[str, Any]:
    return _as_dict(_data(secret).get("provider"))


def _extras(settings: Dict[str, Any]) -> Dict[str, Any]:
    return _as_dict(settings.get("extras"))


def _saved_models(data: Dict[str, Any]) -> Optional[List[str]]:
    """The connection's saved model list, in saved order, or ``None`` when it saved none.

    ``None`` and ``[]`` mean different things (use Agenta's defaults vs. show nothing), so the
    absent case must stay distinguishable from the empty one.
    """
    models = data.get("models")
    if models is None:
        return None
    slugs = [
        _stripped(model.get("slug") if isinstance(model, dict) else model)
        for model in models
    ]
    return [slug for slug in slugs if slug]


def _saved_harnesses(data: Dict[str, Any]) -> Optional[List[str]]:
    """The harnesses the connection is allowed to drive, or ``None`` when it saved no choice."""
    harnesses = data.get("harnesses")
    if harnesses is None:
        return None
    names = [_stripped(harness) for harness in harnesses]
    return [name for name in names if name]


def _model_slugs(data: Dict[str, Any]) -> Set[str]:
    return set(_saved_models(data) or [])


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
    # True when a base URL was supplied but the egress policy rejected it (so the endpoint was
    # dropped). Distinguishes "blocked" from "absent" for the fail-loud endpoint error below.
    endpoint_blocked: bool = False
    model_slugs: Set[str] = field(default_factory=set)
    model_keys: Set[str] = field(default_factory=set)
    # The connection's saved policy, carried for the slices that consume it (the picker, the
    # harness intersection). Neither field filters resolution here yet.
    models: Optional[List[str]] = None
    harnesses: Optional[List[str]] = None
    # True when value_status says a credential exists but this caller's
    # credential received the redacted, value-less shape.
    write_only_redacted: bool = False

    def matches_provider(self, provider: Optional[str]) -> bool:
        return bool(
            provider and self.provider and self.provider.lower() == provider.lower()
        )

    def matches_model(self, model: ModelRef) -> bool:
        values = _model_lookup_values(model, self.deployment)
        return bool(values & self.model_slugs) or bool(values & self.model_keys)

    def declares_model(self, model: ModelRef) -> bool:
        """Whether the connection's SAVED model list names this model.

        ``models is None`` means "use Agenta's defaults" — an absent declaration, not a claim on
        every model — so it never narrows a provider pool. Saved ids are stored in their bare
        spelling (the settings card collapses them), hence the case-insensitive bare compare.
        """
        if not self.models:
            return False
        declared = {value.lower() for value in self.models}
        return bool(
            {value.lower() for value in _model_lookup_values(model, self.deployment)}
            & declared
        )

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
        if model.provider:
            return model.provider
        if self.provider:
            return self.provider
        # A provider-less named custom (OpenAI-compatible) connection normalizes to the
        # ``openai`` provider family: its key then rides ``OPENAI_API_KEY`` (via ``resolved_env``)
        # and the harness pair check reads ``openai``. An explicit provider (e.g. an Anthropic
        # gateway) always wins above; the connection slug stays runtime identity
        # (``request.connection.slug``) and must never become the semantic provider family.
        if self.deployment == "custom":
            return "openai"
        return self.slug

    def requires_endpoint(self) -> bool:
        """Whether this candidate must resolve to a usable base URL.

        A named custom (OpenAI-compatible or gateway) connection routes through an explicit
        endpoint. Continuing with no base URL would let the harness fall back to a provider
        default, silently violating the user's routing choice, so resolution fails loud instead
        (design Decision 4). Known-family custom records resolve to ``direct`` and keep the
        provider's own default endpoint, so they are exempt.
        """
        return self.deployment == "custom"

    def endpoint_resolution_error(self) -> EndpointResolutionError:
        """The typed, key-free failure for a custom connection missing a usable base URL."""
        if self.endpoint_blocked:
            detail = (
                "its endpoint URL is blocked by the outbound egress policy (non-HTTPS or a "
                "private, loopback, link-local, or reserved address); trusted self-hosted "
                "deployments can allow it with AGENTA_INSECURE_EGRESS_ALLOWED"
            )
        else:
            detail = "it has no base URL configured"
        # Names the connection slug for the operator; never includes the API key.
        return EndpointResolutionError(
            f"custom connection '{self.slug}' cannot be resolved: {detail}"
        )

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


def _write_only_redacted(secret: Dict[str, Any], has_credential: bool) -> bool:
    """Whether the vault redacted this record's value for the current caller.

    ``has_credential`` must consider EVERY credential channel the candidate could use (the
    primary key and the credential extras): a surviving config extra like ``AWS_REGION``
    must not read as "credentialed".
    """
    return (
        bool(secret.get("write_only"))
        and secret_value_configured(secret)
        and not has_credential
    )


def _provider_key_candidate(secret: Dict[str, Any]) -> Optional[_ConnectionCandidate]:
    data = _data(secret)
    provider = _stripped(data.get("kind"))
    key = _stripped(_settings(secret).get("key"))
    if not provider:
        return None
    # Records created since named connections carry a stable slug and are addressed by it, so a
    # project can hold several keys per provider. Older records have none and stay addressable by
    # their provider family. `header.name` is display-only and is never identity.
    return _ConnectionCandidate(
        slug=_stripped(secret.get("slug")) or provider,
        kind="provider_key",
        provider=provider,
        deployment="direct",
        api_key=key,
        models=_saved_models(data),
        harnesses=_saved_harnesses(data),
        write_only_redacted=_write_only_redacted(secret, bool(key)),
    )


def _custom_provider_candidate(
    secret: Dict[str, Any],
) -> Optional[_ConnectionCandidate]:
    data = _data(secret)
    settings = _settings(secret)
    extras = _extras(settings)
    # The namespace stored model keys were built with, which stays the display name.
    provider_slug = _header_name(secret) or _stripped(data.get("provider_slug"))
    # Records created since named connections carry a stable slug and are addressed by it, so a
    # rename no longer moves the connection; older records stay addressable by their name.
    slug = _stripped(secret.get("slug")) or provider_slug
    provider_kind = _stripped(data.get("kind")) or "custom"
    if not slug:
        return None

    env = _normalized_extra_env(extras)
    region = env.get("AWS_REGION") or env.get("AWS_DEFAULT_REGION")
    raw_url = _stripped(settings.get("url"))
    endpoint_blocked = False
    if raw_url:
        try:
            assert_endpoint_url_allowed(raw_url)
        except ValueError:
            # Drop the blocked URL here (the candidate may not be the chosen one). A named
            # custom connection that IS chosen fails loud in `_resolve_from_secrets` instead of
            # continuing endpoint-less (design Decision 4); `endpoint_blocked` shapes that error.
            log.warning("agent: custom_provider url blocked by egress policy, dropping")
            raw_url = None
            endpoint_blocked = True
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
        endpoint_blocked=endpoint_blocked,
        model_slugs=_model_slugs(data),
        # Stored model keys remain namespaced by the vault provider kind. Runtime
        # deployment normalization must not change how a committed model selector matches.
        model_keys=_model_keys(
            data, slug=provider_slug or slug, deployment=provider_kind
        ),
        models=_saved_models(data),
        harnesses=_saved_harnesses(data),
        write_only_redacted=_write_only_redacted(
            secret, bool(api_key) or bool(credential_extras(extras))
        ),
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
    if not pool:
        # Zero candidates with a known provider is a MISSING credential, not an ambiguous
        # one — falling through to AmbiguousConnectionError told users with an empty vault
        # "multiple connections for provider 'X'" and sent them hunting phantom secrets.
        raise MissingCredentialError(provider=model.provider or "")
    if len(pool) == 1:
        return pool[0]
    # A project may hold several connections per provider (Settings -> AI providers lists one row
    # per connection), and a slug-less config is the shape the product itself creates for a new
    # app. It is still resolvable when exactly one of those connections DECLARES the requested
    # model in its saved list — the same list the picker offered the model from. Connections that
    # saved no list stay unconstrained and never win by declaration.
    declaring = [candidate for candidate in pool if candidate.declares_model(model)]
    if len(declaring) == 1:
        return declaring[0]
    default_named = [candidate for candidate in pool if candidate.slug == "default"]
    if len(default_named) == 1:
        return default_named[0]
    provider = model.provider or ""
    raise AmbiguousConnectionError(
        provider=provider,
        candidates=[candidate.slug for candidate in pool if candidate.slug],
    )


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
        provider = model.provider or ""
        return build_resolved_connection(
            provider=provider,
            model=model.model,
            credential_mode="runtime_provided",
            values={},
            # A miss means workspace-only downstream; do not guess.
            input_modalities=model_input_modalities(
                harness, model.model, provider=provider or None
            ),
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
    # Checked BEFORE the endpoint and env checks: a redacted write-only key is the deeper
    # cause, and surviving config extras (AWS_REGION) can make `env` non-empty, which would
    # otherwise let the run proceed mis-credentialed.
    if chosen.write_only_redacted:
        # The vault will never hand this caller the value, so the connection cannot supply
        # the credential here. A provider key in this run's own environment is the
        # documented way to run outside the platform, and it is what the error tells the
        # user to do — so use it when it is there, and fail loud only when it is not. The
        # key rides the variable it was read from, never a different channel.
        fallback = _environment_credential(provider, chosen)
        if fallback is None:
            raise WriteOnlySecretError(slug=chosen.slug, provider=provider)
        chosen = replace(
            chosen,
            api_key=None,
            write_only_redacted=False,
            env={**chosen.env, **fallback},
        )
    # A chosen custom connection must carry a usable base URL. Failing here (rather than
    # returning endpoint=None) keeps the harness from falling back to a provider default and
    # silently ignoring the user's routing choice (design Decision 4). The error names the slug
    # and never carries the API key.
    if chosen.requires_endpoint() and not (
        chosen.endpoint and chosen.endpoint.base_url
    ):
        raise chosen.endpoint_resolution_error()
    env = chosen.resolved_env(provider)
    resolved_model = chosen.selected_model_id(model)
    if not env:
        raise MissingCredentialError(provider=provider, slug=chosen.slug)
    return build_resolved_connection(
        provider=provider,
        model=resolved_model,
        deployment=chosen.deployment,
        credential_mode="env",
        values=env,
        endpoint=chosen.endpoint,
        # A miss means workspace-only downstream; do not guess.
        input_modalities=model_input_modalities(
            harness, resolved_model, provider=provider
        ),
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

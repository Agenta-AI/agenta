"""Connection projection and deterministic resolution over the existing secret vault.

A *connection* is a read view over the secrets the vault already stores: a ``provider_key``
secret is a direct connection, a ``custom_provider`` secret is a connection that already carries
an endpoint. v1 adds no storage, no write path, and no migration; it adds a read list and a
deterministic resolve over these secrets.

This module holds the CORE layer of the provider/model/auth feature on the API side:

- :class:`ConnectionView` — the non-secret list item (never the key).
- :class:`ResolvedConnectionResult` — the internal resolve output; it DOES carry ``env`` with
  the plaintext key (the whole point of an internal resolve), which is why the endpoint that
  returns it must stay internal-only (design Security rule 3).
- The domain exceptions (mirroring the SDK ``connections/errors.py`` names/messages); never
  raise ``HTTPException`` here — the router catches these at the boundary.
- :func:`resolve_connection` — a PURE function over a list of decrypted secrets implementing the
  deterministic resolution rules (design Concern 3, "Resolution rules"). It reads no DB, so it is
  unit-testable directly.

Design: ``docs/design/agent-workflows/projects/provider-model-auth/design.md``.

The API must NOT import the SDK; the provider->env map and the capability table are duplicated
on each side on purpose (the SDK side serves standalone/FE, the API side is server-authoritative).
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from oss.src.core.secrets.capabilities import (
    harness_allows_mode,
    harness_allows_provider,
)
from oss.src.core.secrets.enums import SecretKind


# Map a vault standard-provider kind to the env var the harness (Pi/Claude/litellm) reads for its
# api key. Same shape and entries as the SDK's ``platform/secrets.py`` ``_PROVIDER_ENV_VARS`` and
# ``connections/resolver.py`` so the readers agree on provider -> env-var. Duplicated on purpose
# (the API must not import the SDK); keep in sync.
_PROVIDER_ENV_VARS: Dict[str, str] = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "mistral": "MISTRAL_API_KEY",
    "mistralai": "MISTRAL_API_KEY",
    "groq": "GROQ_API_KEY",
    "together_ai": "TOGETHERAI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


def _provider_env_var(provider: str) -> Optional[str]:
    return _PROVIDER_ENV_VARS.get(provider.lower()) if provider else None


# A ``custom_provider`` secret's ``data.kind`` maps to a resolved deployment surface.
_CUSTOM_DEPLOYMENT_BY_KIND: Dict[str, str] = {
    "azure": "azure",
    "bedrock": "bedrock",
    "vertex_ai": "vertex",
}


# --- domain exceptions (mirror the SDK connection errors; never HTTPException here) ----------


class ConnectionResolutionError(Exception):
    """Base error for connection resolution. Caught at the router boundary -> HTTP error."""


class ConnectionNotFound(ConnectionResolutionError):
    def __init__(self, *, slug: str, provider: Optional[str] = None) -> None:
        suffix = f" for provider '{provider}'" if provider else ""
        self.slug = slug
        self.provider = provider
        super().__init__(f"connection '{slug}' not found{suffix}")


class AmbiguousConnection(ConnectionResolutionError):
    def __init__(self, *, provider: str, slug: Optional[str] = None) -> None:
        if slug:
            message = (
                f"ambiguous connection '{slug}' for provider '{provider}'; "
                "connection names must be unique to resolve"
            )
        else:
            message = f"multiple connections for provider '{provider}'; name one in the config"
        self.provider = provider
        self.slug = slug
        super().__init__(message)


class ProviderMismatch(ConnectionResolutionError):
    def __init__(self, *, expected: str, actual: str) -> None:
        self.expected = expected
        self.actual = actual
        super().__init__(
            f"connection provider '{actual}' does not match model provider '{expected}'"
        )


class UnsupportedProvider(ConnectionResolutionError):
    def __init__(self, *, provider: str, harness: Optional[str] = None) -> None:
        suffix = f" by harness '{harness}'" if harness else ""
        self.provider = provider
        self.harness = harness
        super().__init__(f"provider '{provider}' is not supported{suffix}")


class UnsupportedConnectionMode(ConnectionResolutionError):
    def __init__(self, *, mode: str, harness: Optional[str] = None) -> None:
        suffix = f" by harness '{harness}'" if harness else ""
        self.mode = mode
        self.harness = harness
        super().__init__(f"connection mode '{mode}' is not supported{suffix}")


class UnsupportedDeployment(ConnectionResolutionError):
    """A cloud deployment (azure/bedrock/vertex) whose credential delivery v1 does not wire yet.

    These need provider-specific cloud credential delivery (AWS/GCP env, ``CLAUDE_CODE_USE_*``),
    owned by the model-config sibling project. v1 fails loud rather than silently dropping the
    key and running with no credential.
    """

    def __init__(self, *, deployment: str, slug: Optional[str] = None) -> None:
        self.deployment = deployment
        self.slug = slug
        named = f" '{slug}'" if slug else ""
        super().__init__(
            f"connection{named} uses deployment '{deployment}', which is not supported yet; "
            "use a direct or OpenAI-compatible custom connection"
        )


# --- non-secret read view --------------------------------------------------------------------


class ConnectionEndpointView(BaseModel):
    """The non-secret endpoint of a connection (a custom provider's base URL, version, region)."""

    base_url: Optional[str] = None
    api_version: Optional[str] = None
    region: Optional[str] = None


class ConnectionView(BaseModel):
    """One connection as a non-secret list item. NEVER carries key material."""

    slug: str
    provider: str
    deployment: str = "direct"
    endpoint: Optional[ConnectionEndpointView] = None
    kind: str  # the vault SecretKind: "provider_key" | "custom_provider"


# --- internal resolve output (carries the key; internal-only) --------------------------------


class ResolvedConnectionResult(BaseModel):
    """The least-privilege resolve output. ``env`` carries the plaintext key: internal-only.

    Mirrors the SDK ``ResolvedConnection`` wire shape. ``env`` is the ONLY secret-bearing channel
    (one provider's vars); ``endpoint`` carries only non-secret connection config.
    """

    provider: str
    model: str
    deployment: str = "direct"
    credential_mode: str  # "env" | "runtime_provided" | "none"
    env: Dict[str, str] = Field(default_factory=dict, repr=False)
    endpoint: Optional[ConnectionEndpointView] = None


# --- secret projection -----------------------------------------------------------------------


def _secret_slug(secret: Any) -> Optional[str]:
    """The connection slug = the secret's header name."""
    header = getattr(secret, "header", None)
    name = getattr(header, "name", None) if header is not None else None
    return name


def _secret_kind(secret: Any) -> Optional[str]:
    kind = getattr(secret, "kind", None)
    return kind.value if hasattr(kind, "value") else kind


def _data_kind(data: Any) -> str:
    kind = getattr(data, "kind", None)
    return (kind.value if hasattr(kind, "value") else kind) or ""


def _projected_provider(secret: Any) -> Optional[str]:
    """The provider family a secret connects to.

    - ``provider_key``: ``data.kind`` (e.g. "openai", "anthropic").
    - ``custom_provider``: ``data.kind`` is the provider kind (azure/bedrock/vertex_ai/openai/...).
    """
    kind = _secret_kind(secret)
    if kind not in (
        SecretKind.PROVIDER_KEY.value,
        SecretKind.CUSTOM_PROVIDER.value,
    ):
        return None
    data = getattr(secret, "data", None)
    return _data_kind(data) or None


def _projected_deployment(secret: Any) -> str:
    if _secret_kind(secret) != SecretKind.CUSTOM_PROVIDER.value:
        return "direct"
    data = getattr(secret, "data", None)
    return _CUSTOM_DEPLOYMENT_BY_KIND.get(_data_kind(data), "custom")


def _custom_provider_settings(secret: Any) -> Any:
    return getattr(getattr(secret, "data", None), "provider", None)


def project_connection_view(secret: Any) -> Optional[ConnectionView]:
    """Project one decrypted vault secret into a non-secret :class:`ConnectionView`, or ``None``.

    Returns ``None`` for secrets that are not connections (SSO / webhook providers).
    """
    provider = _projected_provider(secret)
    slug = _secret_slug(secret)
    if provider is None or not slug:
        return None

    endpoint: Optional[ConnectionEndpointView] = None
    if _secret_kind(secret) == SecretKind.CUSTOM_PROVIDER.value:
        settings = _custom_provider_settings(secret)
        if settings is not None:
            base_url = getattr(settings, "url", None)
            version = getattr(settings, "version", None)
            if base_url or version:
                endpoint = ConnectionEndpointView(
                    base_url=base_url,
                    api_version=version,
                )

    return ConnectionView(
        slug=slug,
        provider=provider,
        deployment=_projected_deployment(secret),
        endpoint=endpoint,
        kind=_secret_kind(secret) or "",
    )


def _build_env_and_endpoint(
    *, secret: Any, provider: str
) -> tuple[Dict[str, str], Optional[ConnectionEndpointView]]:
    """Build the least-privilege ``env`` (one provider's key) and the non-secret endpoint.

    For ``provider_key`` the key rides ``data.provider.key``. For ``custom_provider`` the key
    rides ``data.provider.key`` too and the base URL / version surface into the endpoint
    (non-secret); an OpenAI-compatible custom provider uses ``OPENAI_API_KEY``.
    """
    env: Dict[str, str] = {}
    endpoint: Optional[ConnectionEndpointView] = None
    kind = _secret_kind(secret)
    settings = _custom_provider_settings(secret)
    key = getattr(settings, "key", None) if settings is not None else None

    env_var = _provider_env_var(provider)
    if env_var and key:
        env[env_var] = key

    if kind == SecretKind.CUSTOM_PROVIDER.value and settings is not None:
        base_url = getattr(settings, "url", None)
        version = getattr(settings, "version", None)
        if base_url or version:
            endpoint = ConnectionEndpointView(base_url=base_url, api_version=version)

    return env, endpoint


# --- deterministic resolution (pure over a list of decrypted secrets) ------------------------


def resolve_connection(
    *,
    secrets: List[Any],
    model_provider: Optional[str],
    model_id: str,
    connection_mode: str,
    connection_slug: Optional[str],
    harness: str,
) -> ResolvedConnectionResult:
    """Resolve one connection deterministically. Pure over the project's decrypted secrets.

    Implements the design's resolution rules (Concern 3). Never picks a key by iteration order:
    a missing slug, an ambiguous match, a provider mismatch, or an unsupported provider/mode each
    raises a domain exception (caught at the router boundary). ``secrets`` is the project's
    already-decrypted ``SecretResponseDTO`` list; this function reads no DB.
    """
    # Capability reject (around resolution): provider and mode must be reachable by the harness.
    if model_provider and not harness_allows_provider(harness, model_provider):
        raise UnsupportedProvider(provider=model_provider, harness=harness)
    if not harness_allows_mode(harness, connection_mode):
        raise UnsupportedConnectionMode(mode=connection_mode, harness=harness)

    # Rule 1: self_managed -> inject nothing, model passthrough. No vault read needed.
    if connection_mode == "self_managed":
        return ResolvedConnectionResult(
            provider=model_provider or "",
            model=model_id,
            credential_mode="runtime_provided",
            env={},
        )

    # Only connection-bearing secrets participate (provider_key / custom_provider).
    connections = [s for s in secrets if _projected_provider(s) is not None]

    if connection_mode == "agenta":
        # Rule 2: a named connection must name one.
        if not (connection_slug and connection_slug.strip()):
            raise ConnectionNotFound(slug="", provider=model_provider)
        slug = connection_slug.strip()
        # Rule 3: match by slug. Absent -> not found. Multiple same-named -> disambiguate by
        # provider when given; a single wrong-provider match falls through to rule 5
        # (ProviderMismatch, a clearer error than not-found). With no provider given, a single
        # slug match adopts that connection's provider (minimal inference).
        named = [s for s in connections if _secret_slug(s) == slug]
        if not named:
            raise ConnectionNotFound(slug=slug, provider=model_provider)
        if len(named) > 1:
            if model_provider:
                named = [s for s in named if _projected_provider(s) == model_provider]
            if not named:
                raise ConnectionNotFound(slug=slug, provider=model_provider)
            if len(named) > 1:
                raise AmbiguousConnection(provider=model_provider or "", slug=slug)
        chosen = named[0]
        resolved_provider = model_provider or _projected_provider(chosen) or ""
    elif connection_mode == "default":
        # provider is required to pick a default; without it there is nothing to scope to.
        if not model_provider:
            raise AmbiguousConnection(provider="", slug=None)
        for_provider = [
            s for s in connections if _projected_provider(s) == model_provider
        ]
        if len(for_provider) == 1:
            chosen = for_provider[0]
        else:
            # Rule 4: else exactly one named "default" for the provider, else ambiguous.
            named_default = [s for s in for_provider if _secret_slug(s) == "default"]
            if len(named_default) == 1:
                chosen = named_default[0]
            else:
                raise AmbiguousConnection(provider=model_provider, slug=None)
        resolved_provider = model_provider
    else:
        raise UnsupportedConnectionMode(mode=connection_mode, harness=harness)

    # Rule 5: provider match. The resolved connection's provider must equal the model provider.
    chosen_provider = _projected_provider(chosen) or ""
    if model_provider and chosen_provider != model_provider:
        raise ProviderMismatch(expected=model_provider, actual=chosen_provider)

    # Fail loud for cloud deployments whose credential delivery v1 does not wire yet, rather than
    # silently dropping the key (these env vars are not in the provider map) and running with no
    # credential. Direct + OpenAI-compatible custom are the v1 surfaces.
    chosen_deployment = _projected_deployment(chosen)
    if chosen_deployment in _CUSTOM_DEPLOYMENT_BY_KIND.values():
        raise UnsupportedDeployment(
            deployment=chosen_deployment, slug=_secret_slug(chosen)
        )

    env, endpoint = _build_env_and_endpoint(secret=chosen, provider=resolved_provider)
    return ResolvedConnectionResult(
        provider=resolved_provider,
        model=model_id,
        deployment=_projected_deployment(chosen),
        credential_mode="env" if env else "runtime_provided",
        env=env,
        endpoint=endpoint,
    )

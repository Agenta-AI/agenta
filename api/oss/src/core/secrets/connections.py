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

The vault resolve is **harness-agnostic** (design Concern 3b): it does deterministic selection
plus a provider match only, and never consults a harness capability table. The capability check
(which provider / mode / deployment the selected harness can reach) lives up in the agent layer,
against the SDK capability table, around the resolve. So this module carries NO harness table and
takes no harness argument. The API must NOT import the SDK; the provider->env map is duplicated on
each side on purpose (the SDK side serves standalone/FE, the API side is server-authoritative).
"""

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

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
    "minimax": "MINIMAX_API_KEY",
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

# The complete secret-bearing env keys each cloud deployment needs, sourced from the
# harness-provider matrix. The resolver emits whichever of these the connection actually carries
# (in ``data.provider.extras`` for a custom_provider). The non-secret config (region, project,
# location) rides ``endpoint``, never ``env``. These are intentionally read from the secret's
# ``extras`` so a cloud connection can carry whatever subset its auth scheme uses (static keys, a
# profile, or a bearer token), and the runner clears the complete inventory before applying.
_BEDROCK_SECRET_ENV = (
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_PROFILE",
    "AWS_BEARER_TOKEN_BEDROCK",
)
_VERTEX_SECRET_ENV = (
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_API_KEY",
)
_AZURE_SECRET_ENV = ("AZURE_OPENAI_API_KEY",)

# Secret-bearing extras to pull per deployment. Keyed by the resolved deployment surface.
_CLOUD_SECRET_ENV_BY_DEPLOYMENT: Dict[str, tuple] = {
    "bedrock": _BEDROCK_SECRET_ENV,
    "vertex": _VERTEX_SECRET_ENV,
    "azure": _AZURE_SECRET_ENV,
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


class UnsupportedConnectionMode(ConnectionResolutionError):
    """A connection mode outside the two-mode union (``agenta`` / ``self_managed``)."""

    def __init__(self, *, mode: str) -> None:
        self.mode = mode
        super().__init__(f"connection mode '{mode}' is not a valid mode")


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


def _settings_extras(settings: Any) -> Dict[str, Any]:
    extras = getattr(settings, "extras", None) if settings is not None else None
    return extras if isinstance(extras, dict) else {}


def _build_env_and_endpoint(
    *, secret: Any, provider: str, deployment: str
) -> tuple[Dict[str, str], Optional[ConnectionEndpointView]]:
    """Build the COMPLETE secret-bearing ``env`` for the connection and the non-secret endpoint.

    ``env`` is the only secret channel and carries the complete set the connection needs, not a
    single key (design Concern 3):

    - ``provider_key`` / OpenAI-compatible ``custom_provider`` (deployment ``direct``/``custom``):
      the one provider api key from ``data.provider.key`` under its env var.
    - cloud ``custom_provider`` (deployment ``bedrock``/``vertex``/``azure``): the full credential
      group the deployment uses, pulled from ``data.provider.extras`` (static AWS keys, a profile,
      a bearer token, GCP ADC / api key, the Azure key), plus the OpenAI-compatible key path when
      one is present. The non-secret config (region/project/location) rides ``endpoint``.

    The base URL / api version always surface into the (non-secret) endpoint, never ``env``.
    """
    env: Dict[str, str] = {}
    endpoint: Optional[ConnectionEndpointView] = None
    kind = _secret_kind(secret)
    settings = _custom_provider_settings(secret)
    key = getattr(settings, "key", None) if settings is not None else None

    # The direct/openai-compatible api key (when the provider maps to a single *_API_KEY var).
    env_var = _provider_env_var(provider)
    if env_var and key:
        env[env_var] = key

    # The cloud deployment's full credential group: whichever secret-bearing vars the connection
    # actually carries in its extras (the apply set; the runner clears the complete inventory).
    cloud_keys = _CLOUD_SECRET_ENV_BY_DEPLOYMENT.get(deployment)
    if cloud_keys:
        extras = _settings_extras(settings)
        for var in cloud_keys:
            value = extras.get(var)
            if value:
                env[var] = str(value)
        # Azure's api key may live in the secret's `key` field rather than extras.
        if deployment == "azure" and key and "AZURE_OPENAI_API_KEY" not in env:
            env["AZURE_OPENAI_API_KEY"] = key

    if kind == SecretKind.CUSTOM_PROVIDER.value and settings is not None:
        base_url = getattr(settings, "url", None)
        version = getattr(settings, "version", None)
        region = _settings_extras(settings).get("region") or _settings_extras(
            settings
        ).get("AWS_REGION")
        if base_url or version or region:
            endpoint = ConnectionEndpointView(
                base_url=base_url,
                api_version=version,
                region=str(region) if region else None,
            )

    return env, endpoint


# --- deterministic resolution (pure over a list of decrypted secrets) ------------------------


def resolve_connection(
    *,
    secrets: List[Any],
    model_provider: Optional[str],
    model_id: str,
    connection_mode: str,
    connection_slug: Optional[str],
) -> ResolvedConnectionResult:
    """Resolve one connection deterministically. Pure over the project's decrypted secrets.

    Implements the design's two-mode resolution rules (Concern 3). HARNESS-AGNOSTIC: it never
    consults a harness capability table and takes no harness argument (the provider/mode/deployment
    capability check lives in the agent layer, around this call). Never picks a key by iteration
    order: a missing slug, an ambiguous match, or a provider mismatch each raises a domain
    exception (caught at the router boundary). ``secrets`` is the project's already-decrypted
    ``SecretResponseDTO`` list; this function reads no DB.

    For a resolved cloud deployment (bedrock/vertex/azure) it emits the COMPLETE credential set
    (not a single key) and reports the ``deployment``; it does NOT fail loud here. The harness that
    cannot consume that deployment is rejected in the agent layer (the post-resolve deployment
    check), so this stays harness-agnostic.
    """
    # Rule 1: self_managed -> inject nothing, model passthrough. No vault read needed.
    if connection_mode == "self_managed":
        return ResolvedConnectionResult(
            provider=model_provider or "",
            model=model_id,
            credential_mode="runtime_provided",
            env={},
        )

    if connection_mode != "agenta":
        # Two modes only (agenta / self_managed); anything else is a malformed request.
        raise UnsupportedConnectionMode(mode=connection_mode)

    # Only connection-bearing secrets participate (provider_key / custom_provider).
    connections = [s for s in secrets if _projected_provider(s) is not None]

    slug = (connection_slug or "").strip()
    if slug:
        # Named connection. Rule 2: match by slug. Absent -> not found. Multiple same-named ->
        # disambiguate by provider when given; a single wrong-provider match falls through to the
        # provider-match rule (ProviderMismatch, a clearer error than not-found). With no provider
        # given, a single slug match adopts that connection's provider (minimal inference).
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
    else:
        # No slug = the project default for the provider. Rule 3: exactly one connection for the
        # provider, else the uniquely-named "default", else ambiguous.
        if not model_provider:
            raise AmbiguousConnection(provider="", slug=None)
        for_provider = [
            s for s in connections if _projected_provider(s) == model_provider
        ]
        if len(for_provider) == 1:
            chosen = for_provider[0]
        else:
            named_default = [s for s in for_provider if _secret_slug(s) == "default"]
            if len(named_default) == 1:
                chosen = named_default[0]
            else:
                raise AmbiguousConnection(provider=model_provider, slug=None)
        resolved_provider = model_provider

    # Rule 4: provider match. The resolved connection's provider must equal the model provider.
    chosen_provider = _projected_provider(chosen) or ""
    if model_provider and chosen_provider != model_provider:
        raise ProviderMismatch(expected=model_provider, actual=chosen_provider)

    deployment = _projected_deployment(chosen)
    env, endpoint = _build_env_and_endpoint(
        secret=chosen, provider=resolved_provider, deployment=deployment
    )
    return ResolvedConnectionResult(
        provider=resolved_provider,
        model=model_id,
        deployment=deployment,
        credential_mode="env" if env else "runtime_provided",
        env=env,
        endpoint=endpoint,
    )

"""Neutral provider / model / connection contracts for the agent runtime.

These models carry *intent* (which model, which provider, where its credential comes from)
and the *resolved* least-privilege output a harness adapter applies. They are deliberately
credential-shaped only at the edges: ``ResolvedConnection.env`` is the one secret-bearing
channel; everything else (``Endpoint``, ``Connection``, ``ModelRef``) names non-secret intent.

The design is in
``docs/design/agent-workflows/projects/provider-model-auth/design.md`` (Concerns 1-3). This
module owns the SDK-side types; the resolver port lives in ``interfaces.py``, the offline
adapters in ``resolver.py``.

This module must NOT import ``..dtos`` (``dtos.py`` imports *from* here, mirroring how it
imports the ``.mcp`` / ``.skills`` / ``.tools`` subsystems), so keep it dependency-free.
"""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

# How a credential connection is named in the agent config. A connection is a portable
# reference into the vault, never a database id and never a raw secret value. Exactly two
# modes: ``agenta`` (a vault connection, project-default when ``slug`` is omitted, named when
# set) and ``self_managed`` (Agenta injects nothing). "The project default" is just ``agenta``
# with no slug; there is no separate ``default`` mode.
ConnectionMode = Literal["agenta", "self_managed"]

# Where a resolved credential comes from, as seen by the harness adapter. ``env`` ships one
# provider's vars; ``runtime_provided`` injects nothing (the harness owns auth, e.g. an OAuth
# login or a self-managed sidecar); ``none`` injects nothing and asserts no credential.
CredentialMode = Literal["env", "runtime_provided", "none"]

# Which deployment surface a provider is reached through. ``direct`` is the provider's own
# API; the rest are first-class cloud / gateway backends a harness can target.
Deployment = Literal["direct", "azure", "bedrock", "vertex", "custom"]


class Connection(BaseModel):
    """Where a model's credential comes from, named portably (a slug, never a db id).

    Exactly two modes:

    - ``agenta``: use a connection in the project vault. ``slug`` selects which:
      - **omitted** -> the project's default connection for the model's provider (resolution
        picks it deterministically; see the design's resolution rules).
      - **set** -> the named connection whose secret name equals ``slug``.
      In both cases ``agenta`` names nothing project-local (a slug is a name, never a db id),
      so it stays portable across projects.
    - ``self_managed``: Agenta injects nothing; the sandbox / sidecar / local env / the
      harness's own OAuth login owns auth. Covers OAuth subscriptions and self-hosting.

    A default-constructed ``Connection()`` is ``agenta`` with no slug (the project default) and
    always valid. ``slug`` is meaningful only for ``agenta``; a ``self_managed`` connection that
    carries a ``slug`` is rejected (the slug has nothing to resolve against).
    """

    mode: ConnectionMode = "agenta"
    slug: Optional[str] = (
        None  # meaningful only for "agenta"; the secret's name, never a db id
    )

    @model_validator(mode="after")
    def _reject_slug_for_self_managed(self) -> "Connection":
        if self.mode == "self_managed" and (self.slug and self.slug.strip()):
            raise ValueError(
                "connection mode 'self_managed' must not carry a 'slug' "
                "(it injects nothing, so there is nothing for a slug to resolve against)"
            )
        return self


class Endpoint(BaseModel):
    """NON-secret connection config a harness applies alongside its credential.

    This carries only public, non-secret fields: a custom base URL, an API version, a region,
    and public headers. Secret-bearing values (the api key, secret auth headers) never live
    here; they ride ``ResolvedConnection.env``, the one secret channel.
    """

    base_url: Optional[str] = None
    api_version: Optional[str] = None
    region: Optional[str] = None
    headers: Dict[str, str] = Field(default_factory=dict)  # public headers only

    def to_wire(self) -> Dict[str, Any]:
        """The non-secret endpoint as camelCase wire fields (``baseUrl``, ``apiVersion``).

        The whole agent wire is camelCase (``credentialMode``, ``appendSystemPrompt``,
        ``mcpServers``), so the endpoint sub-object matches that convention rather than the
        snake_case field names. Empty/default fields are omitted.
        """
        wire: Dict[str, Any] = {}
        if self.base_url is not None:
            wire["baseUrl"] = self.base_url
        if self.api_version is not None:
            wire["apiVersion"] = self.api_version
        if self.region is not None:
            wire["region"] = self.region
        if self.headers:
            wire["headers"] = dict(self.headers)
        return wire


class ModelRef(BaseModel):
    """Model intent plus the credential connection, carried in the agent config.

    A bare string still parses, with the default ``agenta`` connection (no slug):

    - ``"openai/gpt-5.5"`` -> ``ModelRef(provider="openai", model="gpt-5.5")``
    - ``"gpt-5.5"``        -> ``ModelRef(provider=None, model="gpt-5.5")``

    ``provider`` is logically required for resolution; when it is absent (a bare-string
    model), the resolver infers it from the model id or the matched connection, and errors if
    it cannot. The committed revision carries the whole ``ModelRef``, including the connection.
    """

    provider: Optional[str] = None  # "openai" | "anthropic" | "google" | <custom-slug>
    model: str  # model id in the provider's namespace: "gpt-5.5", "claude-opus-4-8"
    params: Dict[str, Any] = Field(
        default_factory=dict
    )  # neutral knobs (reasoning_effort, ...)
    connection: Connection = Field(default_factory=Connection)

    @classmethod
    def coerce(cls, value: Any) -> "ModelRef":
        """Accept a :class:`ModelRef`, a dict, or a string and return a :class:`ModelRef`.

        A string is split on the FIRST ``/`` only: ``"my-gw/llama-3"`` ->
        ``provider="my-gw", model="llama-3"``; a string with no ``/`` has ``provider=None``.
        Splitting only the first slash keeps a provider slug intact (it never contains a
        slash) and leaves any slash in the model id alone. ``openai`` and ``openai-codex`` are
        distinct providers, so the split is on the literal slug, not a known-provider lookup.
        """
        if isinstance(value, ModelRef):
            return value
        if isinstance(value, dict):
            return cls.model_validate(value)
        if isinstance(value, str):
            if "/" in value:
                provider, model = value.split("/", 1)
                return cls(provider=provider or None, model=model)
            return cls(provider=None, model=value)
        raise TypeError("ModelRef must be a ModelRef, a mapping, or a string")

    def to_model_string(self) -> str:
        """Project back to the wire ``model`` string: ``provider/model`` or bare ``model``.

        Used to keep the wire ``model`` field a plain string for back-compat with every
        caller that reads ``config.model`` as a string and hands it to a harness.
        """
        if self.provider:
            return f"{self.provider}/{self.model}"
        return self.model


class ResolvedConnection(BaseModel):
    """The least-privilege output a :class:`ConnectionResolver` returns for one run.

    ``env`` is the ONLY channel that carries secret values: one provider's vars (the api key
    and any secret-bearing extras). ``endpoint`` carries only non-secret connection config.
    The harness adapter applies ``env`` + ``endpoint`` + ``model`` and never sees a vault, a
    connection, or a slug.

    Serialization safety: ``env`` is masked from ``repr``/``str`` but NOT from
    ``model_dump()``/``model_dump_json()``. Use :meth:`to_wire` (which never emits ``env``) for
    anything that reaches a trace, a log, or an echoed payload. Never log a raw dump of a
    ``ResolvedConnection`` or a ``SessionConfig`` that carries one.
    """

    provider: str
    model: str  # possibly rewritten for the deployment (e.g. a bedrock id)
    deployment: Deployment = "direct"
    credential_mode: CredentialMode
    env: Dict[str, str] = Field(
        default_factory=dict, repr=False
    )  # the ONLY secret channel
    endpoint: Optional[Endpoint] = None  # NON-secret connection config only

    def to_wire(self) -> Dict[str, Any]:
        """The NON-secret camelCase fields for the wire. Never emits ``env``.

        ``env`` is the secret channel and rides the existing ``secrets`` wire field during the
        transition (Slice 1); only the non-secret descriptor is serialized here so a trace or
        an echoed payload never carries credentials.
        """
        wire: Dict[str, Any] = {
            "provider": self.provider,
            "model": self.model,
            "deployment": self.deployment,
            "credentialMode": self.credential_mode,
        }
        if self.endpoint is not None:
            endpoint_wire = self.endpoint.to_wire()
            if endpoint_wire:
                wire["endpoint"] = endpoint_wire
        return wire


class RuntimeAuthContext(BaseModel):
    """The request-derived context a resolver needs, beyond the :class:`ModelRef`.

    ``project_id`` is taken from the request state, never from the request body (a caller must
    not be able to resolve another project's credentials by passing an id).

    ``harness`` and ``backend`` are the run's harness layer, NOT the vault's. The vault resolve
    is harness-agnostic: it does deterministic selection plus provider-match only and never
    sees the harness. The capability check (which provider/mode/deployment the harness can
    reach) runs in the agent layer against the SDK capability table, around the resolve. So
    ``harness`` rides this context for the agent-layer check, but the
    :class:`~agenta.sdk.agents.platform.VaultConnectionResolver` never sends it to the vault.
    """

    project_id: Optional[UUID] = None  # from request.state, never the body
    harness: Optional[str] = None  # for the agent-layer capability check, NOT the vault
    backend: Optional[str] = (
        None  # sandbox-agent local / daytona / in-process / local SDK
    )

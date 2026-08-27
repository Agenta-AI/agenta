"""Errors raised while resolving an agent connection.

The resolution rules (in the design's Concern 3) are deterministic and fail-loud: a missing
slug, an ambiguous match, a provider mismatch, or an unsupported provider/mode each raise a
specific subclass rather than silently picking a credential by iteration order. Slice 1
defines the full set so the module is complete; the service-backed resolver (Slice 2) raises
them.
"""

from __future__ import annotations

from typing import Optional


class AgentConnectionError(Exception):
    """Base error for the agent connections domain.

    Named ``AgentConnectionError`` (not ``ConnectionError``) so it never shadows Python's
    builtin ``ConnectionError`` in this namespace, where network I/O (``platform/secrets.py``)
    can raise the builtin.
    """


class ConnectionResolutionError(AgentConnectionError):
    """Raised when a connection cannot be resolved into a credential plan."""


class EndpointResolutionError(ConnectionResolutionError):
    """Raised when a chosen custom connection cannot resolve to a usable base URL.

    A named custom (OpenAI-compatible or gateway) connection routes through an explicit
    endpoint. A missing or egress-blocked base URL is a config problem, not a server fault, so
    it fails loud with a client-error status rather than degrading to a provider default.
    """

    # The invoke remap reads `status_code` off the exception; without it this fell through to 500.
    status_code = 422


class MissingCredentialError(ConnectionResolutionError):
    """Raised when an Agenta-managed connection has no usable credential."""

    # The invoke remap reads `status_code` off the exception; without it this fell through to 500.
    status_code = 422

    def __init__(self, *, provider: str, slug: Optional[str] = None) -> None:
        subject = (
            f"connection '{slug}'" if slug else f"provider '{provider}' connection"
        )
        super().__init__(
            f"{subject} has no usable credential; configure a credential or select "
            "self_managed authentication"
        )
        self.provider = provider
        self.slug = slug


class WriteOnlySecretError(ConnectionResolutionError):
    """Raised when the chosen connection's key exists but came back redacted.

    The vault holds a write-only secret for this connection: the platform runtime reads it
    through a granted credential, but this caller's credential (typically an ApiKey in a
    standalone run) only receives the redacted shape. The resolver falls back to the
    provider's standard environment variable first; this is raised only when that key is
    absent too, because passing the redacted (empty) key to a provider would fail with a
    misleading auth error.
    """

    # A standalone run against a write-only secret is a config situation, not a server fault.
    status_code = 422

    def __init__(self, *, slug: Optional[str] = None, provider: str = "") -> None:
        subject = (
            f"connection '{slug}'" if slug else f"provider '{provider}' connection"
        )
        # The remediation the resolver itself already tried: it reads the provider's
        # standard environment variable before raising, so this error means that key is
        # missing too. Naming it keeps the instruction actionable and true.
        super().__init__(
            f"{subject} uses a write-only secret: Agenta stores the value but never "
            "returns it, so only runs on the Agenta platform can use it. To run "
            "outside the platform, provide the provider key in this run's environment "
            "(for example OPENAI_API_KEY)."
        )
        self.slug = slug
        self.provider = provider


class InvalidConnectionConfigurationError(AgentConnectionError):
    """Raised when resolved routing and credentials form an unsafe combination."""

    # The invoke remap reads `status_code` off the exception; without it this fell through to 500.
    status_code = 422


class ConnectionNotFoundError(ConnectionResolutionError):
    """Raised when a named connection (``mode == agenta`` + ``slug``) does not exist."""

    # A config naming a connection the project does not hold is a client error, not a server fault.
    status_code = 422

    def __init__(self, *, slug: str, provider: Optional[str] = None) -> None:
        suffix = f" for provider '{provider}'" if provider else ""
        super().__init__(f"connection '{slug}' not found{suffix}")
        self.slug = slug
        self.provider = provider


class MissingProviderError(ConnectionResolutionError):
    """Raised when a bare model id has no provider and none can be inferred from the vault.

    A bare ``model`` string with no ``provider/`` prefix (``provider is None``) can only resolve
    a credential if some vault connection matches it by model id. When nothing matches, there is
    no provider to look a credential up against, so this fails loud with an actionable message
    instead of degrading to no-credential and surfacing later as a misleading "add your key"
    auth error (the key may already be in the vault). Unlike a missing provider *key*, this is
    NOT a tolerated self-managed/OAuth fallback case: the config itself is underspecified.
    """

    # An underspecified model id is a client error, not a server fault.
    status_code = 422

    def __init__(self, *, model: str, hint_provider: str = "openai") -> None:
        # The example provider in the hint is harness-appropriate: a Claude harness must read
        # "anthropic/<model>", never "openai/<model>" (Claude reaches Anthropic only). The
        # caller passes the harness's default provider so the suggested prefix is reachable.
        super().__init__(
            f"model '{model}' needs a provider prefix (e.g. '{hint_provider}/{model}') "
            "or a structured {provider, model}; a bare model id can't resolve a credential"
        )
        self.model = model
        self.hint_provider = hint_provider


class AmbiguousConnectionError(ConnectionResolutionError):
    """Raised when more than one connection matches and resolution cannot pick one."""

    # A config that resolves to several connections is a client error, not a server fault. Without
    # this the ambiguous case surfaced as a 500 while every other resolution failure read 422.
    status_code = 422

    def __init__(
        self,
        *,
        provider: str,
        slug: Optional[str] = None,
        candidates: Optional[list[str]] = None,
    ) -> None:
        if slug:
            message = (
                f"ambiguous connection '{slug}' for provider '{provider}'; "
                "connection names must be unique to resolve"
            )
        else:
            # Name the candidates: "name one in the config" is only actionable if the user can see
            # which names to choose from. Slugs are identifiers, never credential material.
            choices = f" ({', '.join(sorted(candidates))})" if candidates else ""
            message = (
                f"multiple connections for provider '{provider}'{choices}; "
                "name one in the config"
            )
        super().__init__(message)
        self.provider = provider
        self.slug = slug
        self.candidates = list(candidates or [])


class ProviderMismatchError(ConnectionResolutionError):
    """Raised when a resolved connection's provider does not match the model's provider."""

    def __init__(self, *, expected: str, actual: str) -> None:
        super().__init__(
            f"connection provider '{actual}' does not match model provider '{expected}'"
        )
        self.expected = expected
        self.actual = actual


class UnsupportedProviderError(ConnectionResolutionError):
    """Raised when the requested provider cannot be reached by the selected harness."""

    # The invoke remap reads `status_code` off the exception; without it this fell through to 500.
    status_code = 422

    def __init__(self, *, provider: str, harness: Optional[str] = None) -> None:
        suffix = f" by harness '{harness}'" if harness else ""
        super().__init__(f"provider '{provider}' is not supported{suffix}")
        self.provider = provider
        self.harness = harness


class UnsupportedConnectionModeError(ConnectionResolutionError):
    """Raised when the requested connection mode cannot be used by the selected harness."""

    # An unusable mode comes from the config, not from the server.
    status_code = 422

    def __init__(self, *, mode: str, harness: Optional[str] = None) -> None:
        suffix = f" by harness '{harness}'" if harness else ""
        super().__init__(f"connection mode '{mode}' is not supported{suffix}")
        self.mode = mode
        self.harness = harness


class UnsupportedDeploymentError(ConnectionResolutionError):
    """Raised when the resolved deployment cannot be consumed by the selected harness in v1.

    Cloud deployments (bedrock/vertex/azure) are declared in the capability surface but their
    consumption is not wired in v1 (Pi staged with model-config; Claude bedrock/vertex not wired).
    A slug-less ``agenta`` connection only reveals its deployment once the vault selects the
    secret, so this is the POST-resolve half of the agent-layer capability check (Concern 3b): a
    run resolving to an unconsumable deployment fails loud rather than running mis-credentialed.
    """

    # The invoke remap reads `status_code` off the exception; without it this fell through to 500.
    status_code = 422

    def __init__(self, *, deployment: str, harness: Optional[str] = None) -> None:
        suffix = f" by harness '{harness}'" if harness else ""
        super().__init__(
            f"deployment '{deployment}' is not supported{suffix} in v1; "
            "use a direct or OpenAI-compatible custom connection"
        )
        self.deployment = deployment
        self.harness = harness

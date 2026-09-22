"""Errors raised while resolving an agent connection.

The resolution rules (in the design's Concern 3) are deterministic and fail-loud: a missing
slug, an ambiguous match, a provider mismatch, or an unsupported provider/mode each raise a
specific subclass rather than silently picking a credential by iteration order. Slice 1
defines the full set so the module is complete; the service-backed resolver (Slice 2) raises
them.
"""

from __future__ import annotations

from typing import Any, Optional


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


class SubscriptionConnectionMissingError(ConnectionResolutionError):
    """Raised when the config names a subscription connection the project does not hold.

    A typo, or a ``self_managed`` slug that names a provider-key secret instead. Nothing is
    wrong with any sign-in, so this must NOT reach the browser as
    :class:`SubscriptionLoginRequiredError` did: telling a user to sign in again answers a
    question they did not ask, and signing in cannot fix the name in the config.
    """

    # A config naming a connection the project does not hold is a client error.
    status_code = 422
    failure_code = "subscription_connection_missing"

    def __init__(self, *, slug: str) -> None:
        # The message names ChatGPT because `chatgpt` is the only subscription provider today.
        super().__init__(
            f"No ChatGPT connection named '{slug}'. Check the agent's model connection."
        )
        self.slug = slug


class SubscriptionLoginRequiredError(ConnectionResolutionError):
    """Raised when a hosted subscription connection has no login a run can use.

    Two cases, one answer: the row's ``login_state`` is not ``ready``, or it holds no login.
    Both mean the same thing to the person running the agent, so they share one message and
    one code. A connection that does not exist at all is
    :class:`SubscriptionConnectionMissingError`: no sign-in would fix it.

    ``failure_code`` is the stable slug a client keys its "Sign in again" affordance on. The
    runner emits the same slug when a live turn's login is rejected, so the client handles one
    code for both halves of the feature.
    """

    # A connection with no usable login is a configuration situation, not a server fault.
    status_code = 422
    failure_code = "subscription_login_required"

    # The message names ChatGPT because `chatgpt` is the only subscription provider today.
    # Add a per-provider name here when a second provider lands.
    MESSAGE = "The ChatGPT sign-in is not ready. Sign in from AI providers."

    def __init__(self, *, slug: str, provider: str = "") -> None:
        # Never name the login, the token, or the file path: this string reaches the browser.
        super().__init__(self.MESSAGE)
        self.slug = slug
        self.provider = provider


class SubscriptionNotSupportedError(ConnectionResolutionError):
    """Raised when a hosted subscription login cannot be delivered to this run.

    Only the ChatGPT subscription on the Pi harness is supported. Codex refuses a login
    file without an ``id_token``, which the ChatGPT device login never issues, so the same
    credential cannot be handed to it. Failing here beats starting a run that authenticates
    with nothing and reports a provider auth error the person cannot act on.
    """

    # An unsupported pair comes from the config, not from the server.
    status_code = 422
    failure_code = "subscription_not_supported"

    def __init__(self, *, harness: Optional[str] = None, provider: str = "") -> None:
        super().__init__(
            "A hosted subscription runs a ChatGPT connection on the Pi harness only. "
            f"This run asked for provider '{provider or 'unknown'}' on harness "
            f"'{harness or 'none'}'."
        )
        self.harness = harness
        self.provider = provider


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


class GatewayInsecureEndpointError(ConnectionResolutionError):
    """Raised when gateway credentials would cross plain http to a routable host.

    D37's rule, unchanged: a bearer credential travels over https, or over a loopback hop
    that has no remote to leak it to. What this class adds is the ANSWER to the operator who
    hits it. The refusal used to surface as a pydantic ``ValidationError`` escaping the
    connection model, which the running normalizer could only report as an unhandled 500 with
    a traceback, so a self-hosted deployment served over plain http at an IP saw a server
    fault where it should have seen its own configuration and the one flag that changes it.

    ``next_step`` names that flag (``AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED``), and
    ``error_detail`` carries the agent-actionable envelope
    (``{code, message, retryable, next_step, details}``) the runner recovers for a gateway
    data-plane refusal, so a caller reads one shape whichever side refused.
    """

    # A deployment whose own base URL cannot carry a bearer is a configuration situation.
    status_code = 422
    failure_code = "gateway_insecure_endpoint"

    MESSAGE = (
        "Gateway credentials require an effective HTTPS endpoint. This deployment's gateway "
        "base URL is plain http to a host that is not loopback, so a bearer credential would "
        "cross the network in clear text."
    )
    NEXT_STEP = (
        "Serve the deployment over HTTPS, or set "
        "AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED=true if it is a trusted single-tenant "
        "deployment on a network you control."
    )

    def __init__(self, *, base_url: Optional[str] = None) -> None:
        super().__init__(self.MESSAGE)
        self.base_url = base_url
        # Non-secret: this is the deployment's own gateway address, never a credential. It is
        # the one fact the operator needs to recognize which URL the refusal is about.
        details = {"flag": "AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED"}
        if base_url:
            details["base_url"] = base_url
        self.error_detail = {
            "code": self.failure_code,
            "message": self.MESSAGE,
            # Nothing about repeating the same request changes the deployment's scheme.
            "retryable": False,
            "next_step": self.NEXT_STEP,
            "details": details,
        }


class GatewayConnectionRefusedError(ConnectionResolutionError):
    """Raised when the gateway control plane refuses to resolve a connection.

    ``POST /gateways/llms/resolve`` answers a refusal with the shared envelope
    (``{code, message, retryable, next_step, details}``), the same shape the data plane
    produces and :class:`GatewayInsecureEndpointError` carries. This class exists so that
    envelope survives the HTTP hop: the resolver used to read only ``response.status_code``
    and raise a bare :class:`ConnectionResolutionError`, so an endpoint that simply did not
    exist reached the person running the agent as an unknown-invoke-error 500 with no code and
    no message they could act on.

    ``failure_code`` becomes the gateway's own ``code`` (``endpoint_not_found``,
    ``endpoint_inactive``, and so on) whenever the envelope names one, so a client branches on
    the real cause rather than on this class.
    """

    # A refusal from our own control plane is a configuration situation, not a server fault.
    # A control plane that actually failed keeps 5xx, because that one IS a server fault.
    status_code = 422
    failure_code = "gateway_connection_refused"

    def __init__(
        self,
        message: str,
        *,
        status_code: Optional[int] = None,
        gateway_status: Optional[int] = None,
        failure_code: Optional[str] = None,
        error_detail: Optional[dict] = None,
    ) -> None:
        super().__init__(message)
        if status_code is not None:
            self.status_code = status_code
        if failure_code:
            self.failure_code = failure_code
        self.gateway_status = gateway_status
        self.error_detail = error_detail

    @classmethod
    def from_response(
        cls,
        *,
        status_code: int,
        body: Any = None,
    ) -> "GatewayConnectionRefusedError":
        """Build the refusal from the response the gateway actually sent.

        Tolerant by construction, because every one of these shapes is reachable: the shared
        envelope under ``detail``, a bare string ``detail`` (a route that has not adopted the
        envelope), FastAPI's validation-error list, the generic
        ``{"message": ..., "operation_id": ...}`` an intercepted server fault sends, and a body
        that is not JSON at all. A shape that names no code still yields this class's own
        ``failure_code`` and the best message available, which is strictly more than the status
        number the caller used to get.
        """
        detail = body.get("detail") if isinstance(body, dict) else None

        code = None
        message = None
        retryable = False
        next_step = None
        details = None
        if isinstance(detail, dict):
            code = _stripped_str(detail.get("code"))
            message = _stripped_str(detail.get("message"))
            retryable = bool(detail.get("retryable", False))
            next_step = _stripped_str(detail.get("next_step"))
            raw_details = detail.get("details")
            details = raw_details if isinstance(raw_details, dict) else None
        elif isinstance(detail, str):
            message = _stripped_str(detail)

        if not message:
            message = f"connection resolution failed (HTTP {status_code})"

        error_detail = {
            "code": code or cls.failure_code,
            "message": message,
            "retryable": retryable,
        }
        if next_step:
            error_detail["next_step"] = next_step
        if details:
            error_detail["details"] = details

        return cls(
            message,
            # A 5xx means the control plane itself failed; anything else is the deployment's
            # own configuration answering, which every other resolution failure reports as 422.
            status_code=502 if status_code >= 500 else 422,
            gateway_status=status_code,
            failure_code=code,
            error_detail=error_detail,
        )


def _stripped_str(value: Any) -> Optional[str]:
    """``value`` as a non-empty stripped string, or ``None``."""
    return value.strip() if isinstance(value, str) and value.strip() else None


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

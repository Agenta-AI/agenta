import asyncio
import random
from typing import Protocol, Any, Optional, Iterable
from os import environ
from urllib.parse import urlparse

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.lazy import _load_litellm

from agenta.sdk.litellm.mocks import MOCKS
from agenta.sdk.contexts.routing import RoutingContext

AGENTA_LITELLM_MOCK = environ.get("AGENTA_LITELLM_MOCK") or None

log = get_module_logger(__name__)


# LiteLLM providers that sign their calls with AWS credentials.
AWS_PROVIDERS = frozenset(
    {"bedrock", "bedrock_mantle", "sagemaker", "sagemaker_chat", "sagemaker_nova"}
)

# The litellm argument for each AWS credential, then the other spellings a stored
# connection may use for it. The credentials travel with the call, never through
# `os.environ`, which every concurrent request in the process shares.
_AWS_CREDENTIAL_SPELLINGS = {
    "aws_access_key_id": ("AWS_ACCESS_KEY_ID",),
    "aws_secret_access_key": ("AWS_SECRET_ACCESS_KEY",),
    "aws_session_token": ("AWS_SESSION_TOKEN",),
    "aws_region_name": (
        "AWS_REGION",
        "AWS_DEFAULT_REGION",
        "aws_region",
        "aws_default_region",
    ),
}


def _aws_provider(
    *, args: tuple[Any, ...], kwargs: dict[str, Any], litellm: Any = None
) -> Optional[str]:
    model = _get_model_from_call(args=args, kwargs=kwargs) or ""
    custom_llm_provider = kwargs.get("custom_llm_provider")

    provider = None
    # litellm also routes bare Bedrock ids (`anthropic.claude-...`, `us.anthropic...`).
    get_llm_provider = getattr(litellm, "get_llm_provider", None)
    if callable(get_llm_provider):
        try:
            provider = get_llm_provider(
                model=model, custom_llm_provider=custom_llm_provider
            )[1]
        except Exception:  # pylint: disable=broad-exception-caught
            provider = None

    if not isinstance(provider, str) or not provider:
        provider = custom_llm_provider
    if not isinstance(provider, str) or not provider:
        provider = model.split("/", 1)[0]

    provider = provider.lower()
    return provider if provider in AWS_PROVIDERS else None


def _has_value(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _signs_with_own_aws_credentials(provider: str, kwargs: dict[str, Any]) -> bool:
    """Whether the AWS identity litellm picks for this call comes from the call alone.

    Follows litellm's order: a web identity, then a role, then a profile, then a key pair.
    A role is assumed with the call's key pair or else with the host's credentials, and a
    profile is read from the host, so neither counts on its own.
    """
    has_key_pair = _has_value(kwargs.get("aws_access_key_id")) and _has_value(
        kwargs.get("aws_secret_access_key")
    )
    if all(
        _has_value(kwargs.get(name))
        for name in ("aws_web_identity_token", "aws_role_name", "aws_session_name")
    ):
        return True
    if kwargs.get("aws_role_name") is not None:
        return has_key_pair
    if kwargs.get("aws_profile_name") is not None:
        return False
    if has_key_pair:
        return True

    # A Bedrock API key replaces signing altogether. SageMaker always signs.
    return provider in {"bedrock", "bedrock_mantle"} and _has_value(
        kwargs.get("api_key")
    )


def prepare_aws_call_kwargs(
    *, args: tuple[Any, ...], kwargs: dict[str, Any], litellm: Any = None
) -> dict[str, Any]:
    """Return the call's arguments with its AWS credentials as litellm arguments.

    A call whose AWS identity does not come from its own arguments signs with whatever
    the host provides (environment, profile, role, instance metadata). That is allowed
    only where the host's provider credentials may serve requests, as in a self-hosted
    deployment.
    """
    provider = _aws_provider(args=args, kwargs=kwargs, litellm=litellm)
    if provider is None:
        return kwargs

    kwargs = dict(kwargs)
    for name, spellings in _AWS_CREDENTIAL_SPELLINGS.items():
        values = [kwargs.pop(spelling, None) for spelling in spellings]
        if kwargs.get(name) is None:
            kwargs[name] = next((value for value in values if value), None)
        if kwargs[name] is None:
            kwargs.pop(name)

    # litellm fills a missing session token from `AWS_SESSION_TOKEN`. A key pair the call
    # carries must not sign with a token the host set for its own identity.
    if (
        _has_value(kwargs.get("aws_access_key_id"))
        and _has_value(kwargs.get("aws_secret_access_key"))
        and "aws_session_token" not in kwargs
    ):
        kwargs["aws_session_token"] = ""

    if not _signs_with_own_aws_credentials(provider, kwargs):
        from agenta.sdk.middlewares.running.vault import env_provider_keys_enabled

        if not env_provider_keys_enabled():
            from agenta.sdk.engines.running.errors import InvalidSecretsV0Error

            raise InvalidSecretsV0Error(
                expected="the connection's own AWS credentials",
                got=None,
                model=_get_model_from_call(args=args, kwargs=kwargs),
            )

    return kwargs


class LitellmProtocol(Protocol):
    async def acompletion(self, *args: Any, **kwargs: Any) -> Any: ...


def _iter_exception_chain(exc: BaseException) -> Iterable[BaseException]:
    """Iterate an exception + cause/context chain without cycles."""

    seen: set[int] = set()
    cur: Optional[BaseException] = exc
    while cur is not None and id(cur) not in seen:
        yield cur
        seen.add(id(cur))
        cur = cur.__cause__ or cur.__context__


def _has_closed_http_client_error(exc: BaseException) -> bool:
    # httpx raises: "RuntimeError: Cannot send a request, as the client has been closed."
    markers = (
        "Cannot send a request, as the client has been closed",
        "Cannot send request, as the client has been closed",
        "client has been closed",
    )

    for e in _iter_exception_chain(exc):
        msg = str(e)
        if any(marker in msg for marker in markers):
            return True

    return False


def _get_model_from_call(
    *, args: tuple[Any, ...], kwargs: dict[str, Any]
) -> Optional[str]:
    model = kwargs.get("model")
    if isinstance(model, str):
        return model

    if args and isinstance(args[0], str):
        return args[0]

    return None


def _is_azure_call(*, args: tuple[Any, ...], kwargs: dict[str, Any]) -> bool:
    model = _get_model_from_call(args=args, kwargs=kwargs)
    if model and model.lower().startswith("azure/"):
        return True

    # Some Azure configs might be sent as openai-compatible with an Azure base URL.
    for k in ("api_base", "base_url", "azure_endpoint"):
        v = kwargs.get(k)
        if isinstance(v, str):
            parsed = urlparse(v)
            host = parsed.hostname
            if host:
                host = host.lower()
                if host == "openai.azure.com" or host.endswith(".openai.azure.com"):
                    return True

    return False


def _has_api_connection_error(exc: BaseException, *, litellm: Any) -> bool:
    """True when a (LiteLLM/OpenAI) APIConnectionError is in the chain.

    Azure sometimes loses the original RuntimeError in the exception chain,
    so we also allow retrying on the mapped APIConnectionError for Azure calls.
    """

    litellm_exceptions = getattr(litellm, "exceptions", None)
    litellm_api_conn_error = getattr(litellm_exceptions, "APIConnectionError", None)

    for e in _iter_exception_chain(exc):
        if litellm_api_conn_error is not None and isinstance(e, litellm_api_conn_error):
            return True

        # Avoid importing openai just for type checks.
        if (
            e.__class__.__name__ == "APIConnectionError"
            and e.__class__.__module__.startswith("openai")
        ):
            return True

        # Fallback: LiteLLM sometimes wraps without preserving causes.
        msg = str(e)
        if "APIConnectionError" in msg and "Connection error" in msg:
            return True

    return False


def _should_retry_litellm_call(
    *,
    attempt: int,
    max_retries: int,
    exc: BaseException,
    litellm: Any,
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
) -> tuple[bool, Optional[str]]:
    """Centralized retry policy for litellm calls.

    Returns:
        (should_retry, reason)
    """

    if attempt >= max_retries - 1:
        return False, None

    is_azure = _is_azure_call(args=args, kwargs=kwargs)
    if _has_closed_http_client_error(exc):
        return True, "closed_http_client"

    if is_azure and _has_api_connection_error(exc, litellm=litellm):
        return True, "azure_api_connection_error"

    return False, None


def _flush_litellm_client_cache(litellm: Any) -> None:
    cache = getattr(litellm, "in_memory_llm_clients_cache", None)
    if cache is None:
        return
    flush = getattr(cache, "flush_cache", None)
    if callable(flush):
        flush()


async def acompletion(*args, **kwargs):
    mock = AGENTA_LITELLM_MOCK or RoutingContext.get().mock

    if mock:
        # log.debug("Mocking litellm: %s.", mock)

        if mock not in MOCKS:
            mock = "hello"

        return MOCKS[mock](*args, **kwargs)

    litellm = _load_litellm(injected=globals().get("litellm"))
    if not litellm:
        raise ValueError("litellm not found")

    kwargs = prepare_aws_call_kwargs(args=args, kwargs=kwargs, litellm=litellm)

    # Retry logic for litellm's httpx client caching.
    #
    # In production we sometimes see errors bubble up as "OpenAIException - Connection error",
    # while the root cause (in the exception chain) is actually:
    # "RuntimeError: Cannot send a request, as the client has been closed." (httpx)
    #
    # When this happens, flushing LiteLLM's cached clients and retrying once usually recovers.
    # See: https://github.com/BerriAI/litellm/issues/13034
    max_retries = 2
    for attempt in range(max_retries):
        try:
            return await litellm.acompletion(*args, **kwargs)
        except Exception as e:
            should_retry, reason = _should_retry_litellm_call(
                attempt=attempt,
                max_retries=max_retries,
                exc=e,
                litellm=litellm,
                args=args,
                kwargs=kwargs,
            )
            if not should_retry:
                raise

            log.warning(
                "LiteLLM request failed with a retriable error; flushing cache and retrying (attempt %d/%d, reason=%s)",
                attempt + 1,
                max_retries,
                reason,
            )
            _flush_litellm_client_cache(litellm)
            if reason == "azure_api_connection_error":
                # Small jitter helps avoid immediate re-failure on transient Azure network issues.
                await asyncio.sleep(random.uniform(0.09, 0.11))
            continue

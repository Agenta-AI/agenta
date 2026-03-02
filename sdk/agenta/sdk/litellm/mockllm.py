import asyncio
import random
from typing import Protocol, Any, Optional, Iterable
from os import environ
from contextlib import contextmanager
from urllib.parse import urlparse

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.lazy import _load_litellm

from agenta.sdk.litellm.mocks import MOCKS
from agenta.sdk.contexts.routing import RoutingContext

AGENTA_LITELLM_MOCK = environ.get("AGENTA_LITELLM_MOCK") or None

log = get_module_logger(__name__)


ENV_KEYS_TO_CLEAR = [
    # anything that could inject Lambda/ECS role creds
    "AWS_SESSION_TOKEN",
    "AWS_SECURITY_TOKEN",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_ROLE_ARN",
    "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    "AWS_ECS_CONTAINER_AUTHORIZATION_TOKEN",
    "AWS_PROFILE",
    "AWS_SHARED_CREDENTIALS_FILE",
    "AWS_CONFIG_FILE",
]

ENV_KEYS_FROM_USER = [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_REGION",
    "AWS_DEFAULT_REGION",
]


@contextmanager
def user_aws_credentials_from(ps: dict):
    old = {}
    try:
        # Save original state of ALL keys we'll modify
        for k in ENV_KEYS_TO_CLEAR + ENV_KEYS_FROM_USER:
            if k in environ:
                old[k] = environ[k]

        # Clear AWS role credentials
        for k in ENV_KEYS_TO_CLEAR:
            environ.pop(k, None)

        # Set user credentials
        for k in ENV_KEYS_FROM_USER:
            if ps.get(k.upper()) is None:
                environ.pop(k, None)
            else:
                environ[k] = ps[k.upper()]
        yield
    finally:
        # Restore all environment variables to original state
        for k in ENV_KEYS_TO_CLEAR + ENV_KEYS_FROM_USER:
            if k in old:
                environ[k] = old[k]
            else:
                environ.pop(k, None)


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

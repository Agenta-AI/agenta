from typing import Protocol, Any, Optional, Iterable
from os import environ
from contextlib import contextmanager

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
            should_retry = attempt < max_retries - 1 and _has_closed_http_client_error(
                e
            )
            if not should_retry:
                raise

            log.warning(
                "LiteLLM http client was closed; flushing cache and retrying (attempt %d/%d)",
                attempt + 1,
                max_retries,
            )
            _flush_litellm_client_cache(litellm)
            continue

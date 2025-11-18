from typing import Optional, Protocol, Any
from os import environ
from contextlib import contextmanager

from agenta.sdk.utils.logging import get_module_logger

from agenta.sdk.litellm.mocks import MOCKS
from agenta.sdk.context.serving import serving_context

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
    async def acompletion(self, *args: Any, **kwargs: Any) -> Any:
        ...


litellm: Optional[LitellmProtocol] = None  # pylint: disable=invalid-name


async def acompletion(*args, **kwargs):
    mock = AGENTA_LITELLM_MOCK or serving_context.get().mock

    if mock:
        log.debug("Mocking litellm: %s.", mock)

        if mock not in MOCKS:
            mock = "hello"

        return MOCKS[mock](*args, **kwargs)

    if not litellm:
        raise ValueError("litellm not found")

    return await litellm.acompletion(*args, **kwargs)

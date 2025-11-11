from typing import Optional, Protocol, Any
from os import environ

from agenta.sdk.utils.logging import get_module_logger

from agenta.sdk.litellm.mocks import MOCKS
from agenta.sdk.context.routing import routing_context

AGENTA_LITELLM_MOCK = environ.get("AGENTA_LITELLM_MOCK") or None

log = get_module_logger(__name__)


class LitellmProtocol(Protocol):
    async def acompletion(self, *args: Any, **kwargs: Any) -> Any: ...


litellm: Optional[LitellmProtocol] = None  # pylint: disable=invalid-name


async def acompletion(*args, **kwargs):
    mock = AGENTA_LITELLM_MOCK or routing_context.get().mock

    if mock:
        log.debug("Mocking litellm: %s.", mock)

        if mock not in MOCKS:
            mock = "hello"

        return MOCKS[mock](*args, **kwargs)

    if not litellm:
        raise ValueError("litellm not found")

    return await litellm.acompletion(*args, **kwargs)

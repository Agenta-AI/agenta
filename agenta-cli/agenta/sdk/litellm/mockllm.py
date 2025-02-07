from typing import Optional, Protocol, Any

from agenta.sdk.litellm.mocks import MOCKS
from agenta.sdk.context.routing import routing_context


class LitellmProtocol(Protocol):
    async def acompletion(self, *args: Any, **kwargs: Any) -> Any:
        ...


litellm: Optional[LitellmProtocol] = None  # pylint: disable=invalid-name


async def acompletion(*args, **kwargs):
    mock = routing_context.get().mock

    if mock:
        if mock not in MOCKS:
            raise ValueError(f"Mock {mock} not found")

        return MOCKS[mock](*args, **kwargs)

    if not litellm:
        raise ValueError("litellm not found")

    return await litellm.acompletion(*args, **kwargs)

from typing import Optional, Type, TypeVar, Dict, Any, Union

from pydantic import BaseModel

from agenta.sdk.decorators.routing import routing_context

T = TypeVar("T", bound=BaseModel)


class VaultManager:
    @staticmethod
    def get_from_route(
        schema: Optional[Type[T]] = None,
    ) -> Optional[Union[Dict[str, Any], T]]:
        context = routing_context.get()

        secrets = context.secrets

        if not secrets:
            return None

        if not schema:
            return secrets

        return schema(**secrets)

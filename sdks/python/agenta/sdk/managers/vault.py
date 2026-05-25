from typing import Optional, Dict, Any

from agenta.sdk.contexts.routing import RoutingContext


class VaultManager:
    @staticmethod
    def get_from_route() -> Optional[Dict[str, Any]]:
        context = RoutingContext.get()

        secrets = context.secrets

        if not secrets:
            return []

        return secrets

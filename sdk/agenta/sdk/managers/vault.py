from typing import Optional, Dict, Any

from agenta.sdk.context.routing import routing_context


class VaultManager:
    @staticmethod
    def get_from_route() -> Optional[Dict[str, Any]]:
        context = routing_context.get()

        secrets = context.secrets

        if not secrets:
            return None

        return secrets

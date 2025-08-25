from typing import Optional, Dict, Any

from agenta.sdk.context.serving import serving_context


class VaultManager:
    @staticmethod
    def get_from_route() -> Optional[Dict[str, Any]]:
        context = serving_context.get()

        secrets = context.secrets

        if not secrets:
            return None

        return secrets

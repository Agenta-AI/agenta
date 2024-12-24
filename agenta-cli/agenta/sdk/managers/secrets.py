from typing import Optional, Dict, Any

from agenta.sdk.context.routing import routing_context

from agenta.sdk.assets import model_to_provider_mapping


class SecretsManager:
    @staticmethod
    def get_from_route() -> Optional[Dict[str, Any]]:
        context = routing_context.get()

        secrets = context.secrets

        if not secrets:
            return None

        return secrets

    @staticmethod
    def get_api_key_for_model(model: str) -> str:
        secrets = SecretsManager.get_from_route()

        if not secrets:
            return None

        provider = model_to_provider_mapping.get(model)

        if not provider:
            return None

        provider = provider.lower().replace(" ", "")

        for secret in secrets:
            if secret["data"]["provider"] == provider:
                return secret["data"]["key"]

        return None

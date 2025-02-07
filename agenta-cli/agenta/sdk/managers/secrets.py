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

    @staticmethod
    def build_llm_request(model: str) -> Dict:
        """
        Builds the LLM request with appropriate kwargs based on the custom provider

        Args:
            model (str): The name of the model

        Returns:
            Dict: A dictionary containing all parameters needed for litellm.completion
        """

        # Check if model exists in mapping
        provider_to_use = model_to_provider_mapping.get(model)
        if not provider_to_use:
            return None

        provider_name = provider_to_use.lower().replace(" ", "")
        llm_request_kwargs = {}

        # Get secrets from route
        secrets = SecretsManager.get_from_route()
        if not secrets:
            return None

        for secret in secrets:
            if secret.get("kind") == "provider_key":
                secret_data = secret.get("data", {})
                provider_info = secret_data.get("provider", {})

                provider_slug = (
                    provider_info.get("slug", secret_data.get("kind", ""))
                    .lower()
                    .replace(" ", "")
                )  # converts the provider name from 'Open AI' to 'openai'

                provider_extras = provider_info.get("extras", {})

                if provider_slug == provider_name:
                    # Extract API key if present
                    # (for standard models -- openai/anthropic/gemini, etc)
                    if "key" in provider_info:
                        llm_request_kwargs["api_key"] = provider_info["key"]

                    # Extract credentials for custom providers
                    elif provider_extras:
                        llm_request_kwargs.update(provider_extras)
                break

        return llm_request_kwargs

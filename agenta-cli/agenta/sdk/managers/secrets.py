import re
from typing import Optional, Dict, Any, List

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
    def _transform_standard_secrets(
        secret: Dict[str, Any], standard_secrets: List[Dict[str, Any]]
    ):
        standard_secrets.append(
            {
                "kind": secret.get("secret", {}).get("kind", ""),
                "data": secret.get("secret", {}).get("data", {}),
            }
        )

    @staticmethod
    def _transform_custom_provider_secrets(
        secret: Dict[str, Any],
        custom_provider_secrets: List[Dict[str, Any]],
    ):
        data = secret.get("secret", {}).get("data", {})
        custom_provider_secrets.append(
            {
                "kind": secret.get("secret", {}).get("kind", ""),
                "data": {
                    "provider": {
                        "slug": data.get("kind", ""),
                        "extras": (
                            {
                                "api_key": data["provider"]["key"],
                                "api_base": data["provider"]["url"],
                                "api_version": data["provider"]["version"],
                            }
                            if all(
                                k in data.get("provider", {})
                                for k in ["key", "url", "version"]
                            )
                            else data.get("provider", {}).get("credentials", {})
                        ),
                    },
                    "models": [
                        model.get("slug", "") for model in data.get("models", [])
                    ],
                },
            }
        )

    @staticmethod
    def _transform_vault_secrets(secrets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        standard_secrets = []
        custom_provider_secrets = []

        for secret in secrets:
            data = secret.get("secret", {}).get("data", {})

            if data.get("kind") == "provider_key":
                SecretsManager._transform_standard_secrets(
                    secret=secret,
                    standard_secrets=standard_secrets,
                )
            elif data.get("kind") == "custom_provider":
                SecretsManager._transform_custom_provider_secrets(
                    secret=secret,
                    custom_provider_secrets=custom_provider_secrets,  # Fix argument name
                )

        vault_secrets = standard_secrets + custom_provider_secrets
        return vault_secrets

    @staticmethod
    def get_provider_model_settings(model: str) -> Dict:
        """
        Builds the LLM request with appropriate kwargs based on the custom provider/model

        Args:
            model (str): The name of the model

        Returns:
            Dict: A dictionary containing all parameters needed for litellm.completion
        """

        # STEP 1: get vault secrets from route context and transform it
        secrets = SecretsManager.get_from_route()
        if not secrets:
            return None

        vault_secrets = SecretsManager._transform_vault_secrets(secrets=secrets)

        # STEP 2: check model exists in supported standard models
        provider_to_use = model_to_provider_mapping.get(model)
        if not provider_to_use:
            # i). check and get provider kind if model exists in custom provider models
            def get_provider_name(*, model: str, secrets: list[dict]):
                for secret in secrets:
                    models = [
                        model.get("slug", "")
                        for model in secret.get("data", {}).get("models", [])
                    ]
                    if model in models:
                        return secret.get("data", {}).get("kind", None)
                return None

            provider_to_use = get_provider_name(model=model, secrets=vault_secrets)

        # STEP 2b: return None in the case provider_to_use is None
        if not provider_to_use:
            return None

        # STEP 3: initialize provider model settings and simplify provider name
        provider_model_settings = {}
        provider_name = re.sub(
            r"[\s_-]+", "", provider_to_use.lower()
        )  # normalizing other special characters too (azure-openai)

        # STEP 4: get credentials for model
        for secret in secrets:
            secret_data = secret.get("data", {})
            provider_info = secret_data.get("provider", {})

            # i). Extract API key if present
            # (for standard models -- openai/anthropic/gemini, etc)
            if secret.get("kind") == "provider_key":
                provider_slug = secret_data.get("kind", "")

                if provider_slug == provider_name:
                    if "key" in provider_info:
                        provider_model_settings["api_key"] = provider_info["key"]
                break

            # ii). Extract Credentials if present
            # (for custom providers -- aws bedrock/sagemaker, vertexai, etc)
            elif secret.get("kind") == "custom_provider":
                provider_slug = provider_info.get("slug", "").lower().replace(" ", "")
                provider_extras = provider_info.get("extras", {})
                if provider_slug == provider_name:
                    if provider_extras:
                        provider_model_settings.update(provider_extras)
                break

        return provider_model_settings

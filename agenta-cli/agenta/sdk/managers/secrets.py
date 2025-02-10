import re
from typing import Optional, Dict, Any, List

from agenta.sdk.context.routing import routing_context
from agenta.sdk.assets import model_to_provider_mapping as _standard_providers


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

        provider = _standard_providers.get(model)

        if not provider:
            return None

        provider = provider.lower().replace(" ", "")

        for secret in secrets:
            if secret["data"]["provider"] == provider:
                return secret["data"]["key"]

        return None

    @staticmethod
    def _parse_standard_secrets(
        secret: Dict[str, Any], standard_secrets: List[Dict[str, Any]]
    ):
        standard_secrets.append(
            {
                "kind": secret.get("secret", {}).get("kind", ""),
                "data": secret.get("secret", {}).get("data", {}),
            }
        )

    @staticmethod
    def _parse_custom_secrets(
        secret: Dict[str, Any],
        custom_secrets: List[Dict[str, Any]],
    ):
        data = secret.get("secret", {}).get("data", {})
        custom_secrets.append(
            {
                "kind": secret.get("secret", {}).get("kind", ""),
                "data": {
                    "provider": {
                        "kind": data.get("kind", ""),
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
                            else data.get("provider", {}).get("extras", {})
                        ),
                    },
                    "models": [
                        model.get("slug", "") for model in data.get("models", [])
                    ],
                },
            }
        )

    @staticmethod
    def _parse_secrets(secrets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        standard_secrets = []
        custom_secrets = []

        for secret in secrets:
            data = secret.get("secret", {}).get("data", {})

            if data.get("kind") == "provider_key":
                SecretsManager._parse_standard_secrets(
                    secret=secret,
                    standard_secrets=standard_secrets,
                )
            elif data.get("kind") == "custom_provider":
                SecretsManager._parse_custom_secrets(
                    secret=secret,
                    custom_secrets=custom_secrets,
                )

        secrets = standard_secrets + custom_secrets

        return secrets

    @staticmethod
    def _custom_providers_get(*, model: str, secrets: list[dict]):
        for secret in secrets:
            models = [
                model.get("slug", "")
                for model in secret.get("data", {}).get("models", [])
            ]
            if model in models:
                return secret.get("data", {}).get("kind", None)
        return None

    @staticmethod
    def get_provider_settings(model: str) -> Dict:
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

        secrets = SecretsManager._parse_secrets(secrets=secrets)

        # STEP 2: check model exists in supported standard models
        provider = _standard_providers.get(model)
        if not provider:
            # i). check and get provider kind if model exists in custom provider models
            provider = SecretsManager._custom_providers_get(
                model=model,
                secrets=secrets,
            )

        # STEP 2b: return None in the case provider is None
        if not provider:
            return None

        # STEP 3: initialize provider settings and simplify provider name
        provider_settings = {}
        provider_name = re.sub(
            r"[\s_-]+", "", provider.lower()
        )  # normalizing other special characters too (azure-openai)

        # STEP 4: get credentials for model
        for secret in secrets:
            secret_data = secret.get("data", {})
            provider_info = secret_data.get("provider", {})

            # i). Extract API key if present
            # (for standard models -- openai/anthropic/gemini, etc)
            if secret.get("kind") == "provider_key":
                provider_kind = secret_data.get("kind", "")

                if provider_kind == provider_name:
                    if "key" in provider_info:
                        provider_settings["api_key"] = provider_info["key"]
                break

            # ii). Extract Credentials if present
            # (for custom providers -- aws bedrock/sagemaker, vertexai, etc)
            elif secret.get("kind") == "custom_provider":
                provider_kind = provider_info.get("kind", "").lower().replace(" ", "")
                provider_extras = provider_info.get("extras", {})

                if provider_kind == provider_name:
                    if provider_extras:
                        provider_settings.update(provider_extras)
                break

        return provider_settings

import re
from typing import Optional, Dict, Any, List

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.contexts.routing import RoutingContext
from agenta.sdk.contexts.running import RunningContext
from agenta.sdk.assets import model_to_provider_mapping as _standard_providers

from agenta.sdk.middlewares.running.vault import get_secrets

import agenta as ag

log = get_module_logger(__name__)


class SecretsManager:
    @staticmethod
    def get_from_route() -> Optional[List[Dict[str, Any]]]:
        context = RoutingContext.get()

        secrets = context.secrets

        if not secrets:
            return []

        return secrets

    @staticmethod
    def _parse_standard_secrets(
        secret: Dict[str, Any], standard_secrets: List[Dict[str, Any]]
    ):
        standard_secrets.append(
            {
                "kind": secret.get("kind", ""),
                "data": secret.get("data", {}),
            }
        )

    @staticmethod
    def _parse_custom_secrets(
        secret: Dict[str, Any],
        custom_secrets: List[Dict[str, Any]],
    ):
        data = secret.get("data", {})
        custom_secrets.append(
            {
                "kind": secret.get("kind", ""),
                "data": {
                    "provider_slug": data.get("provider_slug"),
                    "provider": {
                        "kind": data.get("kind", ""),
                        "extras": (
                            {
                                **data["provider"]["extras"],
                                "api_base": data["provider"]["url"],
                                "api_version": data["provider"].get("version"),
                            }
                            if all(
                                k in data.get("provider", {}) for k in ["extras", "url"]
                            )
                            else data.get("provider", {}).get("extras", {})
                        ),
                    },
                    "models": data.get("model_keys", []),
                },
            }
        )

    @staticmethod
    def _parse_secrets(secrets: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        standard_secrets: List[dict] = []
        custom_secrets: List[dict] = []

        for secret in secrets:
            if secret.get("kind") == "provider_key":
                SecretsManager._parse_standard_secrets(
                    secret=secret,
                    standard_secrets=standard_secrets,
                )  # append secret to standard_secrets
            elif secret.get("kind") == "custom_provider":
                SecretsManager._parse_custom_secrets(
                    secret=secret,
                    custom_secrets=custom_secrets,
                )  # append secret to custom_secrets

        secrets = standard_secrets + custom_secrets

        return secrets

    @staticmethod
    def _custom_provider_get_value(
        *, model: str, secrets: list[dict], key: str, from_provider: bool = True
    ):
        for secret in secrets:
            models = secret.get("data", {}).get("models", [])
            if model in models:
                if from_provider:
                    return secret.get("data", {}).get("provider", {}).get(key)
                return secret.get("data", {}).get(key)
        return None

    @staticmethod
    def _custom_providers_get(*, model: str, secrets: list[dict]):
        return SecretsManager._custom_provider_get_value(
            model=model, secrets=secrets, key="kind", from_provider=True
        )

    @staticmethod
    def _custom_provider_slug_get(*, model: str, secrets: list[dict]):
        return SecretsManager._custom_provider_get_value(
            model=model, secrets=secrets, key="provider_slug", from_provider=False
        )

    @staticmethod
    def _get_compatible_model(*, model: str, provider_slug: str):
        """Return the model string used by litellm.

        Args:
            model (str): The complete model string (e.g. `mybedrock/bedrock/model_name`).
                         In the format provider_slug/kind/model_name (See SecretResponseDTO)
            provider_slug (str): The provider slug (e.g. `mybedrock`)

        Returns:
            str: The model string used by litellm
        """
        # First replace provider_slug/custom with openai.
        # The reason is that custom providers are in fact openai compatible providers
        # They need to be passed in litellm as openai/modelname

        modified_model = model

        if "custom" in modified_model:
            modified_model = modified_model.replace(
                f"{provider_slug}/custom/", "openai/"
            )

        if provider_slug:
            modified_model = modified_model.replace(f"{provider_slug}/", "")

        return modified_model

    @staticmethod
    def get_provider_settings(model: str) -> Optional[Dict]:
        """
        Builds the LLM request with appropriate kwargs based on the custom provider/model

        Args:
            model (str): The name of the model

        Returns:
            Dict: A dictionary containing all parameters needed for litellm.completion
        """

        request_provider_model = model

        # STEP 1: get vault secrets from route context and transform it
        secrets = SecretsManager.get_from_route()
        if not secrets:
            return None

        # STEP 1b: Parse secrets into usable format
        secrets = SecretsManager._parse_secrets(secrets=secrets)

        # STEP 2: check model exists in supported standard models
        provider = _standard_providers.get(request_provider_model)
        if not provider:
            # check and get provider kind if model exists in custom provider models
            provider = SecretsManager._custom_providers_get(
                model=request_provider_model,
                secrets=secrets,
            )

        # STEP 2b: return None in the case provider is None
        if not provider:
            return None

        # STEP 2c: get litellm compatible model
        request_provider_slug = (
            SecretsManager._custom_provider_slug_get(
                model=request_provider_model, secrets=secrets
            )
            or ""
        )
        compatible_provider_model = SecretsManager._get_compatible_model(
            model=request_provider_model, provider_slug=request_provider_slug
        )

        # STEP 3: initialize provider settings and simplify provider name
        provider_settings = dict(model=compatible_provider_model)
        request_provider_kind = re.sub(
            r"[\s-]+", "", provider.lower()
        )  # normalizing other special characters too (azure-openai)

        # STEP 4: get credentials for model
        for secret in secrets:
            secret_data = secret.get("data", {})
            provider_info = secret_data.get("provider", {})

            # i). Extract API key if present
            # (for standard models -- openai/anthropic/gemini, etc)
            if secret.get("kind") == "provider_key":
                secret_provider_kind = secret_data.get("kind", "")

                if request_provider_kind == secret_provider_kind:
                    if "key" in provider_info:
                        provider_settings["api_key"] = provider_info["key"]
                continue

            # ii). Extract Credentials if present
            # (for custom providers -- aws bedrock/sagemaker, vertex_ai, etc)
            elif secret.get("kind") == "custom_provider":
                secret_provider_kind = (
                    provider_info.get("kind", "").lower().replace(" ", "")
                )
                secret_provider_slug = secret_data.get("provider_slug", "")
                secret_provider_models = secret_data.get("models", "")
                secret_provider_extras = provider_info.get("extras", {})

                if (
                    request_provider_kind == secret_provider_kind
                    and request_provider_slug == secret_provider_slug
                    and request_provider_model in secret_provider_models
                ):
                    if secret_provider_extras:
                        provider_settings.update(secret_provider_extras)
                continue

        if len(provider_settings.keys()) <= 1:
            return None

        return provider_settings

    @staticmethod
    async def retrieve_secrets():
        return await get_secrets(
            f"{ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host}/api",
            RunningContext.get().credentials,
        )

    @staticmethod
    async def ensure_secrets_in_workflow():
        ctx = RunningContext.get()

        ctx.secrets = await SecretsManager.retrieve_secrets()

        RunningContext.set(ctx)

        return ctx.secrets

    @staticmethod
    def get_provider_settings_from_workflow(model: str) -> Optional[Dict]:
        """
        Builds the LLM request with appropriate kwargs based on the custom provider/model

        Args:
            model (str): The name of the model

        Returns:
            Dict: A dictionary containing all parameters needed for litellm.completion
        """

        request_provider_model = model

        # STEP 1: get vault secrets from route context and transform it
        secrets = RunningContext.get().secrets
        if not secrets:
            return None

        # STEP 1b: Parse secrets into usable format
        secrets = SecretsManager._parse_secrets(secrets=secrets)

        # STEP 2: check model exists in supported standard models
        provider = _standard_providers.get(request_provider_model)
        if not provider:
            # check and get provider kind if model exists in custom provider models
            provider = SecretsManager._custom_providers_get(
                model=request_provider_model,
                secrets=secrets,
            )

        # STEP 2b: return None in the case provider is None
        if not provider:
            return None

        # STEP 2c: get litellm compatible model
        request_provider_slug = (
            SecretsManager._custom_provider_slug_get(
                model=request_provider_model, secrets=secrets
            )
            or ""
        )
        compatible_provider_model = SecretsManager._get_compatible_model(
            model=request_provider_model, provider_slug=request_provider_slug
        )

        # STEP 3: initialize provider settings and simplify provider name
        provider_settings = dict(model=compatible_provider_model)
        request_provider_kind = re.sub(
            r"[\s-]+", "", provider.lower()
        )  # normalizing other special characters too (azure-openai)

        # STEP 4: get credentials for model
        for secret in secrets:
            secret_data = secret.get("data", {})
            provider_info = secret_data.get("provider", {})

            # i). Extract API key if present
            # (for standard models -- openai/anthropic/gemini, etc)
            if secret.get("kind") == "provider_key":
                secret_provider_kind = secret_data.get("kind", "")

                if request_provider_kind == secret_provider_kind:
                    if "key" in provider_info:
                        provider_settings["api_key"] = provider_info["key"]
                continue

            # ii). Extract Credentials if present
            # (for custom providers -- aws bedrock/sagemaker, vertex_ai, etc)
            elif secret.get("kind") == "custom_provider":
                secret_provider_kind = (
                    provider_info.get("kind", "").lower().replace(" ", "")
                )
                secret_provider_slug = secret_data.get("provider_slug", "")
                secret_provider_models = secret_data.get("models", "")
                secret_provider_extras = provider_info.get("extras", {})

                if (
                    request_provider_kind == secret_provider_kind
                    and request_provider_slug == secret_provider_slug
                    and request_provider_model in secret_provider_models
                ):
                    if secret_provider_extras:
                        provider_settings.update(secret_provider_extras)
                continue

        if len(provider_settings.keys()) <= 1:
            return None

        return provider_settings

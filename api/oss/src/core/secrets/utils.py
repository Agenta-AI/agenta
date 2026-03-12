import os
from uuid import UUID
from typing import Dict, Any

from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.core.secrets.services import VaultService
from oss.src.models.api.evaluation_model import LMProvidersEnum


_LEGACY_SYSTEM_ENV_NAMES = {
    LMProvidersEnum.mistral.value: ("MISTRALAI_API_KEY",),
}

_PROVIDER_ENV_ALIASES = {
    "mistralai": LMProvidersEnum.mistral.value,
}


def _get_system_env_secret(secret_name: str) -> str | None:
    for env_name in (secret_name, *_LEGACY_SYSTEM_ENV_NAMES.get(secret_name, ())):
        env_var = os.getenv(env_name)
        if env_var:
            return env_var

    return None


def _provider_slug_to_env_var(provider_slug: str) -> str:
    if not provider_slug:
        return ""

    canonical_provider = LMProvidersEnum.__members__.get(provider_slug.replace("_", ""))
    if canonical_provider:
        return canonical_provider.value

    return _PROVIDER_ENV_ALIASES.get(
        provider_slug, f"{provider_slug.upper()}_API_KEY"
    )


async def get_system_llm_providers_secrets() -> Dict[str, Any]:
    """
    Fetches LLM providers secrets from system environment variables.
    """

    secrets = {}
    for llm_provider in LMProvidersEnum:
        secret_name = llm_provider.value
        env_var = _get_system_env_secret(secret_name)
        if env_var:
            secrets[secret_name] = env_var

    return secrets


async def get_user_llm_providers_secrets(project_id: str) -> Dict[str, Any]:
    """
    Fetches LLM providers secrets from vault for .
    """

    # 1: retrieve secrets from vault
    vault_service = VaultService(SecretsDAO())
    secrets = await vault_service.list_secrets(project_id=UUID(project_id))
    if not secrets:
        return {}

    # 2: include only standard provider keys
    # value of secrets: [{data: {kind: ..., provider: {key: ...}}}]
    secrets = [
        secret.model_dump(include={"data"})
        for secret in secrets
        if secret.kind == "provider_key"
    ]

    # 3: convert secrets to readable format
    readable_secrets = {}
    for secret in secrets:
        kind = secret["data"].get("kind")
        provider_slug = kind.value if kind else ""
        secret_name = _provider_slug_to_env_var(provider_slug)
        if provider_slug:
            provider = secret["data"].get("provider")
            readable_secrets[secret_name] = provider.get("key") if provider else None
    return readable_secrets


async def get_llm_providers_secrets(project_id: str) -> Dict[str, Any]:
    """
    Fetches LLM providers secrets from system and vault.
    """

    system_llm_secrets = await get_system_llm_providers_secrets()
    user_llm_secrets = await get_user_llm_providers_secrets(project_id)
    return {**system_llm_secrets, **user_llm_secrets}

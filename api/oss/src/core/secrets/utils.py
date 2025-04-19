import os
from uuid import UUID
from typing import Dict, Any

from oss.src.dbs.secrets.dao import SecretsDAO
from oss.src.core.secrets.services import VaultService
from oss.src.models.api.evaluation_model import LMProvidersEnum


async def get_system_llm_providers_secrets() -> Dict[str, Any]:
    """
    Fetches LLM providers secrets from system environment variables.
    """

    secrets = {}
    for llm_provider in LMProvidersEnum:
        secret_name = llm_provider.value
        env_var = os.getenv(secret_name)
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

    # 2: exclude custom_provider secrets
    # value of secrets: [{data: {kind: ..., provider: {key: ...}}}]
    secrets = [
        secret.model_dump(include={"data"})
        for secret in secrets
        if secret.kind != "custom_provider"
    ]

    # 3: convert secrets to readable format
    readable_secrets = {}
    for secret in secrets:
        provider_slug = str(secret["data"].get("kind", ""))
        secret_name = f"{provider_slug.upper()}_API_KEY"
        if provider_slug:
            readable_secrets[secret_name] = secret["data"].get("key")
    return readable_secrets


async def get_llm_providers_secrets(provider_id: str) -> Dict[str, Any]:
    """
    Fetches LLM providers secrets from system and vault.
    """

    system_llm_secrets = await get_system_llm_providers_secrets()
    user_llm_secrets = await get_user_llm_providers_secrets(provider_id)
    return {**system_llm_secrets, **user_llm_secrets}

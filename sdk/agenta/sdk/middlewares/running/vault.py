from os import getenv
from json import dumps
from typing import Callable, Dict, Optional, List, Any

import httpx

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.constants import TRUTHY
from agenta.sdk.utils.cache import TTLLRUCache
from agenta.sdk.utils.exceptions import suppress, display_exception

from agenta.sdk.models.workflows import WorkflowServiceRequest
from agenta.sdk.contexts.running import RunningContext

from agenta.client.backend.types import SecretDto as SecretDTO
from agenta.client.backend.types import (
    StandardProviderKind,
    StandardProviderDto as StandardProviderDTO,
    StandardProviderSettingsDto as StandardProviderSettingsDTO,
)

import agenta as ag

log = get_module_logger(__name__)


_PROVIDER_KINDS = []

for provider_kind in StandardProviderKind.__args__[0].__args__:  # type: ignore
    _PROVIDER_KINDS.append(provider_kind)

_CACHE_ENABLED = (
    getenv("AGENTA_SERVICE_MIDDLEWARE_CACHE_ENABLED", "true").lower() in TRUTHY
)

_cache = TTLLRUCache()


async def get_secrets(api_url, credentials) -> tuple[list, list, list]:
    headers = None
    if credentials:
        headers = {"Authorization": credentials}

    _hash = dumps(
        {
            "headers": headers,
        },
        sort_keys=True,
    )

    if _CACHE_ENABLED:
        secrets_cache = _cache.get(_hash)

        if secrets_cache:
            secrets = secrets_cache.get("secrets")
            vault_secrets = secrets_cache.get("vault_secrets")
            local_secrets = secrets_cache.get("local_secrets")

            if vault_secrets is None or local_secrets is None:
                return secrets, [], []

            return secrets, vault_secrets, local_secrets

    local_secrets: List[Dict[str, Any]] = []

    try:
        for provider_kind in _PROVIDER_KINDS:
            provider = provider_kind
            key_name = f"{provider.upper()}_API_KEY"
            key = getenv(key_name)

            if not key:
                continue

            secret = SecretDTO(
                kind="provider_key",  # type: ignore
                data=StandardProviderDTO(
                    kind=provider,
                    provider=StandardProviderSettingsDTO(key=key),
                ),
            )

            local_secrets.append(secret.model_dump())
    except Exception:  # pylint: disable=bare-except
        display_exception("Vault: Local Secrets Exception")

    vault_secrets: List[Dict[str, Any]] = []

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{api_url}/vault/v1/secrets/",
                headers=headers,
            )

            if response.status_code != 200:
                vault_secrets = []

            else:
                vault_secrets = response.json()
    except Exception:  # pylint: disable=bare-except
        display_exception("Vault: Vault Secrets Exception")

    local_standard = {}
    vault_standard = {}
    vault_custom = []

    if local_secrets:
        for secret in local_secrets:
            local_standard[secret["data"]["kind"]] = secret  # type: ignore

    if vault_secrets:
        for secret in vault_secrets:
            if secret["kind"] == "provider_key":  # type: ignore
                vault_standard[secret["data"]["kind"]] = secret  # type: ignore
            elif secret["kind"] == "custom_provider":  # type: ignore
                vault_custom.append(secret)

    combined_standard = {**local_standard, **vault_standard}
    combined_vault = list(vault_standard.values()) + vault_custom
    secrets = list(combined_standard.values()) + vault_custom

    _cache.put(
        _hash,
        {
            "secrets": secrets,
            "vault_secrets": combined_vault,
            "local_secrets": local_secrets,
        },
    )

    return secrets, combined_vault, local_secrets


class VaultMiddleware:
    async def __call__(
        self,
        request: WorkflowServiceRequest,
        call_next: Callable[[WorkflowServiceRequest], Any],
    ):
        api_url = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_url

        with suppress():
            ctx = RunningContext.get()
            credentials = ctx.credentials

            secrets, vault_secrets, local_secrets = await get_secrets(
                api_url,
                credentials,
            )

            ctx.secrets = secrets
            ctx.vault_secrets = vault_secrets
            ctx.local_secrets = local_secrets

        return await call_next(request)

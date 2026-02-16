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


async def get_secrets(api_url, credentials) -> list:
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

            return secrets

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
    except:  # pylint: disable=bare-except
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
    except:  # pylint: disable=bare-except
        display_exception("Vault: Vault Secrets Exception")

    secrets = local_secrets + vault_secrets

    standard_secrets = {}
    custom_secrets = []

    if local_secrets:
        for secret in local_secrets:
            standard_secrets[secret["data"]["kind"]] = secret  # type: ignore

    if vault_secrets:
        for secret in vault_secrets:
            if secret["kind"] == "provider_key":  # type: ignore
                standard_secrets[secret["data"]["kind"]] = secret  # type: ignore
            elif secret["kind"] == "custom_provider":  # type: ignore
                custom_secrets.append(secret)

    standard_secrets = list(standard_secrets.values())

    secrets = standard_secrets + custom_secrets

    _cache.put(_hash, {"secrets": secrets})

    return secrets


class VaultMiddleware:
    async def __call__(
        self,
        request: WorkflowServiceRequest,
        call_next: Callable[[WorkflowServiceRequest], Any],
    ):
        api_url = f"{ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host}/api"

        with suppress():
            ctx = RunningContext.get()
            credentials = ctx.credentials

            secrets = await get_secrets(api_url, credentials)

            ctx.secrets = secrets

        return await call_next(request)

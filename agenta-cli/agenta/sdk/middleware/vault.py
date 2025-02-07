from os import getenv
from json import dumps
from typing import Callable, Dict, Optional, List, Any, get_args

import httpx
from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware

from agenta.sdk.utils.constants import TRUTHY
from agenta.client.backend.types.standard_provider_kind import StandardProviderKind
from agenta.client.backend.types.custom_provider_kind import CustomProviderKind
from agenta.sdk.utils.exceptions import suppress, display_exception
from agenta.client.backend.types.secret_dto import (
    SecretDto as SecretDTO,
    Data as ProviderKeyDTO,
)
from agenta.sdk.middleware.cache import TTLLRUCache, CACHE_CAPACITY, CACHE_TTL

import agenta as ag


_PROVIDER_KINDS = []
_CUSTOM_PROVIDER_KINDS = []

for arg in StandardProviderKind.__args__:  # type: ignore
    if hasattr(arg, "__args__"):
        _PROVIDER_KINDS.extend(arg.__args__)

for arg in CustomProviderKind.__args__:  # type: ignore
    if hasattr(arg, "__args__"):
        _CUSTOM_PROVIDER_KINDS.extend(arg.__args__)

_CACHE_ENABLED = getenv("AGENTA_MIDDLEWARE_CACHE_ENABLED", "false").lower() in TRUTHY

_cache = TTLLRUCache(capacity=CACHE_CAPACITY, ttl=CACHE_TTL)


class VaultMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

        self.host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host

    def _transform_vault_secrets(
        self, secrets: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        transformed = []

        for secret in secrets:
            secret_kind = secret["secret"].get("kind", None)
            data = secret["secret"].get("data", {})

            if data["kind"] in _CUSTOM_PROVIDER_KINDS:
                transformed.append(
                    {
                        "kind": secret_kind,
                        "data": {
                            "provider": {
                                "slug": data.get("kind", None),
                                "extras": (
                                    {
                                        "api_key": data["provider"]["key"],
                                        "api_base": data["provider"]["url"],
                                        "api_version": data["provider"]["version"],
                                    }
                                    if (
                                        "url" in data["provider"]
                                        and "version" in data["provider"]
                                        and "key" in data["provider"]
                                    )
                                    else (
                                        data["provider"]["credentials"]
                                        if "credentials" in data["provider"]
                                        else {}
                                    )
                                ),
                            },
                            "models": [
                                model["slug"] for model in data.get("models", [])
                            ],
                        },
                    }
                )
            else:
                transformed.append(
                    {
                        "kind": secret_kind,
                        "data": data,
                    }
                )

        return transformed

    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
    ):
        request.state.vault = {}

        with suppress():
            secrets = await self._get_secrets(request)

            request.state.vault = {"secrets": secrets}

        return await call_next(request)

    async def _get_secrets(self, request: Request) -> Optional[Dict]:
        credentials = request.state.auth.get("credentials")

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

        local_secrets: List[SecretDTO] = []

        try:
            for provider_kind in _PROVIDER_KINDS:
                provider = provider_kind
                key_name = f"{provider.upper()}_API_KEY"
                key = getenv(key_name)

                if not key:
                    continue

                secret = SecretDTO(
                    # kind=...  # defaults to 'provider_kind'
                    data=ProviderKeyDTO(
                        provider=provider,
                        key=key,
                    ),
                )

                local_secrets.append(secret.model_dump())
        except:  # pylint: disable=bare-except
            display_exception("Vault: Local Secrets Exception")

        vault_secrets: List[SecretDTO] = []

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.host}/api/vault/v1/secrets",
                    headers=headers,
                )

                if response.status_code != 200:
                    vault_secrets = []

                else:
                    secrets = response.json()
                    vault_secrets = self._transform_vault_secrets(secrets)
        except:  # pylint: disable=bare-except
            display_exception("Vault: Vault Secrets Exception")

        secrets = local_secrets + vault_secrets
        _cache.put(_hash, {"secrets": secrets})

        return secrets

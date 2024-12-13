from typing import Callable, Dict, Optional

from enum import Enum
from os import getenv
from json import dumps

from pydantic import BaseModel

import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import FastAPI, Request

from agenta.sdk.middleware.cache import TTLLRUCache, CACHE_CAPACITY, CACHE_TTL
from agenta.sdk.utils.constants import TRUTHY
from agenta.sdk.utils.exceptions import suppress, display_exception

import agenta as ag


# TODO: Move to backend client types
class SecretKind(str, Enum):
    PROVIDER_KEY = "provider_key"


# TODO: Move to backend client types
class ProviderKind(str, Enum):
    OPENAI = "openai"
    COHERE = "cohere"
    ANYSCALE = "anyscale"
    DEEPINFRA = "deepinfra"
    ALEPHALPHA = "alephalpha"
    GROQ = "groq"
    MISTRALAI = "mistralai"
    ANTHROPIC = "anthropic"
    PERPLEXITYAI = "perplexityai"
    TOGETHERAI = "togetherai"
    OPENROUTER = "openrouter"
    GEMINI = "gemini"


# TODO: Move to backend client types
class ProviderKeyDTO(BaseModel):
    provider: ProviderKind
    key: str


# TODO: Move to backend client types
class SecretDTO(BaseModel):
    kind: SecretKind = "provider_key"
    data: ProviderKeyDTO


_CACHE_ENABLED = getenv("AGENTA_MIDDLEWARE_CACHE_ENABLED", "true").lower() in TRUTHY

_cache = TTLLRUCache(capacity=CACHE_CAPACITY, ttl=CACHE_TTL)


class VaultMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

        self.host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host

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

        local_secrets = []

        try:
            for provider_kind in ProviderKind:
                provider = provider_kind.value
                key_name = f"{provider.upper()}_API_KEY"
                key = getenv(key_name)

                if not key:
                    continue

                secret = SecretDTO(
                    kind=SecretKind.PROVIDER_KEY,
                    data=ProviderKeyDTO(
                        provider=provider,
                        key=key,
                    ),
                )

                local_secrets.append(secret.model_dump())
        except:  # pylint: disable=bare-except
            display_exception("Vault: Local Secrets Exception")

        vault_secrets = []

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.host}/api/vault/v1/secrets",
                    headers=headers,
                )

                if response.status_code != 200:
                    vault_secrets = []

                else:
                    vault = response.json()

                    vault_secrets = vault.get("secrets")
        except:  # pylint: disable=bare-except
            display_exception("Vault: Vault Secrets Exception")

        merged_secrets = {}

        if local_secrets:
            for secret in local_secrets:
                provider = secret["data"]["provider"]
                merged_secrets[provider] = secret

        if vault_secrets:
            for secret in vault_secrets:
                provider = secret["data"]["provider"]
                merged_secrets[provider] = secret

        secrets = list(merged_secrets.values())

        _cache.put(_hash, {"secrets": secrets})

        return secrets

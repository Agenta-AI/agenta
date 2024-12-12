from typing import Callable, Dict, Optional

from os import getenv
from json import dumps

import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import FastAPI, Request

from agenta.sdk.middleware.cache import TTLLRUCache
from agenta.sdk.utils.exceptions import suppress
from agenta.sdk.utils.timing import atimeit

import agenta as ag

_TRUTHY = {"true", "1", "t", "y", "yes", "on", "enable", "enabled"}
_CACHE_ENABLED = getenv("AGENTA_MIDDLEWARE_CACHE_ENABLED", "true").lower() in _TRUTHY

_CACHE_CAPACITY = int(getenv("AGENTA_MIDDLEWARE_CACHE_CAPACITY", "512"))
_CACHE_TTL = int(getenv("AGENTA_MIDDLEWARE_CACHE_TTL", str(5 * 60)))  # 5 minutes

_cache = TTLLRUCache(capacity=_CACHE_CAPACITY, ttl=_CACHE_TTL)


class VaultMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

        self.host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host

    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
    ):
        request.state.vault = None

        with suppress():
            secrets = await self._get_secrets(request)

            request.state.vault = {"secrets": secrets}

        return await call_next(request)

    # @atimeit
    async def _get_secrets(self, request: Request) -> Optional[Dict]:
        headers = {"Authorization": request.state.auth.get("credentials")}

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

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.host}/api/vault/v1/secrets",
                headers=headers,
            )

            vault = response.json()

            secrets = vault.get("secrets")

            _cache.put(_hash, {"secrets": secrets})

            return secrets

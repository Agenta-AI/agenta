from typing import Callable, Dict

import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import FastAPI, Request

from agenta.sdk.utils.exceptions import suppress

import agenta as ag


class VaultMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

        self.host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host

    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
    ):
        print("--- agenta/sdk/middleware/vault.py ---")
        request.state.vault = None

        with suppress():
            headers = {
                "Authorization": request.state.auth.get("credentials"),
            }

            secrets = await self._get_secrets(
                headers=headers,
            )

            if secrets:
                request.state.vault = {
                    "secrets": secrets,
                }

        print(request.state.vault)

        return await call_next(request)

    async def _get_secrets(
        self,
        headers: Dict[str, str],
    ):
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.host}/api/vault/v1/secrets",
                    headers=headers,
                )

                vault = response.json()

                secrets = vault.get("secrets")

                return secrets
        except:  # pylint: disable=bare-except
            return None

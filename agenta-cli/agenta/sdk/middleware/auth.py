from typing import Callable, Optional
from uuid import UUID
from json import dumps
from traceback import format_exc

import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import FastAPI, Request, HTTPException

from agenta.sdk.utils.logging import log
from agenta.sdk.middleware.cache import TTLLRUCache


class Deny(HTTPException):
    def __init__(self) -> None:
        super().__init__(status_code=401, detail="Unauthorized")


cache = TTLLRUCache(capacity=512, ttl=15 * 60)  # 15 minutes


class AuthorizationMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app: FastAPI,
        host: str,
        resource_id: UUID,
        resource_type: str,
    ):
        super().__init__(app)

        self.host = host
        self.resource_id = resource_id
        self.resource_type = resource_type

    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
        project_id: Optional[UUID] = None,
    ):
        try:
            auth_header = (
                request.headers.get("Authorization")
                or request.headers.get("authorization")
                or None
            )

            headers = {"Authorization": auth_header} if auth_header else None

            cookies = {
                "sAccessToken": request.cookies.get("sAccessToken"),
            }

            params = {
                "action": "run_service",
                "resource_type": self.resource_type,
                "resource_id": self.resource_id,
            }

            if project_id:
                params["project_id"] = project_id

            hash = dumps(
                {
                    "headers": headers,
                    "cookies": cookies,
                    "params": params,
                },
                sort_keys=True,
            )

            cached_policy = cache.get(hash)

            if cached_policy:
                if cached_policy.get("effect") == "allow":
                    return await call_next(request)
                else:
                    raise Deny()

            # TODO: ADD TTL-LRU CACHE
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.host}/api/permissions/verify",
                    headers=headers,
                    cookies=cookies,
                    params=params,
                )

                if response.status_code != 200:
                    cache.put(hash, {"effect": "deny"})
                    raise Deny()

                auth_result = response.json()

                if auth_result.get("effect") != "allow":
                    cache.put(hash, {"effect": "deny"})
                    raise Deny()

            cache.put(hash, {"effect": "allow"})

            return await call_next(request)

        except Exception as exc:  # pylint: disable=bare-except
            log.error("-------------------------------------------------")
            log.error("Agenta SDK - handling middleware exception below:")
            log.error("-------------------------------------------------")
            log.error(format_exc().strip("\n"))
            log.error("-------------------------------------------------")

            raise Deny() from exc

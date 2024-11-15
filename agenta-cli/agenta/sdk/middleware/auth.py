from typing import Callable, Optional
from os import environ
from uuid import UUID
from json import dumps
from traceback import format_exc

import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import FastAPI, Request, Response

from agenta.sdk.utils.logging import log
from agenta.sdk.middleware.cache import TTLLRUCache

AGENTA_SDK_AUTH_CACHE_CAPACITY = environ.get(
    "AGENTA_SDK_AUTH_CACHE_CAPACITY",
    512,
)

AGENTA_SDK_AUTH_CACHE_TTL = environ.get(
    "AGENTA_SDK_AUTH_CACHE_TTL",
    15 * 60,  # 15 minutes
)

AGENTA_UNAUTHORIZED_EXECUTION_ALLOWED = str(
    environ.get("AGENTA_UNAUTHORIZED_EXECUTION_ALLOWED", False)
).lower() in ("true", "1", "t")


class Deny(Response):
    def __init__(self) -> None:
        super().__init__(status_code=401, content="Unauthorized")


cache = TTLLRUCache(
    capacity=AGENTA_SDK_AUTH_CACHE_CAPACITY,
    ttl=AGENTA_SDK_AUTH_CACHE_TTL,
)


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
        if AGENTA_UNAUTHORIZED_EXECUTION_ALLOWED:
            return await call_next(request)

        try:
            authorization = (
                request.headers.get("Authorization")
                or request.headers.get("authorization")
                or None
            )

            headers = {"Authorization": authorization} if authorization else None

            cookies = {"sAccessToken": request.cookies.get("sAccessToken")}

            params = {
                "action": "run_service",
                "resource_type": self.resource_type,
                "resource_id": self.resource_id,
            }

            if project_id:
                params["project_id"] = project_id

            _hash = dumps(
                {
                    "headers": headers,
                    "cookies": cookies,
                    "params": params,
                },
                sort_keys=True,
            )

            cached_policy = cache.get(_hash)

            if not cached_policy:
                async with httpx.AsyncClient() as client:
                    response = await client.get(
                        f"{self.host}/api/permissions/verify",
                        headers=headers,
                        cookies=cookies,
                        params=params,
                    )

                    if response.status_code != 200:
                        cache.put(_hash, {"effect": "deny"})
                        return Deny()

                    auth = response.json()

                    if auth.get("effect") != "allow":
                        cache.put(_hash, {"effect": "deny"})
                        return Deny()

                    cached_policy = {
                        "effect": "allow",
                        "credentials": auth.get("credentials"),
                    }

                    cache.put(_hash, cached_policy)

            if cached_policy.get("effect") == "deny":
                return Deny()

            request.state.credentials = cached_policy.get("credentials")

            print(f"credentials: {request.state.credentials}")

            return await call_next(request)

        except:  # pylint: disable=bare-except
            log.error("------------------------------------------------------")
            log.error("Agenta SDK - handling auth middleware exception below:")
            log.error("------------------------------------------------------")
            log.error(format_exc().strip("\n"))
            log.error("------------------------------------------------------")

            return Deny()

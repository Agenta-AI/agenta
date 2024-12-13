from typing import Callable, Dict, Optional

from os import getenv
from json import dumps

import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from agenta.sdk.middleware.cache import TTLLRUCache
from agenta.sdk.utils.exceptions import display_exception
from agenta.sdk.utils.timing import atimeit

import agenta as ag

_TRUTHY = {"true", "1", "t", "y", "yes", "on", "enable", "enabled"}
_ALLOW_UNAUTHORIZED = (
    getenv("AGENTA_UNAUTHORIZED_EXECUTION_ALLOWED", "false").lower() in _TRUTHY
)
_SHARED_SERVICE = getenv("AGENTA_SHARED_SERVICE", "true").lower() in _TRUTHY
_CACHE_ENABLED = getenv("AGENTA_MIDDLEWARE_CACHE_ENABLED", "true").lower() in _TRUTHY

_CACHE_CAPACITY = int(getenv("AGENTA_MIDDLEWARE_CACHE_CAPACITY", "512"))
_CACHE_TTL = int(getenv("AGENTA_MIDDLEWARE_CACHE_TTL", str(5 * 60)))  # 5 minutes

_cache = TTLLRUCache(capacity=_CACHE_CAPACITY, ttl=_CACHE_TTL)


class DenyResponse(JSONResponse):
    def __init__(
        self,
        status_code: int = 401,
        detail: str = "Unauthorized",
    ) -> None:
        super().__init__(
            status_code=status_code,
            content={"detail": detail},
        )


class DenyException(Exception):
    def __init__(
        self,
        status_code: int = 401,
        content: str = "Unauthorized",
    ) -> None:
        super().__init__()

        self.status_code = status_code
        self.content = content


class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

        self.host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host
        self.resource_id = (
            ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.service_id
            if not _SHARED_SERVICE
            else None
        )

    async def dispatch(self, request: Request, call_next: Callable):
        try:
            if _ALLOW_UNAUTHORIZED:
                request.state.auth = None

            else:
                credentials = await self._get_credentials(request)

                request.state.auth = {"credentials": credentials}

            return await call_next(request)

        except DenyException as deny:
            display_exception("Auth Middleware Exception")

            return DenyResponse(
                status_code=deny.status_code,
                detail=deny.content,
            )

        except:  # pylint: disable=bare-except
            display_exception("Auth Middleware Exception")

            return DenyResponse(
                status_code=500,
                detail="Internal Server Error: auth middleware.",
            )

    # @atimeit
    async def _get_credentials(self, request: Request) -> Optional[str]:
        try:
            authorization = request.headers.get("authorization", None)

            headers = {"Authorization": authorization} if authorization else None

            access_token = request.cookies.get("sAccessToken", None)

            cookies = {"sAccessToken": access_token} if access_token else None

            baggage = request.state.otel.get("baggage") if request.state.otel else {}

            project_id = (
                # CLEANEST
                baggage.get("project_id")
                # ALTERNATIVE
                or request.query_params.get("project_id")
            )

            params = {"action": "run_service", "resource_type": "service"}

            if self.resource_id:
                params["resource_id"] = self.resource_id

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

            if _CACHE_ENABLED:
                credentials = _cache.get(_hash)

                if credentials:
                    return credentials

            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.host}/api/permissions/verify",
                    headers=headers,
                    cookies=cookies,
                    params=params,
                )

                if response.status_code == 401:
                    raise DenyException(
                        status_code=401, content="Invalid 'authorization' header."
                    )
                elif response.status_code == 403:
                    raise DenyException(
                        status_code=403, content="Service execution not allowed."
                    )
                elif response.status_code != 200:
                    raise DenyException(
                        status_code=400,
                        content="Internal Server Error: auth middleware.",
                    )

                auth = response.json()

                if auth.get("effect") != "allow":
                    raise DenyException(
                        status_code=403, content="Service execution not allowed."
                    )

                credentials = auth.get("credentials")

                _cache.put(_hash, credentials)

                return credentials

        except DenyException as deny:
            raise deny

        except Exception as exc:  # pylint: disable=bare-except
            display_exception("Auth Middleware Exception (suppressed)")

            raise DenyException(
                status_code=500, content="Internal Server Error: auth middleware."
            ) from exc

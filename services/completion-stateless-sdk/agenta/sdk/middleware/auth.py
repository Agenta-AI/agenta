from typing import Callable, Optional

from os import getenv
from json import dumps

import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from agenta.sdk.middleware.cache import TTLLRUCache, CACHE_CAPACITY, CACHE_TTL
from agenta.sdk.utils.constants import TRUTHY
from agenta.sdk.utils.exceptions import display_exception

import agenta as ag


_SHARED_SERVICE = getenv("AGENTA_SHARED_SERVICE", "false").lower() in TRUTHY
_CACHE_ENABLED = getenv("AGENTA_MIDDLEWARE_CACHE_ENABLED", "true").lower() in TRUTHY
_UNAUTHORIZED_ALLOWED = (
    getenv("AGENTA_UNAUTHORIZED_EXECUTION_ALLOWED", "false").lower() in TRUTHY
)
_ALWAYS_ALLOW_LIST = ["/health"]

_cache = TTLLRUCache(capacity=CACHE_CAPACITY, ttl=CACHE_TTL)


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
            if _UNAUTHORIZED_ALLOWED or request.url.path in _ALWAYS_ALLOW_LIST:
                request.state.auth = {}

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
                detail="Auth: Unexpected Error.",
            )

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
                        status_code=401,
                        content="Invalid credentials",
                    )
                elif response.status_code == 403:
                    raise DenyException(
                        status_code=403,
                        content="Service execution not allowed.",
                    )
                elif response.status_code != 200:
                    raise DenyException(
                        status_code=400,
                        content="Auth: Unexpected Error.",
                    )

                auth = response.json()

                if auth.get("effect") != "allow":
                    raise DenyException(
                        status_code=403,
                        content="Service execution not allowed.",
                    )

                credentials = auth.get("credentials")

                _cache.put(_hash, credentials)

                return credentials

        except DenyException as deny:
            raise deny

        except Exception as exc:  # pylint: disable=bare-except
            display_exception("Auth Middleware Exception (suppressed)")

            raise DenyException(
                status_code=500,
                content="Auth: Unexpected Error.",
            ) from exc

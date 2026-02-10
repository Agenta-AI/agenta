from typing import Callable, Optional, Dict
from os import getenv
from json import dumps

import httpx

from starlette.types import ASGIApp
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import Request
from fastapi.responses import JSONResponse

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.utils.exceptions import display_exception
from agenta.sdk.utils.cache import TTLLRUCache
from agenta.sdk.utils.constants import TRUTHY

import agenta as ag


log = get_module_logger(__name__)

AGENTA_RUNTIME_PREFIX = getenv("AGENTA_RUNTIME_PREFIX", "")

_AUTH_ENABLED = (
    getenv("AGENTA_SERVICE_MIDDLEWARE_AUTH_ENABLED", "true").lower() in TRUTHY
)

_CACHE_ENABLED = (
    getenv("AGENTA_SERVICE_MIDDLEWARE_CACHE_ENABLED", "true").lower() in TRUTHY
)

_ALWAYS_ALLOW_LIST = [
    "/health",
    f"{AGENTA_RUNTIME_PREFIX}/health",
]

_cache = TTLLRUCache()


class DenyResponse(JSONResponse):
    def __init__(
        self,
        status_code: int = 401,
        detail: str = "Unauthorized",
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        super().__init__(
            status_code=status_code,
            content={"detail": detail},
            headers=headers,
        )


class DenyException(Exception):
    def __init__(
        self,
        status_code: int = 401,
        content: str = "Unauthorized",
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        super().__init__()

        self.status_code = status_code
        self.content = content
        self.headers = headers


async def get_credentials(
    request: Request,
    host: str,
    scope_type: Optional[str] = None,
    scope_id: Optional[str] = None,
) -> Optional[str]:
    """
    Shared credential verification logic.

    Args:
        request: The HTTP request
        host: The agenta host URL
        scope_type: Optional scope type for permission check
        scope_id: Optional scope ID for permission check

    Returns:
        The credentials string if verified, None otherwise

    Raises:
        DenyException: If authentication/authorization fails
    """
    try:
        if not _AUTH_ENABLED:
            return request.headers.get("authorization", None)

        # HEADERS
        authorization = request.headers.get("authorization", None)
        headers = {"Authorization": authorization} if authorization else None

        # COOKIES
        access_token = request.cookies.get("sAccessToken", None)
        cookies = {"sAccessToken": access_token} if access_token else None

        # PARAMS
        params = {}
        ## PROJECT_ID
        project_id = (
            # CLEANEST
            request.state.otel["baggage"].get("project_id")
            # ALTERNATIVE
            or request.query_params.get("project_id")
        )

        if project_id:
            params["project_id"] = project_id
        ## SCOPE
        if scope_type and scope_id:
            params["scope_type"] = scope_type
            params["scope_id"] = scope_id
        ## ACTION
        params["action"] = "run_service"
        ## RESOURCE
        params["resource_type"] = "service"

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

        try:
            async with httpx.AsyncClient() as client:
                try:
                    response = await client.get(
                        f"{host}/api/permissions/verify",
                        headers=headers,
                        cookies=cookies,
                        params=params,
                        timeout=30.0,
                    )
                except httpx.TimeoutException as exc:
                    raise DenyException(
                        status_code=504,
                        content=f"Could not verify credentials: connection to {host} timed out. Please check your network connection.",
                    ) from exc
                except httpx.ConnectError as exc:
                    raise DenyException(
                        status_code=503,
                        content=f"Could not verify credentials: connection to {host} failed. Please check if agenta is available.",
                    ) from exc
                except httpx.NetworkError as exc:
                    raise DenyException(
                        status_code=503,
                        content=f"Could not verify credentials: connection to {host} failed. Please check your network connection.",
                    ) from exc
                except httpx.HTTPError as exc:
                    raise DenyException(
                        status_code=502,
                        content=f"Could not verify credentials: connection to {host} failed. Please check if agenta is available.",
                    ) from exc

                if response.status_code == 401:
                    raise DenyException(
                        status_code=401,
                        content="Invalid credentials. Please check your credentials or login again.",
                    )
                elif response.status_code == 403:
                    raise DenyException(
                        status_code=403,
                        content="Permission denied. Please check your permissions or contact your administrator.",
                    )
                elif response.status_code == 429:
                    resp_headers = {
                        key: value
                        for key, value in {
                            "Retry-After": response.headers.get("retry-after"),
                            "X-RateLimit-Limit": response.headers.get(
                                "x-ratelimit-limit"
                            ),
                            "X-RateLimit-Remaining": response.headers.get(
                                "x-ratelimit-remaining"
                            ),
                        }.items()
                        if value is not None
                    }
                    raise DenyException(
                        status_code=429,
                        content="API Rate limit exceeded. Please try again later or upgrade your plan.",
                        headers=resp_headers or None,
                    )
                elif response.status_code != 200:
                    raise DenyException(
                        status_code=500,
                        content=f"Could not verify credentials: {host} returned unexpected status code {response.status_code}. Please try again later or contact support if the issue persists.",
                    )

                try:
                    auth = response.json()
                except ValueError as exc:
                    raise DenyException(
                        status_code=500,
                        content=f"Could not verify credentials: {host} returned unexpected invalid JSON response. Please try again later or contact support if the issue persists.",
                    ) from exc

                if not isinstance(auth, dict):
                    raise DenyException(
                        status_code=500,
                        content=f"Could not verify credentials: {host} returned unexpected invalid response format. Please try again later or contact support if the issue persists.",
                    )

                effect = auth.get("effect")
                if effect != "allow":
                    raise DenyException(
                        status_code=403,
                        content="Permission denied. Please check your permissions or contact your administrator.",
                    )

                credentials = auth.get("credentials")

                _cache.put(_hash, credentials)

                return credentials

        except DenyException as deny:
            raise deny
        except Exception as exc:
            raise DenyException(
                status_code=500,
                content=f"Could not verify credentials: unexpected error - {str(exc)}. Please try again later or contact support if the issue persists.",
            ) from exc

    except DenyException as deny:
        raise deny
    except Exception as exc:
        raise DenyException(
            status_code=500,
            content=f"Could not verify credentials: unexpected error - {str(exc)}. Please try again later or contact support if the issue persists.",
        ) from exc


def _strip_service_prefix(path: str) -> str:
    """Strip /services/<name>/ prefix from path for URL matching."""
    if not path.startswith("/services/"):
        return path

    parts = path.split("/", 3)
    if len(parts) < 4:
        return "/"

    service_name = parts[2]
    remainder = parts[3]

    if not service_name or not remainder or remainder.startswith("/"):
        return path

    return f"/{remainder}"


class AuthMiddleware(BaseHTTPMiddleware):
    """Auth middleware for routing context (workflow services)."""

    def __init__(self, app: ASGIApp, **options):
        super().__init__(app)

        self.host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host
        self.scope_type = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_type
        self.scope_id = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_id

    async def dispatch(self, request: Request, call_next: Callable):
        try:
            if _strip_service_prefix(request.url.path) in _ALWAYS_ALLOW_LIST:
                request.state.auth = {}

            else:
                credentials = await get_credentials(
                    request,
                    self.host,
                    self.scope_type,
                    self.scope_id,
                )

                request.state.auth = {"credentials": credentials}

            return await call_next(request)

        except DenyException as deny:
            display_exception("Auth Middleware Exception")

            return DenyResponse(
                status_code=deny.status_code,
                detail=deny.content,
                headers=deny.headers,
            )

        except Exception:  # pylint: disable=bare-except
            display_exception("Auth Middleware Exception")

            return DenyResponse(
                status_code=500,
                detail="Auth: Unexpected Error.",
            )

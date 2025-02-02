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
from agenta.sdk.utils.logging import log

import agenta as ag


_CACHE_ENABLED = getenv("AGENTA_MIDDLEWARE_CACHE_ENABLED", "false").lower() in TRUTHY
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
        self.resource_id = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.service_id

    async def dispatch(self, request: Request, call_next: Callable):
        try:
            if request.url.path in _ALWAYS_ALLOW_LIST:
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

            if not headers and not cookies:
                log.debug(
                    f"No authentication credentials found in request  - Headers present: {bool(headers)}, Cookies present: {bool(cookies)}"
                )

            baggage = request.state.otel["baggage"]

            project_id = (
                # CLEANEST
                baggage.get("project_id")
                # ALTERNATIVE
                or request.query_params.get("project_id")
            )

            if not project_id:
                log.debug("No project ID found in request")

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
                    log.debug("Using cached credentials")
                    return credentials

            try:
                async with httpx.AsyncClient() as client:
                    try:
                        response = await client.get(
                            f"{self.host}/api/permissions/verify",
                            headers=headers,
                            cookies=cookies,
                            params=params,
                            timeout=30.0,
                        )
                    except httpx.TimeoutException as exc:
                        log.debug(f"Timeout while connecting to auth server: {exc}")
                        raise DenyException(
                            status_code=504,
                            content="Connection timed out while verifying permissions. Please check your network connection and try again. If the issue persists, the authentication server might be experiencing high load.",
                        ) from exc
                    except httpx.ConnectError as exc:
                        log.debug(f"Connection error to auth server: {exc}")
                        raise DenyException(
                            status_code=503,
                            content=f"Could not connect to authentication server at {self.host}. Please check if the server is running and accessible.",
                        ) from exc
                    except httpx.NetworkError as exc:
                        log.debug(f"Network error with auth server: {exc}")
                        raise DenyException(
                            status_code=503,
                            content="Network error occurred while connecting to authentication server. Please check your network connection.",
                        ) from exc
                    except httpx.HTTPError as exc:
                        log.debug(f"HTTP error from auth server: {exc}")
                        raise DenyException(
                            status_code=502,
                            content=f"Unexpected HTTP error while connecting to authentication server: {str(exc)}",
                        ) from exc

                    if response.status_code == 401:
                        log.debug("Auth server returned 401 - Invalid credentials")
                        raise DenyException(
                            status_code=401,
                            content="Invalid credentials. Please check your authentication token or login again.",
                        )
                    elif response.status_code == 403:
                        log.debug("Auth server returned 403 - Permission denied")
                        raise DenyException(
                            status_code=403,
                            content="You don't have permission to execute this service. Please check your access rights or contact your administrator.",
                        )
                    elif response.status_code != 200:
                        log.debug(
                            f"Auth server returned unexpected status: {response.status_code}"
                        )
                        raise DenyException(
                            status_code=400,
                            content=f"Authentication server returned unexpected status code {response.status_code}. Please try again later or contact support if the issue persists.",
                        )

                    try:
                        auth = response.json()
                    except ValueError as exc:
                        log.debug(f"Failed to parse auth server response: {exc}")
                        raise DenyException(
                            status_code=502,
                            content="Authentication server returned invalid JSON response. Please try again later or contact support.",
                        ) from exc

                    if not isinstance(auth, dict):
                        log.debug(f"Invalid auth response format: {type(auth)}")
                        raise DenyException(
                            status_code=502,
                            content="Authentication server returned invalid response format. Please try again later or contact support.",
                        )

                    effect = auth.get("effect")
                    if effect != "allow":
                        log.debug("Auth denied by server - Auth effect: {effect}")
                        raise DenyException(
                            status_code=403,
                            content="Service execution denied by authentication server. Please check your permissions or contact your administrator.",
                        )

                    credentials = auth.get("credentials")
                    if not credentials:
                        log.debug("No credentials in auth response")

                    _cache.put(_hash, credentials)

                    return credentials

            except DenyException as deny:
                raise deny
            except Exception as exc:  # pylint: disable=bare-except
                log.debug(f"Unexpected error during auth server communication: {exc}")
                raise DenyException(
                    status_code=500,
                    content=f"Unexpected error during authentication: {str(exc)}. Please try again later or contact support if the issue persists.",
                ) from exc

        except DenyException as deny:
            raise deny
        except Exception as exc:
            log.debug(f"Unexpected error in auth middleware: {exc}")
            display_exception("Auth Middleware Exception (suppressed)")

            raise DenyException(
                status_code=500,
                content="An unexpected error occurred during authentication. Please try again later or contact support if the issue persists.",
            ) from exc

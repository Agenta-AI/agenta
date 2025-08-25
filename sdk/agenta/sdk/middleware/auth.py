from typing import Callable, Optional

from os import getenv
from json import dumps

import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from agenta.sdk.utils.cache import TTLLRUCache
from agenta.sdk.utils.constants import TRUTHY
from agenta.sdk.utils.exceptions import display_exception
from agenta.sdk.utils.logging import get_module_logger

import agenta as ag

from agenta.sdk.middleware.base import (
    WorkflowMiddleware,
    middleware_as_decorator,
)
from agenta.sdk.workflows.types import (
    WorkflowServiceRequest,
    WorkflowServiceResponse,
    WorkflowRevision,
    WorkflowServiceHandler,
)

log = get_module_logger(__name__)

AGENTA_RUNTIME_PREFIX = getenv("AGENTA_RUNTIME_PREFIX", "")


_CACHE_ENABLED = (
    getenv("AGENTA_SERVICE_MIDDLEWARE_CACHE_ENABLED", "true").lower() in TRUTHY
)

_ALWAYS_ALLOW_LIST = [f"{AGENTA_RUNTIME_PREFIX}/health"]

_cache = TTLLRUCache()


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


class AuthHTTPMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: FastAPI):
        super().__init__(app)

        self.host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host

        self.scope_type = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_type
        self.scope_id = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_id

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
            # HEADERS
            authorization = request.headers.get("authorization", None)
            headers = {"Authorization": authorization} if authorization else None

            # COOKIES
            access_token = request.cookies.get("sAccessToken", None)
            cookies = {"sAccessToken": access_token} if access_token else None

            # if not headers and not cookies:
            #     log.debug("No auth header nor auth cookie found in the request")

            # PARAMS
            params = {}
            ## PROJECT_ID
            project_id = (
                # CLEANEST
                request.state.otel["baggage"].get("project_id")
                # ALTERNATIVE
                or request.query_params.get("project_id")
            )
            # if not project_id:
            #     log.debug("No project ID found in request")

            if project_id:
                params["project_id"] = project_id
            ## SCOPE
            if self.scope_type and self.scope_id:
                params["scope_type"] = self.scope_type
                params["scope_id"] = self.scope_id
            ## ACTION
            params["action"] = "run_service"
            ## RESOURCE
            params["resource_type"] = "service"
            # params["resource_id"] = None

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
                    # log.debug("Using cached credentials")
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
                        # log.debug(f"Timeout error while verify credentials: {exc}")
                        raise DenyException(
                            status_code=504,
                            content=f"Could not verify credentials: connection to {self.host} timed out. Please check your network connection.",
                        ) from exc
                    except httpx.ConnectError as exc:
                        # log.debug(f"Connection error while verify credentials: {exc}")
                        raise DenyException(
                            status_code=503,
                            content=f"Could not verify credentials: connection to {self.host} failed. Please check if agenta is available.",
                        ) from exc
                    except httpx.NetworkError as exc:
                        # log.debug(f"Network error while verify credentials: {exc}")
                        raise DenyException(
                            status_code=503,
                            content=f"Could not verify credentials: connection to {self.host} failed. Please check your network connection.",
                        ) from exc
                    except httpx.HTTPError as exc:
                        # log.debug(f"HTTP error while verify credentials: {exc}")
                        raise DenyException(
                            status_code=502,
                            content=f"Could not verify credentials: connection to {self.host} failed. Please check if agenta is available.",
                        ) from exc

                    if response.status_code == 401:
                        # log.debug("Agenta returned 401 - Invalid credentials")
                        raise DenyException(
                            status_code=401,
                            content="Invalid credentials. Please check your credentials or login again.",
                        )
                    elif response.status_code == 403:
                        # log.debug("Agenta returned 403 - Permission denied")
                        raise DenyException(
                            status_code=403,
                            content="Permission denied. Please check your permissions or contact your administrator.",
                        )
                    elif response.status_code != 200:
                        # log.debug(
                        #     f"Agenta returned {response.status_code} - Unexpected status code"
                        # )
                        raise DenyException(
                            status_code=500,
                            content=f"Could not verify credentials: {self.host} returned unexpected status code {response.status_code}. Please try again later or contact support if the issue persists.",
                        )

                    try:
                        auth = response.json()
                    except ValueError as exc:
                        # log.debug(f"Agenta returned invalid JSON response: {exc}")
                        raise DenyException(
                            status_code=500,
                            content=f"Could not verify credentials: {self.host} returned unexpected invalid JSON response. Please try again later or contact support if the issue persists.",
                        ) from exc

                    if not isinstance(auth, dict):
                        # log.debug(
                        #     f"Agenta returned invalid response format: {type(auth)}"
                        # )
                        raise DenyException(
                            status_code=500,
                            content=f"Could not verify credentials: {self.host} returned unexpected invalid response format. Please try again later or contact support if the issue persists.",
                        )

                    effect = auth.get("effect")
                    if effect != "allow":
                        # log.debug("Access denied by Agenta - effect: {effect}")
                        raise DenyException(
                            status_code=403,
                            content="Permission denied. Please check your permissions or contact your administrator.",
                        )

                    credentials = auth.get("credentials")

                    # if not credentials:
                    #     log.debug("No credentials found in the response")

                    _cache.put(_hash, credentials)

                    return credentials

            except DenyException as deny:
                raise deny
            except Exception as exc:  # pylint: disable=bare-except
                # log.debug(
                #     f"Unexpected error while verifying credentials (remote): {exc}"
                # )
                raise DenyException(
                    status_code=500,
                    content=f"Could not verify credentials: unexpected error - {str(exc)}. Please try again later or contact support if the issue persists.",
                ) from exc

        except DenyException as deny:
            raise deny
        except Exception as exc:
            # log.debug(f"Unexpected error while verifying credentials (local): {exc}")
            raise DenyException(
                status_code=500,
                content=f"Could not verify credentials: unexpected error - {str(exc)}. Please try again later or contact support if the issue persists.",
            ) from exc


from agenta.sdk.context.tracing import (
    tracing_context_manager,
    tracing_context,
    TracingContext,
)


@middleware_as_decorator
class AuthMiddleware(WorkflowMiddleware):
    def __init__(self):
        pass

    async def __call__(
        self,
        request: WorkflowServiceRequest,
        revision: WorkflowRevision,
        handler: WorkflowServiceHandler,
    ) -> WorkflowServiceResponse:
        ctx = tracing_context.get()

        ctx.credentials = request.credentials

        with tracing_context_manager(context=ctx):
            return await handler(request, revision)


# @middleware_as_decorator
# class AuthMiddleware(WorkflowMiddleware):
#     def __init__(self):
#         self.host = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.host
#         self.scope_type = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_type
#         self.scope_id = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.scope_id

#     async def __call__(
#         self,
#         request: WorkflowServiceRequest,
#         revision: WorkflowRevision,
#         handler: WorkflowServiceHandler,
#     ) -> WorkflowServiceResponse:
#         try:
#             request.credentials = await self._get_credentials(request)

#         except DenyException as deny:
#             display_exception("Auth Middleware Exception")

#             raise deny

#         except Exception as exc:
#             display_exception("Auth Middleware Exception")

#             raise DenyException(
#                 status_code=500,
#                 content="Auth Middleware Unexpected Error.",
#             ) from exc

#         return await handler(request, revision)

#     async def _get_credentials(
#         self,
#         request: WorkflowServiceRequest,
#     ) -> Optional[str]:
#         credentials = request.credentials

#         headers = {"Authorization": credentials} if credentials else None

#         params = {
#             "action": "run_workflow",
#             "resource_type": "workflow",
#         }
#         if self.scope_type and self.scope_id:
#             params["scope_type"] = self.scope_type
#             params["scope_id"] = self.scope_id

#         _hash = dumps(
#             {
#                 "headers": headers,
#                 "params": params,
#             },
#             sort_keys=True,
#         )

#         if _CACHE_ENABLED:
#             cached = _cache.get(_hash)
#             if cached:
#                 return cached

#         try:
#             async with httpx.AsyncClient() as client:
#                 response = await client.get(
#                     f"{self.host}/api/permissions/verify",
#                     params=params,
#                     headers=headers,
#                     timeout=5 * 60,
#                 )

#         except httpx.TimeoutException as exc:
#             raise DenyException(
#                 status_code=504,
#                 content=f"Could not verify credentials: connection to {self.host} timed out. Please check your network connection.",
#             ) from exc
#         except httpx.ConnectError as exc:
#             raise DenyException(
#                 status_code=503,
#                 content=f"Could not verify credentials: connection to {self.host} failed. Please check if agenta is available.",
#             ) from exc
#         except httpx.NetworkError as exc:
#             raise DenyException(
#                 status_code=503,
#                 content=f"Could not verify credentials: connection to {self.host} failed. Please check your network connection.",
#             ) from exc
#         except httpx.HTTPError as exc:
#             raise DenyException(
#                 status_code=502,
#                 content=f"Could not verify credentials: connection to {self.host} failed. Please check if agenta is available.",
#             ) from exc
#         except Exception as exc:
#             raise DenyException(
#                 500,
#                 f"Could not verify credentials: unexpected error.\n {exc}",
#             ) from exc

#         if response.status_code == 401:
#             raise DenyException(
#                 status_code=401,
#                 content="Invalid credentials. Please check your credentials or login again.",
#             )
#         if response.status_code == 403:
#             raise DenyException(
#                 status_code=403,
#                 content="Permission denied. Please check your permissions or contact your administrator.",
#             )
#         if response.status_code != 200:
#             raise DenyException(
#                 status_code=500,
#                 content=f"Could not verify credentials: {self.host} returned unexpected status code {response.status_code}. Please try again later or contact support if the issue persists.",
#             )

#         try:
#             auth = response.json()
#         except ValueError as exc:
#             raise DenyException(
#                 status_code=500,
#                 content=f"Could not verify credentials: {self.host} returned unexpected invalid JSON response. Please try again later or contact support if the issue persists.",
#             ) from exc

#         if not isinstance(auth, dict):
#             raise DenyException(
#                 status_code=500,
#                 content=f"Could not verify credentials: {self.host} returned unexpected invalid response format. Please try again later or contact support if the issue persists.",
#             )

#         if auth.get("effect") != "allow":
#             raise DenyException(
#                 status_code=403,
#                 content="Permission denied. Please check your permissions or contact your administrator.",
#             )

#         credentials: str = auth.get("credentials")

#         if credentials is not None:
#             _cache.put(_hash, credentials)

#         return credentials

from typing import Callable, Dict, Optional

from os import getenv
from traceback import format_exc

import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


from agenta.sdk.utils.logging import log
from agenta.sdk.utils.exceptions import display_exception

import agenta as ag

_TRUTHY = {"true", "1", "t", "y", "yes", "on", "enable", "enabled"}
_ALLOW_UNAUTHORIZED = (
    getenv("AGENTA_UNAUTHORIZED_EXECUTION_ALLOWED", "false").lower() in _TRUTHY
)


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

        self.resource_id = None
        self.resource_type = None

        if ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.service_id:
            self.resource_id = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.service_id
            self.resource_type = "service"

        elif ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.app_id:
            self.resource_id = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.app_id
            self.resource_type = "application"

    async def dispatch(
        self,
        request: Request,
        call_next: Callable,
    ):
        print("--- agenta/sdk/middleware/auth.py ---")
        request.state.auth = None

        if _ALLOW_UNAUTHORIZED:
            return await call_next(request)

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

            params = {
                "action": "run_service",
                "resource_type": self.resource_type,
                "resource_id": self.resource_id,
            }

            if project_id:
                params["project_id"] = project_id

            print("-----------------------------------")
            print(headers)
            print(cookies)
            print(params)
            print("-----------------------------------")

            credentials = await self._get_credentials(
                params=params,
                headers=headers,
                cookies=cookies,
            )

            request.state.auth = {"credentials": credentials}

            print(request.state.auth)

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

    async def _get_credentials(
        self,
        params: Optional[Dict[str, str]] = None,
        headers: Optional[Dict[str, str]] = None,
        cookies: Optional[str] = None,
    ):
        if not headers:
            raise DenyException(content="Missing 'authorization' header.")

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.host}/api/permissions/verify",
                    headers=headers,
                    params=params,
                    cookies=cookies,
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
                # --- #

                return credentials

        except DenyException as deny:
            raise deny

        except Exception as exc:  # pylint: disable=bare-except
            display_exception("Auth Middleware Exception (suppressed)")

            raise DenyException(
                status_code=500, content="Internal Server Error: auth middleware."
            ) from exc

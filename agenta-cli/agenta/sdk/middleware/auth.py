from typing import Callable, Optional
from uuid import UUID
from traceback import format_exc

import httpx
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi import FastAPI, Request, Query, HTTPException

from agenta.sdk.utils.logging import log


class Deny(HTTPException):
    def __init__(self) -> None:
        super().__init__(status_code=401, detail="Unauthorized")


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

            # TODO: ADD TTL-LRU CACHE
            async with httpx.AsyncClient() as client:
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

                response = await client.get(
                    f"{self.host}/api/permissions/verify",
                    headers=headers,
                    cookies=cookies,
                    params=params,
                )

                if response.status_code != 200:
                    raise Deny()

                auth_result = response.json()

                if auth_result.get("status") != "allow":
                    raise Deny()

            return await call_next(request)

        except Exception as exc:  # pylint: disable=bare-except
            log.error("-------------------------------------------------")
            log.error("Agenta SDK - handling middleware exception below:")
            log.error("-------------------------------------------------")
            log.error(format_exc().strip("\n"))
            log.error("-------------------------------------------------")

            raise Deny() from exc

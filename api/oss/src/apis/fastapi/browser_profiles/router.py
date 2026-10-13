import asyncio
from contextlib import suppress
from functools import wraps
from typing import List, Optional
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response, WebSocket, status
from websockets.asyncio.client import ClientConnection, connect

from oss.src.apis.fastapi.browser_profiles.models import (
    BrowserAvailableRequest,
    BrowserAvailableResponse,
    BrowserLiveStatusRequest,
    BrowserLiveStatusResponse,
    BrowserProfileCreateRequest,
    BrowserProfileEditRequest,
    BrowserProfileResponse,
    BrowserProfilesResponse,
)
from oss.src.core.browser_profiles.controller_client import controller_live_url
from oss.src.core.browser_profiles.dtos import BrowserSandbox
from oss.src.core.browser_profiles.service import BrowserProfilesService
from oss.src.core.browser_profiles.types import (
    BrowserLoginNotStarted,
    BrowserProfileHostInvalid,
    BrowserProfileNotFound,
    BrowserToolError,
    BrowserUnavailable,
)
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.middlewares.auth import authenticate_connection
from oss.src.utils.env import env
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)

_CLOSE_UNAUTHORIZED = 4401
_CLOSE_FORBIDDEN = 4403
_CLOSE_NO_BROWSER = 4404
# Frames are base64 JPEGs of a 1280x800 viewport.
_LIVE_MAX_MESSAGE_BYTES = 8 * 1024 * 1024


def handle_browser_profile_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except BrowserProfileNotFound as e:
                raise HTTPException(status_code=404, detail=e.message) from e
            except BrowserProfileHostInvalid as e:
                raise HTTPException(status_code=400, detail=e.message) from e
            except BrowserLoginNotStarted as e:
                raise HTTPException(status_code=409, detail=e.message) from e
            except BrowserUnavailable as e:
                raise HTTPException(status_code=503, detail=e.message) from e
            except BrowserToolError as e:
                raise HTTPException(status_code=502, detail=e.to_detail()) from e

        return wrapper

    return decorator


def _origin_of(url: Optional[str]) -> Optional[str]:
    parts = urlsplit(url or "")
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}".lower()


def _allowed_origins() -> List[str]:
    origins = [_origin_of(url) for url in (env.agenta.web_url, *env.agenta.app_origins)]
    return [origin for origin in origins if origin]


def _scope(request: Request) -> tuple[UUID, UUID]:
    return UUID(str(request.state.project_id)), UUID(str(request.state.user_id))


# Logins are vault secrets: listing them is VIEW_SECRET; adding, signing in and browsing is EDIT_SECRET.
async def _allowed(request: Request, permission: Permission) -> bool:
    return bool(
        await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=permission,  # type: ignore
        )
    )


async def _require(request: Request, permission: Permission) -> None:
    if not await _allowed(request, permission):
        raise FORBIDDEN_EXCEPTION  # type: ignore


class BrowserProfilesRouter:
    def __init__(
        self,
        *,
        browser_profiles_service: BrowserProfilesService,
    ):
        self.browser_profiles_service = browser_profiles_service

        self.router = APIRouter()

        self.router.add_api_route(
            "/",
            self.create_profile,
            methods=["POST"],
            operation_id="create_browser_profile",
            response_model=BrowserProfileResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/query",
            self.query_profiles,
            methods=["POST"],
            operation_id="query_browser_profiles",
            response_model=BrowserProfilesResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/available",
            self.available_profiles,
            methods=["POST"],
            operation_id="fetch_available_browser_profiles",
            response_model=BrowserAvailableResponse,
        )
        self.router.add_api_route(
            "/live/status",
            self.live_status,
            methods=["POST"],
            operation_id="fetch_browser_live_status",
            response_model=BrowserLiveStatusResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/{profile_id}",
            self.fetch_profile,
            methods=["GET"],
            operation_id="fetch_browser_profile",
            response_model=BrowserProfileResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/{profile_id}",
            self.edit_profile,
            methods=["PUT"],
            operation_id="edit_browser_profile",
            response_model=BrowserProfileResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/{profile_id}/archive",
            self.archive_profile,
            methods=["POST"],
            operation_id="archive_browser_profile",
            response_model=BrowserProfileResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/{profile_id}/login/start",
            self.start_login,
            methods=["POST"],
            operation_id="start_browser_profile_login",
            response_model=BrowserProfileResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/{profile_id}/login/finish",
            self.finish_login,
            methods=["POST"],
            operation_id="finish_browser_profile_login",
            response_model=BrowserProfileResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/{profile_id}/login/cancel",
            self.cancel_login,
            methods=["POST"],
            operation_id="cancel_browser_profile_login",
            status_code=status.HTTP_204_NO_CONTENT,
            response_class=Response,
        )
        self.router.add_api_websocket_route("/live", self.live)

    @intercept_exceptions()
    @handle_browser_profile_exceptions()
    async def create_profile(
        self,
        *,
        request: Request,
        #
        profile_create_request: BrowserProfileCreateRequest,
    ) -> BrowserProfileResponse:
        await _require(request, Permission.EDIT_SECRET)
        project_id, user_id = _scope(request)
        profile = await self.browser_profiles_service.create_profile(
            project_id=project_id,
            user_id=user_id,
            profile_create=profile_create_request.profile,
        )
        return BrowserProfileResponse(count=1, profile=profile)

    @intercept_exceptions()
    @handle_browser_profile_exceptions()
    async def query_profiles(
        self,
        *,
        request: Request,
    ) -> BrowserProfilesResponse:
        await _require(request, Permission.VIEW_SECRET)
        project_id, user_id = _scope(request)
        profiles = await self.browser_profiles_service.query_profiles(
            project_id=project_id,
            user_id=user_id,
        )
        return BrowserProfilesResponse(count=len(profiles), profiles=profiles)

    @intercept_exceptions()
    @handle_browser_profile_exceptions()
    async def fetch_profile(
        self,
        *,
        request: Request,
        #
        profile_id: UUID,
    ) -> BrowserProfileResponse:
        await _require(request, Permission.VIEW_SECRET)
        project_id, user_id = _scope(request)
        profile = await self.browser_profiles_service.fetch_profile(
            project_id=project_id,
            user_id=user_id,
            profile_id=profile_id,
        )
        return BrowserProfileResponse(count=1, profile=profile)

    @intercept_exceptions()
    @handle_browser_profile_exceptions()
    async def edit_profile(
        self,
        *,
        request: Request,
        #
        profile_id: UUID,
        profile_edit_request: BrowserProfileEditRequest,
    ) -> BrowserProfileResponse:
        await _require(request, Permission.EDIT_SECRET)
        project_id, user_id = _scope(request)
        profile = await self.browser_profiles_service.edit_profile(
            project_id=project_id,
            user_id=user_id,
            profile_id=profile_id,
            profile_edit=profile_edit_request.profile,
        )
        return BrowserProfileResponse(count=1, profile=profile)

    @intercept_exceptions()
    @handle_browser_profile_exceptions()
    async def archive_profile(
        self,
        *,
        request: Request,
        #
        profile_id: UUID,
    ) -> BrowserProfileResponse:
        await _require(request, Permission.EDIT_SECRET)
        project_id, user_id = _scope(request)
        profile = await self.browser_profiles_service.archive_profile(
            project_id=project_id,
            user_id=user_id,
            profile_id=profile_id,
        )
        return BrowserProfileResponse(count=1, profile=profile)

    @intercept_exceptions()
    @handle_browser_profile_exceptions()
    async def start_login(
        self,
        *,
        request: Request,
        #
        profile_id: UUID,
    ) -> BrowserProfileResponse:
        await _require(request, Permission.EDIT_SECRET)
        project_id, user_id = _scope(request)
        profile = await self.browser_profiles_service.start_login(
            project_id=project_id,
            user_id=user_id,
            profile_id=profile_id,
        )
        return BrowserProfileResponse(count=1, profile=profile)

    @intercept_exceptions()
    @handle_browser_profile_exceptions()
    async def finish_login(
        self,
        *,
        request: Request,
        #
        profile_id: UUID,
    ) -> BrowserProfileResponse:
        await _require(request, Permission.EDIT_SECRET)
        project_id, user_id = _scope(request)
        profile = await self.browser_profiles_service.finish_login(
            project_id=project_id,
            user_id=user_id,
            profile_id=profile_id,
        )
        return BrowserProfileResponse(count=1, profile=profile)

    @intercept_exceptions()
    @handle_browser_profile_exceptions()
    async def cancel_login(
        self,
        *,
        request: Request,
        #
        profile_id: UUID,
    ) -> Response:
        await _require(request, Permission.EDIT_SECRET)
        project_id, user_id = _scope(request)
        await self.browser_profiles_service.cancel_login(
            project_id=project_id,
            user_id=user_id,
            profile_id=profile_id,
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @intercept_exceptions()
    @handle_browser_profile_exceptions()
    async def available_profiles(
        self,
        *,
        request: Request,
        #
        available_request: BrowserAvailableRequest,
    ) -> BrowserAvailableResponse:
        """Called by an agent run with its own credentials, to learn which logins it may use."""
        if not await _allowed(request, Permission.EDIT_SECRET):
            return BrowserAvailableResponse(eligible=False)
        project_id, user_id = _scope(request)
        profile_ids = await self.browser_profiles_service.available_profile_ids(
            project_id=project_id,
            user_id=user_id,
            revision_id=available_request.revision_id,
            is_draft=available_request.is_draft,
        )
        return BrowserAvailableResponse(
            count=len(profile_ids or []),
            profile_ids=profile_ids or [],
            eligible=profile_ids is not None,
        )

    @intercept_exceptions()
    @handle_browser_profile_exceptions()
    async def live_status(
        self,
        *,
        request: Request,
        #
        live_status_request: BrowserLiveStatusRequest,
    ) -> BrowserLiveStatusResponse:
        await _require(request, Permission.VIEW_SECRET)
        project_id, user_id = _scope(request)
        live_status = await self.browser_profiles_service.live_status(
            project_id=project_id,
            user_id=user_id,
            session_id=live_status_request.session_id,
        )
        return BrowserLiveStatusResponse(**live_status.model_dump())

    # WS /browser-profiles/live?project_id=..&(profile_id=..|session_id=..)
    async def live(self, websocket: WebSocket) -> None:
        # Accepted first so the close code reaches the client; nothing relays before the checks pass.
        await websocket.accept()

        if websocket.headers.get("origin", "").lower() not in _allowed_origins():
            await websocket.close(code=_CLOSE_FORBIDDEN)
            return

        # The HTTP auth middleware does not run for WebSockets, so its checks run here.
        request = Request({**websocket.scope, "type": "http", "method": "GET"})
        try:
            await authenticate_connection(request)
            project_id, user_id = _scope(request)
        except Exception:  # pylint: disable=broad-except
            await websocket.close(code=_CLOSE_UNAUTHORIZED)
            return
        # The live view takes input: it drives the signed-in browser.
        if not await _allowed(request, Permission.EDIT_SECRET):
            await websocket.close(code=_CLOSE_FORBIDDEN)
            return

        sandbox: Optional[BrowserSandbox] = None
        profile_id = websocket.query_params.get("profile_id")
        session_id = websocket.query_params.get("session_id")
        try:
            if profile_id:
                sandbox = await self.browser_profiles_service.find_login_browser(
                    project_id=project_id,
                    user_id=user_id,
                    profile_id=UUID(profile_id),
                )
            elif session_id:
                sandbox = await self.browser_profiles_service.find_session_browser(
                    project_id=project_id,
                    user_id=user_id,
                    session_id=session_id,
                )
        except (BrowserProfileNotFound, ValueError):
            await websocket.close(code=_CLOSE_FORBIDDEN)
            return
        except BrowserToolError:
            sandbox = None
        if sandbox is None:
            await websocket.close(code=_CLOSE_NO_BROWSER)
            return

        try:
            async with connect(
                controller_live_url(sandbox),
                additional_headers=sandbox.headers,
                max_size=_LIVE_MAX_MESSAGE_BYTES,
            ) as upstream:
                await _relay(websocket, upstream)
        except Exception as e:  # pylint: disable=broad-except
            log.warning("browser.live", outcome="relay_failed", error=str(e))
        with suppress(Exception):
            await websocket.close()


async def _relay(websocket: WebSocket, upstream: ClientConnection) -> None:
    async def client_to_browser() -> None:
        while True:
            await upstream.send(await websocket.receive_text())

    async def browser_to_client() -> None:
        async for message in upstream:
            await websocket.send_text(
                message if isinstance(message, str) else message.decode()
            )

    tasks = [
        asyncio.create_task(client_to_browser()),
        asyncio.create_task(browser_to_client()),
    ]
    _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for task in pending:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)

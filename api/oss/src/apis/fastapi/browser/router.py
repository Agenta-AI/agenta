"""The live view of the browser an agent runs in its session sandbox (the `browser` skill).

`POST /browser/live/status` says whether the session has a running browser. `WS /browser/live`
relays the person's live view to it: page frames one way; mouse, keys and take-control the other.
"""

import asyncio
from contextlib import suppress
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Request, WebSocket
from pydantic import BaseModel
from websockets.asyncio.client import ClientConnection, connect

from oss.src.apis.fastapi.sharing.utils import (
    ResourceCheck,
    allow_resource,
    check_resource_for,
    session_resource,
)
from oss.src.core.access.permissions.types import Permission
from oss.src.core.browser.runner_client import fetch_live_link
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


class BrowserLiveStatusRequest(BaseModel):
    session_id: str


class BrowserLiveStatusResponse(BaseModel):
    running: bool


def _origin_of(url: str | None) -> str | None:
    parts = urlsplit(url or "")
    if not parts.scheme or not parts.netloc:
        return None
    return f"{parts.scheme}://{parts.netloc}".lower()


def _allowed_origins() -> list[str]:
    origins = [_origin_of(url) for url in (env.agenta.web_url, *env.agenta.app_origins)]
    return [origin for origin in origins if origin]


class BrowserRouter:
    def __init__(self) -> None:
        self.router = APIRouter()
        self.router.add_api_route(
            "/live/status",
            self.live_status,
            methods=["POST"],
            operation_id="fetch_browser_live_status",
            response_model=BrowserLiveStatusResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_websocket_route("/live", self.live)

    @intercept_exceptions()
    async def live_status(
        self,
        request: Request,
        *,
        live_status_request: BrowserLiveStatusRequest,
    ) -> BrowserLiveStatusResponse:
        if not await allow_resource(
            request,
            action=Permission.VIEW_SESSIONS,
            resource=session_resource(live_status_request.session_id),
        ):
            return BrowserLiveStatusResponse(running=False)
        link = await fetch_live_link(
            project_id=UUID(str(request.state.project_id)),
            session_id=live_status_request.session_id,
        )
        return BrowserLiveStatusResponse(running=link is not None)

    # WS /browser/live?project_id=..&session_id=..
    async def live(self, websocket: WebSocket) -> None:
        # Accepted first so the close code reaches the client; nothing relays before the checks pass.
        await websocket.accept()

        if websocket.headers.get("origin", "").lower() not in _allowed_origins():
            await websocket.close(code=_CLOSE_FORBIDDEN)
            return

        # The HTTP auth middleware does not run for WebSockets, so its checks run here.
        request = Request({**websocket.scope, "type": "http", "method": "GET"})
        try:
            access = await authenticate_connection(request)
            project_id = UUID(str(request.state.project_id))
        except Exception:  # noqa: BLE001  # pylint: disable=broad-except
            await websocket.close(code=_CLOSE_UNAUTHORIZED)
            return

        session_id = (websocket.query_params.get("session_id") or "").strip()
        if not session_id:
            await websocket.close(code=_CLOSE_NO_BROWSER)
            return
        # The live view takes input: it drives the agent's browser, signed-in sites included.
        check = await check_resource_for(
            access=access,
            action=Permission.RUN_SESSIONS,
            project_id=project_id,
            resource=session_resource(session_id),
        )
        if check != ResourceCheck.ALLOWED:
            hidden = check == ResourceCheck.HIDDEN
            await websocket.close(
                code=_CLOSE_NO_BROWSER if hidden else _CLOSE_FORBIDDEN
            )
            return

        link = await fetch_live_link(project_id=project_id, session_id=session_id)
        if link is None:
            await websocket.close(code=_CLOSE_NO_BROWSER)
            return

        try:
            async with connect(
                link["url"],
                additional_headers=link["headers"],
                max_size=_LIVE_MAX_MESSAGE_BYTES,
            ) as upstream:
                await _relay(websocket, upstream)
        except Exception as e:  # noqa: BLE001  # pylint: disable=broad-except
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

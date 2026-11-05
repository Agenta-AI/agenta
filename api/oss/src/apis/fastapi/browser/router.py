"""The live view of the browser an agent runs in its session sandbox (the `browser` skill).

`POST /browser/live/status` says whether the session has a running browser. `WS /browser/live`
relays the person's live view to it: page frames one way; mouse, keys and take-control the other.
Both are mounted always, so the API schema keeps them; with the browser off they find no browser.
"""

import asyncio
from contextlib import suppress
from typing import Awaitable, Callable
from uuid import UUID

from fastapi import APIRouter, Request, WebSocket
from websockets.asyncio.client import ClientConnection, connect

from oss.src.apis.fastapi.shared.utils import is_valid_session_id, web_origin
from oss.src.apis.fastapi.browser.models import (
    BrowserLiveStatusRequest,
    BrowserLiveStatusResponse,
)
from oss.src.apis.fastapi.sharing.utils import (
    ResourceCheck,
    check_resource,
    check_resource_for,
    session_resource,
)
from oss.src.core.access.context import fresh_request_memo
from oss.src.core.access.permissions.types import Permission
from oss.src.core.sessions.streams.runner_client import fetch_browser_live_link
from oss.src.middlewares.auth import authenticate_connection
from oss.src.utils.env import env
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_CLOSE_BAD_REQUEST = 4400
_CLOSE_UNAUTHORIZED = 4401
_CLOSE_FORBIDDEN = 4403
_CLOSE_NO_BROWSER = 4404
# Frames are base64 JPEGs of a 1280x800 viewport.
_LIVE_MAX_MESSAGE_BYTES = 8 * 1024 * 1024
# A live view nobody closes would keep the sandbox, and its bill, running.
_LIVE_MAX_SECONDS = 60 * 60


def _allowed_origins() -> set[str]:
    # Stricter than CORS on purpose: this socket drives a signed-in browser, so only the app's
    # own origins may open it, never the preview or localhost defaults CORS also accepts.
    urls = (env.agenta.web_url, *env.agenta.app_origins)
    return {origin.lower() for origin in map(web_origin, urls) if origin}


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
        session_id = live_status_request.session_id.strip()
        # RUN_SESSIONS, as the live view: a person who cannot drive the browser gets no button.
        if (
            not env.browser.enabled
            or not is_valid_session_id(session_id)
            or await check_resource(
                request,
                action=Permission.RUN_SESSIONS,
                resource=session_resource(session_id),
            )
            != ResourceCheck.ALLOWED
        ):
            return BrowserLiveStatusResponse(running=False)
        link = await fetch_browser_live_link(
            project_id=UUID(str(request.state.project_id)),
            session_id=session_id,
        )
        if link is None:
            return BrowserLiveStatusResponse(running=False)
        return BrowserLiveStatusResponse(
            running=True,
            waiting=link.page.waiting or None,
            url=link.page.url or None,
            title=link.page.title or None,
        )

    # WS /browser/live?project_id=..&session_id=..
    async def live(self, websocket: WebSocket) -> None:
        # Accepted first so the close code reaches the client; nothing relays before the checks pass.
        await websocket.accept()

        if not env.browser.enabled:
            await websocket.close(code=_CLOSE_NO_BROWSER)
            return

        if websocket.headers.get("origin", "").lower() not in _allowed_origins():
            await websocket.close(code=_CLOSE_FORBIDDEN)
            return

        session_id = (websocket.query_params.get("session_id") or "").strip()
        if not is_valid_session_id(session_id):
            await websocket.close(code=_CLOSE_BAD_REQUEST)
            return

        # The HTTP auth middleware does not run for WebSockets, so its checks run here.
        request = Request({**websocket.scope, "type": "http", "method": "GET"})
        try:
            access = await authenticate_connection(request)
            project_id = UUID(str(request.state.project_id))
        except Exception:  # noqa: BLE001  # pylint: disable=broad-except
            await websocket.close(code=_CLOSE_UNAUTHORIZED)
            return

        async def check() -> ResourceCheck:
            # The live view takes input: it drives the agent's browser, signed-in sites included.
            # A fresh memo makes each recheck read the current grants.
            with fresh_request_memo():
                return await check_resource_for(
                    access=access,
                    action=Permission.RUN_SESSIONS,
                    project_id=project_id,
                    resource=session_resource(session_id),
                )

        first = await check()
        if first != ResourceCheck.ALLOWED:
            hidden = first == ResourceCheck.HIDDEN
            await websocket.close(
                code=_CLOSE_NO_BROWSER if hidden else _CLOSE_FORBIDDEN
            )
            return

        link = await fetch_browser_live_link(
            project_id=project_id, session_id=session_id
        )
        if link is None:
            await websocket.close(code=_CLOSE_NO_BROWSER)
            return

        async def still_allowed() -> None:
            while True:
                await asyncio.sleep(env.sessions.live_auth_recheck_seconds)
                try:
                    if await check() != ResourceCheck.ALLOWED:
                        return
                except Exception as e:  # noqa: BLE001  # pylint: disable=broad-except
                    # A failed read is not a refusal; the next recheck decides.
                    log.warning("browser.live", outcome="recheck_failed", error=str(e))

        code = 1000
        try:
            async with connect(
                link.url,
                additional_headers=link.headers,
                max_size=_LIVE_MAX_MESSAGE_BYTES,
            ) as upstream:
                code = await _relay(websocket, upstream, still_allowed)
        except Exception as e:  # noqa: BLE001  # pylint: disable=broad-except
            log.warning("browser.live", outcome="relay_failed", error=str(e))
            # A stale link or a browser that just stopped: the app says no browser is running.
            code = _CLOSE_NO_BROWSER
        with suppress(Exception):
            await websocket.close(code=code)


async def _relay(
    websocket: WebSocket,
    upstream: ClientConnection,
    access_revoked: Callable[[], Awaitable[None]],
) -> int:
    """Relays both ways until either side closes, `access_revoked` returns, or the view reaches
    its time limit. Returns the close code for the viewer."""

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
    revoked = asyncio.create_task(access_revoked())
    done, pending = await asyncio.wait(
        [*tasks, revoked],
        timeout=_LIVE_MAX_SECONDS,
        return_when=asyncio.FIRST_COMPLETED,
    )
    for task in pending:
        task.cancel()
    await asyncio.gather(*tasks, revoked, return_exceptions=True)
    return _CLOSE_FORBIDDEN if revoked in done else 1000

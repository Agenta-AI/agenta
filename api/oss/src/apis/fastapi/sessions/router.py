"""Session streams API router.

Mounted at /sessions/streams/ — a top-level resource, NOT /sessions/{id}/stream.
Exposes: invoke (DATA/FORCE matrix), heartbeat, detach, query, liveness.
"""

from functools import wraps

from fastapi import APIRouter, HTTPException, Request, status

from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger

from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.permissions.service import check_action_access
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION

from oss.src.core.sessions.dtos import (
    SessionHeartbeatRequest,
    SessionInvokeRequest,
    SessionStreamQuery,
)
from oss.src.core.sessions.exceptions import (
    ConcurrencyCapExceeded,
    SessionIdInvalid,
    SessionRunInUse,
    SessionStreamAlreadyExists,
    SessionStreamNotFound,
)
from oss.src.core.sessions.service import SessionStreamsService

from oss.src.apis.fastapi.sessions.models import (
    SessionDetachRequestModel,
    SessionHeartbeatRequestModel,
    SessionInvokeRequestModel,
    SessionInvokeResponseModel,
    SessionLivenessResponseModel,
    SessionStreamQueryRequestModel,
    SessionStreamResponseModel,
    SessionStreamsResponseModel,
)

log = get_module_logger(__name__)


def _handle_session_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except SessionIdInvalid as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=e.message,
                ) from e
            except SessionRunInUse as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "message": e.message,
                        "liveness": e.liveness,
                    },
                ) from e
            except ConcurrencyCapExceeded as e:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=e.message,
                ) from e
            except SessionStreamNotFound as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=e.message,
                ) from e
            except SessionStreamAlreadyExists as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=e.message,
                ) from e

        return wrapper

    return decorator


class SessionStreamsRouter:
    def __init__(self, *, service: SessionStreamsService) -> None:
        self._service = service
        self.router = APIRouter()
        self.admin_router = APIRouter()

        self.router.add_api_route(
            "/sessions/streams/invoke",
            self.invoke,
            methods=["POST"],
            operation_id="sessions_streams_invoke",
            tags=["Sessions"],
        )
        self.router.add_api_route(
            "/sessions/streams/query",
            self.query_streams,
            methods=["POST"],
            operation_id="sessions_streams_query",
            tags=["Sessions"],
        )
        self.router.add_api_route(
            "/sessions/streams/liveness",
            self.get_liveness,
            methods=["GET"],
            operation_id="sessions_streams_liveness",
            tags=["Sessions"],
        )

        # --- admin (runner-only) write tier ---
        # heartbeat + detach are runner-internal coordination writes, authenticated
        # via the runner's admin auth (request.state.admin), not project RBAC.
        self.admin_router.add_api_route(
            "/heartbeat",
            self.heartbeat,
            methods=["POST"],
            operation_id="admin_sessions_streams_heartbeat",
            tags=["Sessions", "Admin"],
        )
        self.admin_router.add_api_route(
            "/detach",
            self.detach,
            methods=["POST"],
            operation_id="admin_sessions_streams_detach",
            tags=["Sessions", "Admin"],
        )

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def invoke(
        self,
        request: Request,
        payload: SessionInvokeRequestModel,
    ) -> SessionInvokeResponseModel:
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        await self._service.check_concurrency_cap(project_id=project_id)

        result = await self._service.invoke(
            project_id=project_id,
            user_id=user_id,
            request=SessionInvokeRequest(
                session_id=payload.session_id,
                prompt=payload.prompt,
                force=payload.force,
                detached=payload.detached,
            ),
        )
        return SessionInvokeResponseModel(
            mode=result.mode,
            session_id=result.session_id,
            run_id=result.run_id,
            detached=result.detached,
        )

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def detach(
        self,
        request: Request,
        payload: SessionDetachRequestModel,
    ) -> dict:
        if not getattr(request.state, "admin", False):
            raise FORBIDDEN_EXCEPTION

        await self._service.detach(
            session_id=payload.session_id,
            watcher_id=payload.watcher_id,
        )
        return {"ok": True}

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def heartbeat(
        self,
        request: Request,
        payload: SessionHeartbeatRequestModel,
    ) -> SessionStreamResponseModel:
        if not getattr(request.state, "admin", False):
            raise FORBIDDEN_EXCEPTION

        stream = await self._service.heartbeat(
            project_id=payload.project_id,
            request=SessionHeartbeatRequest(
                session_id=payload.session_id,
                replica_id=payload.replica_id,
                sandbox_live=payload.sandbox_live,
                status=payload.status,
            ),
        )
        return SessionStreamResponseModel(stream=stream)

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def query_streams(
        self,
        request: Request,
        payload: SessionStreamQueryRequestModel,
    ) -> SessionStreamsResponseModel:
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        streams = await self._service.query_streams(
            project_id=project_id,
            filter=SessionStreamQuery(
                session_id=payload.session_id,
                sandbox_live=payload.sandbox_live,
            ),
        )
        return SessionStreamsResponseModel(count=len(streams), streams=streams)

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def get_liveness(
        self,
        request: Request,
        session_id: str,
    ) -> SessionLivenessResponseModel:
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        liveness = await self._service.get_liveness(session_id=session_id)
        return SessionLivenessResponseModel(
            alive=liveness.alive,
            attached=liveness.attached,
            reattachable=liveness.reattachable,
        )

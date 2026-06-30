"""Unified sessions API router.

Composes four sub-domain routers:
  - SessionStreamsRouter  — /sessions/streams/*
  - SessionStatesRouter  — /sessions/states/
  - RecordsRouter        — /sessions/records/*
  - InteractionsRouter   — /sessions/interactions/*
"""

import re
from functools import wraps
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from typing import Any, Optional, Union

from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger

from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.permissions.service import check_action_access
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION

# Core domain imports — new paths
from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionStreamCommandRequest,
    SessionStreamQuery,
)
from oss.src.core.sessions.streams.types import (
    ConcurrencyCapExceeded,
    SessionIdInvalid,
    SessionTurnInUse,
    SessionStreamAlreadyExists,
    SessionStreamNotFound,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.states.service import SessionStatesService
from oss.src.core.sessions.states.dtos import SessionStateUpsert
from oss.src.core.sessions.records.service import RecordsService
from oss.src.core.sessions.records.dtos import SessionRecordEvent
from oss.src.core.sessions.records.streaming import publish_record
from oss.src.core.sessions.interactions.dtos import (
    SessionInteractionCreate,
    SessionInteractionStatus,
    SessionInteractionTransition,
)
from oss.src.core.sessions.interactions.service import SessionInteractionsService
from oss.src.core.sessions.interactions.types import InteractionNotFound
from oss.src.core.sessions.mounts.service import SessionMountsService
from oss.src.core.sessions.mounts.dtos import SessionMountQuery
from oss.src.core.workflows.dtos import (
    WorkflowServiceRequest,
    WorkflowServiceRequestData,
)
from oss.src.core.workflows.service import WorkflowsService

from oss.src.apis.fastapi.sessions.models import (
    # streams
    SessionDetachRequestModel,
    SessionHeartbeatRequestModel,
    SessionStreamCommandRequestModel,
    SessionStreamCommandResponseModel,
    SessionStreamQueryRequestModel,
    SessionStreamResponseModel,
    SessionStreamsResponseModel,
    # states
    SessionStateResponse,
    SessionStateUpsertRequest,
    # records
    SessionRecordIngestRequest,
    SessionRecordQueryRequest,
    SessionRecordResponse,
    SessionRecordsQueryResponse,
    # interactions
    SessionInteractionCancelStaleRequest,
    SessionInteractionCreateRequest,
    SessionInteractionQueryRequest,
    SessionInteractionRespondRequest,
    SessionInteractionResponse,
    SessionInteractionsResponse,
    SessionInteractionTransitionRequest,
    # mounts
    SessionMountQueryRequest,
    SessionMountResponse,  # noqa: F401  (exported for OpenAPI/single-mount future use)
    SessionMountsResponse,
)

log = get_module_logger(__name__)

# SEC-8: allow letters, digits, hyphens, underscores, dots — no slashes or control chars
_SESSION_ID_RE = re.compile(r"^[\w.\-]{1,256}$")


def _validate_session_id_http(session_id: str) -> None:
    if not _SESSION_ID_RE.match(session_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="session_id contains invalid characters or is empty.",
        )


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
            except SessionTurnInUse as e:
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


# ---------------------------------------------------------------------------
# Sub-routers
# ---------------------------------------------------------------------------


class SessionStreamsRouter:
    """Streams sub-router — /sessions/streams/*"""

    def __init__(
        self,
        *,
        service: SessionStreamsService,
        interactions_service: SessionInteractionsService,
    ) -> None:
        self._service = service
        self._interactions_service = interactions_service
        self.router = APIRouter()

        # Unified collection surface on /sessions/streams/, keyed by ?session_id=.
        self.router.add_api_route(
            "/sessions/streams/",
            self.fetch_session_stream,
            methods=["GET"],
            operation_id="fetch_session_stream",
            tags=["Sessions"],
        )
        self.router.add_api_route(
            "/sessions/streams/",
            self.set_session_stream,
            methods=["POST"],
            operation_id="set_session_stream",
            tags=["Sessions"],
        )
        self.router.add_api_route(
            "/sessions/streams/",
            self.delete_session_stream,
            methods=["DELETE"],
            operation_id="delete_session_stream",
            tags=["Sessions"],
        )
        self.router.add_api_route(
            "/sessions/streams/query",
            self.query_session_streams,
            methods=["POST"],
            operation_id="query_session_streams",
            tags=["Sessions"],
        )
        self.router.add_api_route(
            "/sessions/streams/detach",
            self.detach_session_stream,
            methods=["POST"],
            operation_id="detach_session_stream",
            tags=["Sessions"],
        )

        self.router.add_api_route(
            "/sessions/streams/heartbeat",
            self.heartbeat_session_stream,
            methods=["POST"],
            operation_id="heartbeat_session_stream",
            tags=["Sessions"],
        )

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def set_session_stream(
        self,
        request: Request,
        payload: SessionStreamCommandRequestModel,
    ) -> SessionStreamCommandResponseModel:
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

        result = await self._service.command(
            project_id=project_id,
            user_id=user_id,
            request=SessionStreamCommandRequest(
                session_id=payload.session_id,
                prompt=payload.prompt,
                force=payload.force,
                detached=payload.detached,
            ),
        )
        return SessionStreamCommandResponseModel(
            mode=result.mode,
            session_id=result.session_id,
            turn_id=result.turn_id,
            watcher_id=result.watcher_id,
            detached=result.detached,
        )

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def fetch_session_stream(
        self,
        request: Request,
        session_id: str = Query(...),
    ) -> SessionStreamResponseModel:
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        stream = await self._service.fetch(
            project_id=UUID(str(project_id)),
            session_id=session_id,
        )
        return SessionStreamResponseModel(stream=stream)

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def delete_session_stream(
        self,
        request: Request,
        session_id: str = Query(...),
    ) -> dict:
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        await self._service.kill(
            project_id=UUID(str(project_id)),
            user_id=UUID(str(user_id)),
            session_id=session_id,
        )
        # A kill orphans every still-pending gate for the session — no one will answer them.
        await self._interactions_service.cancel_session_pending(
            project_id=UUID(str(project_id)),
            session_id=session_id,
        )
        return {"ok": True}

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def detach_session_stream(
        self,
        request: Request,
        payload: SessionDetachRequestModel,
    ) -> dict:
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        await self._service.detach(
            project_id=UUID(str(project_id)),
            user_id=UUID(str(user_id)),
            session_id=payload.session_id,
            watcher_id=payload.watcher_id,
        )
        return {"ok": True}

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def heartbeat_session_stream(
        self,
        request: Request,
        payload: SessionHeartbeatRequestModel,
    ) -> SessionStreamResponseModel:
        # The runner authenticates AS the invoke caller; project scope comes from the
        # credential, never the body.
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        stream = await self._service.heartbeat(
            project_id=project_id,
            request=SessionHeartbeatRequest(
                session_id=payload.session_id,
                replica_id=payload.replica_id,
                turn_id=payload.turn_id,
                is_running=payload.is_running,
                status=payload.status,
            ),
        )
        return SessionStreamResponseModel(stream=stream)

    @intercept_exceptions()
    @_handle_session_exceptions()
    async def query_session_streams(
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
                is_alive=payload.is_alive,
                is_running=payload.is_running,
            ),
        )
        return SessionStreamsResponseModel(count=len(streams), streams=streams)


class SessionStatesRouter:
    """States sub-router — /sessions/states/?session_id=..."""

    __test__ = False

    def __init__(self, *, session_states_service: SessionStatesService):
        self.session_states_service = session_states_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/states/",
            self.get_session_state,
            methods=["GET"],
            operation_id="get_state",
            status_code=status.HTTP_200_OK,
            response_model=SessionStateResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/states/",
            self.set_session_state,
            methods=["PUT", "POST"],
            operation_id="set_state",
            status_code=status.HTTP_200_OK,
            response_model=SessionStateResponse,
            response_model_exclude_none=True,
        )

    @intercept_exceptions()
    async def get_session_state(
        self,
        request: Request,
        *,
        session_id: str = Query(...),
    ) -> SessionStateResponse:
        _validate_session_id_http(session_id)

        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        session_state = await self.session_states_service.get_session_state(
            project_id=UUID(request.state.project_id),
            session_id=session_id,
        )
        return SessionStateResponse(
            count=1 if session_state else 0,
            session_state=session_state,
        )

    @intercept_exceptions()
    async def set_session_state(
        self,
        request: Request,
        *,
        session_state_upsert_request: SessionStateUpsertRequest,
        session_id: str = Query(...),
    ) -> SessionStateResponse:
        _validate_session_id_http(session_id)

        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        session_state = await self.session_states_service.set_session_state(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            session_id=session_id,
            upsert=SessionStateUpsert(
                **session_state_upsert_request.model_dump(exclude_unset=True)
            ),
        )
        return SessionStateResponse(
            count=1 if session_state else 0,
            session_state=session_state,
        )


class RecordsRouter:
    """Records sub-router — /sessions/records/*"""

    def __init__(self, records_service: RecordsService):
        self.records_service = records_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/query",
            self.query_records,
            methods=["POST"],
            operation_id="query_records",
            status_code=status.HTTP_200_OK,
            response_model=SessionRecordsQueryResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/{event_id}",
            self.get_record_event,
            methods=["GET"],
            operation_id="get_record_event",
            status_code=status.HTTP_200_OK,
            response_model=SessionRecordResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/ingest",
            self.ingest_record_event,
            methods=["POST"],
            operation_id="ingest_record",
            tags=["Sessions"],
        )

    @intercept_exceptions()
    async def query_records(
        self,
        request: Request,
        *,
        query_request: SessionRecordQueryRequest,
    ) -> Union[SessionRecordsQueryResponse, JSONResponse]:
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        records = await self.records_service.get_records(
            project_id=UUID(request.state.project_id),
            session_id=query_request.session_id,
        )
        return SessionRecordsQueryResponse(
            count=len(records),
            records=records,
        )

    @intercept_exceptions()
    async def get_record_event(
        self,
        request: Request,
        event_id: UUID,
    ) -> Union[SessionRecordResponse, JSONResponse]:
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        record = await self.records_service.get_event(
            project_id=UUID(request.state.project_id),
            event_id=event_id,
        )
        return SessionRecordResponse(record=record)

    @intercept_exceptions()
    async def ingest_record_event(
        self,
        request: Request,
        body: SessionRecordIngestRequest,
    ) -> dict:
        # The runner authenticates AS the invoke caller; project scope comes from the
        # credential, never the body.
        project_id = request.state.project_id
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=project_id,
            permission=Permission.RUN_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        await publish_record(
            organization_id=UUID(request.state.organization_id),
            project_id=UUID(project_id),
            record_event=SessionRecordEvent(
                session_id=UUID(body.session_id),
                project_id=UUID(project_id),
                event_index=body.event_index,
                sender=body.sender,
                session_update=body.session_update,
                payload=body.payload,
            ),
        )
        return {"ok": True}


class InteractionsRouter:
    """Interactions sub-router — /sessions/interactions/*"""

    def __init__(
        self,
        *,
        interactions_service: SessionInteractionsService,
        workflows_service: WorkflowsService,
        respond_task: Optional[Any] = None,
    ) -> None:
        self.interactions_service = interactions_service
        self.workflows_service = workflows_service
        self.respond_task = respond_task

        self.router = APIRouter()

        self.router.add_api_route(
            "/",
            self.create_interaction,
            methods=["POST"],
            operation_id="create_interaction",
        )
        self.router.add_api_route(
            "/query",
            self.query_interactions,
            methods=["POST"],
            operation_id="query_interactions",
        )
        self.router.add_api_route(
            "/transition",
            self.transition_interaction,
            methods=["POST"],
            operation_id="transition_interaction",
        )
        self.router.add_api_route(
            "/cancel-stale",
            self.cancel_stale_interactions,
            methods=["POST"],
            operation_id="cancel_stale_interactions",
        )
        self.router.add_api_route(
            "/{interaction_id}",
            self.fetch_interaction,
            methods=["GET"],
            operation_id="fetch_interaction",
        )
        self.router.add_api_route(
            "/{interaction_id}/respond",
            self.respond_interaction,
            methods=["POST"],
            operation_id="respond_interaction",
        )

    @intercept_exceptions()
    async def create_interaction(
        self,
        request: Request,
        body: SessionInteractionCreateRequest,
    ) -> SessionInteractionResponse:
        # The runner authenticates AS the invoke caller; project scope comes from the
        # credential, never the body. Creating an interaction is part of running a turn.
        project_id: UUID = request.state.project_id
        user_id: UUID = request.state.user_id

        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        interaction = await self.interactions_service.create_interaction(
            project_id=project_id,
            user_id=user_id,
            interaction=SessionInteractionCreate(
                project_id=project_id,
                session_id=body.session_id,
                turn_id=body.turn_id,
                token=body.token,
                kind=body.kind,
                data=body.data,
                flags=body.flags,
            ),
        )
        return SessionInteractionResponse(count=1, interaction=interaction)

    @intercept_exceptions()
    async def transition_interaction(
        self,
        request: Request,
        body: SessionInteractionTransitionRequest,
    ) -> SessionInteractionResponse:
        project_id: UUID = request.state.project_id
        user_id: UUID = request.state.user_id

        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        try:
            interaction = await self.interactions_service.transition_interaction(
                transition=SessionInteractionTransition(
                    project_id=project_id,
                    session_id=body.session_id,
                    token=body.token,
                    status=body.status,
                ),
            )
        except InteractionNotFound:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interaction not found or already terminal",
            )
        return SessionInteractionResponse(count=1, interaction=interaction)

    @intercept_exceptions()
    async def cancel_stale_interactions(
        self,
        request: Request,
        body: SessionInteractionCancelStaleRequest,
    ) -> dict:
        project_id: UUID = request.state.project_id
        user_id: UUID = request.state.user_id

        if not await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        cancelled = await self.interactions_service.cancel_session_pending(
            project_id=project_id,
            session_id=body.session_id,
            except_turn_id=body.turn_id,
        )
        return {"cancelled": cancelled}

    @intercept_exceptions()
    async def query_interactions(
        self,
        request: Request,
        body: SessionInteractionQueryRequest,
    ) -> SessionInteractionsResponse:
        project_id: UUID = request.state.project_id

        authorized = await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_SESSIONS,
        )
        if not authorized:
            raise FORBIDDEN_EXCEPTION

        interactions = await self.interactions_service.query_interactions(
            project_id=project_id,
            query=body.query,
            windowing=body.windowing,
        )
        return SessionInteractionsResponse(
            count=len(interactions), interactions=interactions
        )

    @intercept_exceptions()
    async def fetch_interaction(
        self,
        request: Request,
        interaction_id: UUID,
    ) -> SessionInteractionResponse:
        project_id: UUID = request.state.project_id

        authorized = await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(project_id),
            permission=Permission.VIEW_SESSIONS,
        )
        if not authorized:
            raise FORBIDDEN_EXCEPTION

        try:
            interaction = await self.interactions_service.fetch_interaction(
                project_id=project_id,
                interaction_id=interaction_id,
            )
        except InteractionNotFound:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interaction not found",
            )
        return SessionInteractionResponse(count=1, interaction=interaction)

    @intercept_exceptions()
    async def respond_interaction(
        self,
        request: Request,
        interaction_id: UUID,
        body: SessionInteractionRespondRequest,
    ) -> SessionInteractionResponse:
        project_id: UUID = request.state.project_id
        user_id: UUID = request.state.user_id

        authorized = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        )
        if not authorized:
            raise FORBIDDEN_EXCEPTION

        try:
            interaction = await self.interactions_service.fetch_interaction(
                project_id=project_id,
                interaction_id=interaction_id,
            )
        except InteractionNotFound:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interaction not found",
            )

        if interaction.status and interaction.status.code != "pending":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Interaction is no longer pending",
            )

        answer = body.answer or {}

        # Respond is enqueued onto the interactions worker (detached, off the API request
        # thread): worker-interactions re-authorizes the stored refs at fire time and hands
        # the run to the runner without awaiting completion. Fall back to the inline blocking
        # invoke only when no worker is wired (keeps the route usable in minimal/test compositions).
        if self.respond_task is not None:
            await self.respond_task.kiq(
                project_id=str(project_id),
                user_id=str(user_id),
                interaction_id=str(interaction_id),
                answer=answer,
            )
        else:
            references = (
                {
                    k: v.model_dump(mode="json")
                    for k, v in interaction.data.references.items()
                }
                if interaction.data and interaction.data.references
                else None
            )
            selector = (
                interaction.data.selector.model_dump(mode="json")
                if interaction.data and interaction.data.selector
                else None
            )

            invoke_request = WorkflowServiceRequest(
                references=references,
                selector=selector,
                data=WorkflowServiceRequestData(inputs=answer),
            )

            await self.workflows_service.invoke_workflow(
                project_id=project_id,
                user_id=user_id,
                request=invoke_request,
            )

        # Mark it answered via the interactions API plane (distinct from a messages-plane
        # resolution). transition_interaction only flips a still-pending row; if a concurrent
        # messages-plane resolution already moved it off pending, the transition raises
        # InteractionNotFound and we keep the fetched interaction.
        try:
            interaction = await self.interactions_service.transition_interaction(
                transition=SessionInteractionTransition(
                    project_id=project_id,
                    session_id=interaction.session_id,
                    token=interaction.token,
                    status=SessionInteractionStatus.responded,
                ),
            )
        except InteractionNotFound:
            pass

        return SessionInteractionResponse(count=1, interaction=interaction)


class SessionMountsRouter:
    """Session-scoped view over mounts — /sessions/mounts/*.

    Thin: delegates to ``SessionMountsService`` (itself a wrapper over the
    full mounts domain). No mounts logic or storage lives here.
    """

    def __init__(self, *, session_mounts_service: SessionMountsService) -> None:
        self.session_mounts_service = session_mounts_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/mounts/",
            self.fetch_session_mounts,
            methods=["GET"],
            operation_id="fetch_session_mounts",
            response_model=SessionMountsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/mounts/query",
            self.query_session_mounts,
            methods=["POST"],
            operation_id="query_session_mounts",
            response_model=SessionMountsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )

    @intercept_exceptions()
    async def fetch_session_mounts(
        self,
        request: Request,
        *,
        session_id: str = Query(...),
        include_archived: bool = Query(default=False),
    ) -> SessionMountsResponse:
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        mounts = await self.session_mounts_service.query_mounts(
            project_id=UUID(request.state.project_id),
            mount_query=SessionMountQuery(
                session_id=session_id,
                include_archived=include_archived,
            ),
            windowing=None,
        )

        return SessionMountsResponse(count=len(mounts), mounts=mounts)

    @intercept_exceptions()
    async def query_session_mounts(
        self,
        request: Request,
        *,
        body: SessionMountQueryRequest,
        session_id: Optional[str] = Query(default=None),
        include_archived: bool = Query(default=False),
    ) -> SessionMountsResponse:
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        # session_id is required for the session-scoped view; query param wins, then body.
        resolved_session_id = session_id or (
            body.mount.session_id if body.mount else None
        )
        if not resolved_session_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="session_id is required for a session-scoped mounts query.",
            )

        mount_query = SessionMountQuery(
            session_id=resolved_session_id,
            include_archived=(
                include_archived
                or (body.mount.include_archived if body.mount else False)
            ),
        )

        mounts = await self.session_mounts_service.query_mounts(
            project_id=UUID(request.state.project_id),
            mount_query=mount_query,
            windowing=body.windowing,
        )

        return SessionMountsResponse(count=len(mounts), mounts=mounts)


# ---------------------------------------------------------------------------
# Top-level composer
# ---------------------------------------------------------------------------


class SessionsRouter:
    """Composes all session sub-domain routers into one object.

    The entrypoint mounts:
      sessions_router.streams.router               → no prefix (paths include /sessions/streams/…)
      sessions_router.states.router                → prefix /sessions
      sessions_router.records.router               → prefix /sessions/records
      sessions_router.interactions.router          → prefix /sessions/interactions
      sessions_router.mounts.router                → prefix /sessions
    """

    def __init__(
        self,
        *,
        streams_service: SessionStreamsService,
        states_service: SessionStatesService,
        records_service: RecordsService,
        interactions_service: SessionInteractionsService,
        workflows_service: WorkflowsService,
        session_mounts_service: SessionMountsService,
        respond_task: Optional[Any] = None,
    ) -> None:
        self.streams = SessionStreamsRouter(
            service=streams_service,
            interactions_service=interactions_service,
        )
        self.states = SessionStatesRouter(session_states_service=states_service)
        self.records = RecordsRouter(records_service=records_service)
        self.interactions = InteractionsRouter(
            interactions_service=interactions_service,
            workflows_service=workflows_service,
            respond_task=respond_task,
        )
        self.mounts = SessionMountsRouter(
            session_mounts_service=session_mounts_service,
        )

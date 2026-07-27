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

from fastapi import APIRouter, HTTPException, Query, Request, UploadFile, status
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
    SessionStreamQueryFlags,
)
from oss.src.core.sessions.streams.types import (
    ConcurrencyLimitExceeded,
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
from oss.src.core.mounts.service import MountsService
from oss.src.apis.fastapi.mounts.router import handle_mount_exceptions
from oss.src.apis.fastapi.mounts.utils import (
    download_mount_file,
    sign_mount_credentials,
    upload_mount_file,
)
from oss.src.apis.fastapi.mounts.models import (
    MountCredentialsResponse,
    MountFileWrittenResponse,
)
from oss.src.core.workflows.dtos import (
    WorkflowServiceRequest,
    WorkflowServiceRequestData,
)
from oss.src.core.workflows.service import WorkflowsService

from oss.src.apis.fastapi.sessions.models import (
    # streams
    SessionDetachRequestModel,
    SessionHeartbeatRequestModel,
    SessionHeartbeatResponseModel,
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

# matches the streams contract allowlist (dbs/redis/sessions/contract.py)
_SESSION_ID_RE = re.compile(r"^[a-zA-Z0-9_\-]{1,128}$")


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
            except ConcurrencyLimitExceeded as e:
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

        await self._service.check_runner_concurrency_limit(project_id=project_id)

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
        # kill orphans every pending gate — no one will answer them.
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
    ) -> SessionHeartbeatResponseModel:
        project_id = request.state.project_id
        user_id = request.state.user_id

        has_permission = await check_action_access(
            user_uid=str(user_id),
            project_id=str(project_id),
            permission=Permission.RUN_SESSIONS,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

        result = await self._service.heartbeat(
            project_id=project_id,
            request=SessionHeartbeatRequest(
                session_id=payload.session_id,
                replica_id=payload.replica_id,
                turn_id=payload.turn_id,
                is_running=payload.is_running,
            ),
        )
        return SessionHeartbeatResponseModel(
            stream=result.stream,
            replica_id=result.replica_id,
        )

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
                flags=SessionStreamQueryFlags(
                    is_alive=payload.is_alive,
                    is_running=payload.is_running,
                ),
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
            "/{record_id}",
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
        record_id: UUID,
    ) -> Union[SessionRecordResponse, JSONResponse]:
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        record = await self.records_service.get_event(
            project_id=UUID(request.state.project_id),
            record_id=record_id,
        )
        return SessionRecordResponse(record=record)

    @intercept_exceptions()
    async def ingest_record_event(
        self,
        request: Request,
        body: SessionRecordIngestRequest,
    ) -> dict:
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
                project_id=UUID(project_id),
                session_id=body.session_id,
                record_id=body.record_id,
                record_index=body.record_index,
                timestamp=body.timestamp,
                record_type=body.record_type,
                record_source=body.record_source,
                attributes=body.attributes,
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
                tags=body.tags,
                meta=body.meta,
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
            except_tokens=body.tokens,
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

        if (
            interaction.status
            and interaction.status != SessionInteractionStatus.pending
        ):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Interaction is no longer pending",
            )

        answer = body.answer or {}

        # CAS flips first: only the responder that wins the row enqueues, so
        # concurrent responds fire exactly once.
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
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Interaction is no longer pending",
            )

        # Enqueue onto the interactions worker when wired; otherwise fall back to an
        # inline blocking invoke (keeps the route usable in minimal/test compositions).
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
                session_id=interaction.session_id,
            )

            await self.workflows_service.invoke_workflow(
                project_id=project_id,
                user_id=user_id,
                request=invoke_request,
            )

        return SessionInteractionResponse(count=1, interaction=interaction)


class SessionMountsRouter:
    """Session-scoped view over mounts — /sessions/mounts/*.

    Thin: delegates to ``SessionMountsService`` (itself a wrapper over the
    full mounts domain). No mounts logic or storage lives here.
    """

    def __init__(
        self,
        *,
        session_mounts_service: SessionMountsService,
        mounts_service: MountsService,
    ) -> None:
        self.session_mounts_service = session_mounts_service
        self.mounts_service = mounts_service
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
        self.router.add_api_route(
            "/mounts/sign",
            self.sign_session_mount_credentials,
            methods=["POST"],
            operation_id="sign_session_mount_credentials",
            response_model=MountCredentialsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/mounts/{mount_id}/files/upload",
            self.upload_session_mount_file,
            methods=["POST"],
            operation_id="upload_session_mount_file",
            response_model=MountFileWrittenResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/mounts/{mount_id}/files/download",
            self.download_session_mount_file,
            methods=["GET"],
            operation_id="download_session_mount_file",
            response_model=None,
            status_code=status.HTTP_200_OK,
        )

    async def _check(self, request: Request, *permissions: Permission) -> None:
        # Session mounts sit in both domains: the caller needs the session AND mounts permission.
        for permission in permissions:
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=permission,
            ):
                raise FORBIDDEN_EXCEPTION

    @intercept_exceptions()
    async def fetch_session_mounts(
        self,
        request: Request,
        *,
        session_id: str = Query(...),
        include_archived: bool = Query(default=False),
    ) -> SessionMountsResponse:
        await self._check(request, Permission.VIEW_SESSIONS, Permission.VIEW_MOUNTS)

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
        await self._check(request, Permission.VIEW_SESSIONS, Permission.VIEW_MOUNTS)

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

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def sign_session_mount_credentials(
        self,
        request: Request,
        *,
        session_id: str = Query(...),
        name: str = Query(
            default="cwd",
            description=(
                "Which session-scoped mount to sign, e.g. 'cwd' (default) or a "
                "per-harness transcript dir mount (e.g. 'claude-projects', "
                "'pi-sessions'). Each name is its own mount row / durable prefix."
            ),
        ),
    ) -> MountCredentialsResponse:
        _validate_session_id_http(session_id)

        await self._check(request, Permission.RUN_SESSIONS, Permission.USE_MOUNTS)

        mount = await self.mounts_service.get_or_create_session_mount(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            session_id=session_id,
            name=name,
        )

        credentials = await sign_mount_credentials(
            mounts_service=self.mounts_service,
            project_id=UUID(request.state.project_id),
            mount_id=mount.id,
        )
        return MountCredentialsResponse(count=1, mount=mount, credentials=credentials)

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def upload_session_mount_file(
        self,
        request: Request,
        mount_id: UUID,
        *,
        file: UploadFile,
        path: Optional[str] = Query(default=None),
    ) -> MountFileWrittenResponse:
        await self._check(request, Permission.EDIT_SESSIONS, Permission.EDIT_MOUNTS)

        written = await upload_mount_file(
            mounts_service=self.mounts_service,
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            file=file,
            path=path,
        )
        return MountFileWrittenResponse(path=written.path, size=written.size)

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def download_session_mount_file(
        self,
        request: Request,
        mount_id: UUID,
        *,
        path: str = Query(...),
    ):
        await self._check(request, Permission.VIEW_SESSIONS, Permission.VIEW_MOUNTS)

        return await download_mount_file(
            mounts_service=self.mounts_service,
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            path=path,
        )


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
        mounts_service: MountsService,
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
            mounts_service=mounts_service,
        )

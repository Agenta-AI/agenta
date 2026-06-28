"""Unified sessions API router.

Composes four sub-domain routers:
  - SessionStreamsRouter  — /sessions/streams/* and /admin/sessions/streams/*
  - SessionStatesRouter  — /sessions/states/*
  - TranscriptsRouter    — /sessions/transcripts/*
  - InteractionsRouter   — /sessions/interactions/* and /admin/sessions/interactions/*
"""

import re
from functools import wraps
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse
from typing import Optional, Union

from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger

from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.permissions.service import check_action_access
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION

# Core domain imports — new paths
from oss.src.core.sessions.streams.dtos import (
    SessionHeartbeatRequest,
    SessionInvokeRequest,
    SessionStreamQuery,
)
from oss.src.core.sessions.streams.types import (
    ConcurrencyCapExceeded,
    SessionIdInvalid,
    SessionRunInUse,
    SessionStreamAlreadyExists,
    SessionStreamNotFound,
)
from oss.src.core.sessions.streams.service import SessionStreamsService
from oss.src.core.sessions.states.service import SessionStatesService
from oss.src.core.sessions.states.dtos import SessionStateUpsert
from oss.src.core.sessions.transcripts.service import TranscriptsService
from oss.src.core.sessions.transcripts.dtos import TranscriptEvent
from oss.src.core.sessions.transcripts.streaming import publish_transcript
from oss.src.core.sessions.interactions.service import InteractionsService
from oss.src.core.sessions.interactions.types import InteractionNotFound
from oss.src.core.sessions.mounts.service import SessionMountsService
from oss.src.core.workflows.dtos import (
    WorkflowServiceRequest,
    WorkflowServiceRequestData,
)
from oss.src.core.workflows.service import WorkflowsService

from oss.src.apis.fastapi.mounts.models import (
    MountQueryRequest,
    MountsResponse,
)
from oss.src.apis.fastapi.mounts.utils import merge_mount_query

from oss.src.apis.fastapi.sessions.models import (
    # streams
    SessionDetachRequestModel,
    SessionHeartbeatRequestModel,
    SessionInvokeRequestModel,
    SessionInvokeResponseModel,
    SessionLivenessResponseModel,
    SessionStreamQueryRequestModel,
    SessionStreamResponseModel,
    SessionStreamsResponseModel,
    # states
    SessionStateResponse,
    SessionStateSandboxIdUpsertRequest,
    SessionStateUpsertRequest,
    # transcripts
    TranscriptIngestRequest,
    TranscriptQueryRequest,
    TranscriptResponse,
    TranscriptsQueryResponse,
    # interactions
    InteractionCreateRequest,
    InteractionQueryRequest,
    InteractionRespondRequest,
    InteractionResponse,
    InteractionsResponse,
    InteractionTransitionRequest,
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


# ---------------------------------------------------------------------------
# Sub-routers
# ---------------------------------------------------------------------------


class SessionStreamsRouter:
    """Streams sub-router — /sessions/streams/* + /admin/sessions/streams/*"""

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


class SessionStatesRouter:
    """States sub-router — /sessions/states/*"""

    __test__ = False

    def __init__(self, *, session_states_service: SessionStatesService):
        self.session_states_service = session_states_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/states/{session_id}",
            self.get_session_state,
            methods=["GET"],
            operation_id="get_session_state",
            status_code=status.HTTP_200_OK,
            response_model=SessionStateResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/states/{session_id}",
            self.set_session_state,
            methods=["PUT"],
            operation_id="set_session_state",
            status_code=status.HTTP_200_OK,
            response_model=SessionStateResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/states/{session_id}/sandbox-id",
            self.set_sandbox_id,
            methods=["PUT"],
            operation_id="set_session_state_sandbox_id",
            status_code=status.HTTP_200_OK,
            response_model=SessionStateResponse,
            response_model_exclude_none=True,
        )

    @intercept_exceptions()
    async def get_session_state(
        self,
        request: Request,
        *,
        session_id: str,
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
        session_id: str,
        session_state_upsert_request: SessionStateUpsertRequest,
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
                data=session_state_upsert_request.data,
                sandbox_id=session_state_upsert_request.sandbox_id,
            ),
        )
        return SessionStateResponse(
            count=1 if session_state else 0,
            session_state=session_state,
        )

    @intercept_exceptions()
    async def set_sandbox_id(
        self,
        request: Request,
        *,
        session_id: str,
        session_state_sandbox_id_upsert_request: SessionStateSandboxIdUpsertRequest,
    ) -> SessionStateResponse:
        _validate_session_id_http(session_id)

        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        session_state = await self.session_states_service.set_sandbox_id(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            session_id=session_id,
            sandbox_id=session_state_sandbox_id_upsert_request.sandbox_id,
        )
        return SessionStateResponse(
            count=1 if session_state else 0,
            session_state=session_state,
        )


class TranscriptsRouter:
    """Transcripts sub-router — /sessions/transcripts/* + /admin/sessions/transcripts/*"""

    def __init__(self, transcripts_service: TranscriptsService):
        self.transcripts_service = transcripts_service
        self.router = APIRouter()
        self.admin_router = APIRouter()

        self.router.add_api_route(
            "/query",
            self.query_transcripts,
            methods=["POST"],
            operation_id="query_transcripts_rpc",
            status_code=status.HTTP_200_OK,
            response_model=TranscriptsQueryResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/{event_id}",
            self.get_transcript_event,
            methods=["GET"],
            operation_id="get_transcript_event",
            status_code=status.HTTP_200_OK,
            response_model=TranscriptResponse,
            response_model_exclude_none=True,
        )

        self.admin_router.add_api_route(
            "/ingest",
            self.ingest_transcript_event,
            methods=["POST"],
            operation_id="admin_sessions_transcripts_ingest",
            tags=["Sessions", "Admin"],
        )

    @intercept_exceptions()
    async def query_transcripts(
        self,
        request: Request,
        *,
        query_request: TranscriptQueryRequest,
    ) -> Union[TranscriptsQueryResponse, JSONResponse]:
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        transcripts = await self.transcripts_service.get_transcript(
            project_id=UUID(request.state.project_id),
            session_id=query_request.session_id,
        )
        return TranscriptsQueryResponse(
            count=len(transcripts),
            transcripts=transcripts,
        )

    @intercept_exceptions()
    async def get_transcript_event(
        self,
        request: Request,
        event_id: UUID,
    ) -> Union[TranscriptResponse, JSONResponse]:
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        transcript = await self.transcripts_service.get_event(
            project_id=UUID(request.state.project_id),
            event_id=event_id,
        )
        return TranscriptResponse(transcript=transcript)

    @intercept_exceptions()
    async def ingest_transcript_event(
        self,
        request: Request,
        body: TranscriptIngestRequest,
    ) -> dict:
        if not getattr(request.state, "admin", False):
            raise FORBIDDEN_EXCEPTION

        await publish_transcript(
            project_id=body.project_id,
            transcript_event=TranscriptEvent(
                session_id=body.session_id,
                project_id=body.project_id,
                event_index=body.event_index,
                sender=body.sender,
                session_update=body.session_update,
                payload=body.payload,
            ),
        )
        return {"ok": True}


class InteractionsRouter:
    """Interactions sub-router — /sessions/interactions/* + /admin/sessions/interactions/*"""

    def __init__(
        self,
        *,
        interactions_service: InteractionsService,
        workflows_service: WorkflowsService,
    ) -> None:
        self.interactions_service = interactions_service
        self.workflows_service = workflows_service

        self.router = APIRouter()
        self.admin_router = APIRouter()

        self.router.add_api_route(
            "/query",
            self.query_interactions,
            methods=["POST"],
            operation_id="query_interactions",
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

        self.admin_router.add_api_route(
            "/",
            self.create_interaction,
            methods=["POST"],
            operation_id="admin_create_interaction",
        )
        self.admin_router.add_api_route(
            "/transition",
            self.transition_interaction,
            methods=["POST"],
            operation_id="admin_transition_interaction",
        )

    @intercept_exceptions()
    async def create_interaction(
        self,
        request: Request,
        body: InteractionCreateRequest,
    ) -> InteractionResponse:
        if not getattr(request.state, "admin", False):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

        interaction = await self.interactions_service.create_interaction(
            project_id=body.interaction.project_id,
            interaction=body.interaction,
        )
        return InteractionResponse(count=1, interaction=interaction)

    @intercept_exceptions()
    async def transition_interaction(
        self,
        request: Request,
        body: InteractionTransitionRequest,
    ) -> InteractionResponse:
        if not getattr(request.state, "admin", False):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)

        try:
            interaction = await self.interactions_service.transition_interaction(
                transition=body.transition,
            )
        except InteractionNotFound:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Interaction not found or already terminal",
            )
        return InteractionResponse(count=1, interaction=interaction)

    @intercept_exceptions()
    async def query_interactions(
        self,
        request: Request,
        body: InteractionQueryRequest,
    ) -> InteractionsResponse:
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
        return InteractionsResponse(count=len(interactions), interactions=interactions)

    @intercept_exceptions()
    async def fetch_interaction(
        self,
        request: Request,
        interaction_id: UUID,
    ) -> InteractionResponse:
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
        return InteractionResponse(count=1, interaction=interaction)

    @intercept_exceptions()
    async def respond_interaction(
        self,
        request: Request,
        interaction_id: UUID,
        body: InteractionRespondRequest,
    ) -> InteractionResponse:
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
        answer = body.answer or {}

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

        return InteractionResponse(count=1, interaction=interaction)


class SessionMountsRouter:
    """Session-scoped view over mounts — /sessions/mounts/*.

    Thin: delegates to ``SessionMountsService`` (itself a wrapper over the
    full mounts domain). No mounts logic or storage lives here.
    """

    def __init__(self, *, session_mounts_service: SessionMountsService) -> None:
        self.session_mounts_service = session_mounts_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/mounts/query",
            self.query_session_mounts,
            methods=["POST"],
            operation_id="query_session_mounts",
            response_model=MountsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )

    @intercept_exceptions()
    async def query_session_mounts(
        self,
        request: Request,
        *,
        body: MountQueryRequest,
        session_id: Optional[str] = Query(default=None),
        include_archived: bool = Query(default=False),
    ) -> MountsResponse:
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_SESSIONS,
        ):
            raise FORBIDDEN_EXCEPTION

        mount_query = merge_mount_query(
            session_id=session_id,
            include_archived=include_archived,
            body_query=body.mount,
        )

        mounts = await self.session_mounts_service.query_mounts(
            project_id=UUID(request.state.project_id),
            mount_query=mount_query,
            windowing=body.windowing,
        )

        return MountsResponse(count=len(mounts), mounts=mounts)


# ---------------------------------------------------------------------------
# Top-level composer
# ---------------------------------------------------------------------------


class SessionsRouter:
    """Composes all session sub-domain routers into one object.

    The entrypoint mounts:
      sessions_router.streams.router               → no prefix (paths include /sessions/streams/…)
      sessions_router.streams.admin_router         → prefix /admin/sessions/streams
      sessions_router.states.router                → prefix /sessions
      sessions_router.transcripts.router           → prefix /sessions/transcripts
      sessions_router.transcripts.admin_router     → prefix /admin/sessions/transcripts
      sessions_router.interactions.router          → prefix /sessions/interactions
      sessions_router.interactions.admin_router    → prefix /admin/sessions/interactions
      sessions_router.mounts.router                → prefix /sessions
    """

    def __init__(
        self,
        *,
        streams_service: SessionStreamsService,
        states_service: SessionStatesService,
        transcripts_service: TranscriptsService,
        interactions_service: InteractionsService,
        workflows_service: WorkflowsService,
        session_mounts_service: SessionMountsService,
    ) -> None:
        self.streams = SessionStreamsRouter(service=streams_service)
        self.states = SessionStatesRouter(session_states_service=states_service)
        self.transcripts = TranscriptsRouter(transcripts_service=transcripts_service)
        self.interactions = InteractionsRouter(
            interactions_service=interactions_service,
            workflows_service=workflows_service,
        )
        self.mounts = SessionMountsRouter(
            session_mounts_service=session_mounts_service,
        )

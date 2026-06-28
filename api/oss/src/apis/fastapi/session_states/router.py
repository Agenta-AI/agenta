import re
from uuid import UUID

from fastapi import APIRouter, Request, status, HTTPException

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions

from oss.src.core.sessions.service import SessionStatesService
from oss.src.core.sessions.dtos import SessionStateUpsert

from oss.src.apis.fastapi.session_states.models import (
    SessionStateResponse,
    SessionStateUpsertRequest,
    SessionStateSandboxIdUpsertRequest,
)

from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.permissions.service import check_action_access
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION

log = get_module_logger(__name__)

# SEC-8: allow letters, digits, hyphens, underscores, dots — no slashes or control chars
_SESSION_ID_RE = re.compile(r"^[\w.\-]{1,256}$")


def _validate_session_id(session_id: str) -> None:
    if not _SESSION_ID_RE.match(session_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="session_id contains invalid characters or is empty.",
        )


class SessionStatesRouter:
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
        _validate_session_id(session_id)

        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_SESSIONS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

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
        _validate_session_id(session_id)

        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_SESSIONS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

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
        _validate_session_id(session_id)

        if not await check_action_access(  # type: ignore
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_SESSIONS,  # type: ignore
        ):
            raise FORBIDDEN_EXCEPTION  # type: ignore

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

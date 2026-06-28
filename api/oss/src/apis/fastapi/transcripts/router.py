from uuid import UUID
from typing import Union

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.core.transcripts.service import TranscriptsService
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.permissions.service import check_action_access

from oss.src.apis.fastapi.transcripts.models import (
    TranscriptQueryRequest,
    TranscriptsQueryResponse,
    TranscriptResponse,
)


log = get_module_logger(__name__)


class TranscriptsRouter:
    def __init__(self, transcripts_service: TranscriptsService):
        self.transcripts_service = transcripts_service

        self.router = APIRouter()

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

"""`/approval-choices`: a person's "always approve" for one of the builder's tools.

Every route acts for the signed-in person in the request's project; no body names a
person. A run credential and an API key are refused (`signed_in_person`).
"""

from typing import Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import Response

from oss.src.apis.fastapi.approval_choices.models import (
    ApprovalChoiceCreateRequest,
    ApprovalChoiceQueryRequest,
    ApprovalChoiceResponse,
    ApprovalChoicesResponse,
)
from oss.src.apis.fastapi.shared.personal import USER_REQUIRED_CODE, signed_in_person
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.approval_choices.dtos import ApprovalChoiceQuery
from oss.src.core.approval_choices.exceptions import ApprovalChoiceNotSupported
from oss.src.core.approval_choices.service import ApprovalChoicesService
from oss.src.utils.exceptions import intercept_exceptions


def _require_signed_in_person(request: Request) -> UUID:
    person: Optional[Tuple[UUID, UUID]] = signed_in_person(request)
    if person is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": USER_REQUIRED_CODE,
                "message": "Only you can manage your own approvals, signed in to the app.",
            },
        )
    return person[1]


class ApprovalChoicesRouter:
    def __init__(self, *, approval_choices_service: ApprovalChoicesService):
        self.approval_choices_service = approval_choices_service
        self.router = APIRouter()
        self.router.add_api_route(
            "/",
            self.create_approval_choice,
            methods=["POST"],
            operation_id="create_approval_choice",
            response_model=ApprovalChoiceResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/query",
            self.query_approval_choices,
            methods=["POST"],
            operation_id="query_approval_choices",
            response_model=ApprovalChoicesResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/{approval_choice_id}",
            self.delete_approval_choice,
            methods=["DELETE"],
            operation_id="delete_approval_choice",
            status_code=status.HTTP_204_NO_CONTENT,
        )

    @intercept_exceptions()
    async def create_approval_choice(
        self, request: Request, body: ApprovalChoiceCreateRequest
    ) -> ApprovalChoiceResponse:
        user_id = _require_signed_in_person(request)
        # A choice skips a card on a run of the builder, so the person must be able to
        # run sessions in the project.
        if not await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.RUN_SESSIONS,
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "access_denied",
                    "message": "You cannot run sessions in this project.",
                },
            )
        try:
            choice = await self.approval_choices_service.create(
                project_id=UUID(request.state.project_id),
                user_id=user_id,
                choice=body.approval_choice,
            )
        except ApprovalChoiceNotSupported as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": error.code, "message": error.message},
            ) from None
        return ApprovalChoiceResponse(count=1, approval_choice=choice)

    @intercept_exceptions()
    async def query_approval_choices(
        self, request: Request, body: Optional[ApprovalChoiceQueryRequest] = None
    ) -> ApprovalChoicesResponse:
        user_id = _require_signed_in_person(request)
        body = body or ApprovalChoiceQueryRequest()
        choices = await self.approval_choices_service.query(
            project_id=UUID(request.state.project_id),
            user_id=user_id,
            query=body.approval_choice or ApprovalChoiceQuery(),
        )
        return ApprovalChoicesResponse(count=len(choices), approval_choices=choices)

    @intercept_exceptions()
    async def delete_approval_choice(
        self, request: Request, approval_choice_id: UUID
    ) -> Response:
        user_id = _require_signed_in_person(request)
        await self.approval_choices_service.delete(
            project_id=UUID(request.state.project_id),
            user_id=user_id,
            approval_choice_id=approval_choice_id,
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

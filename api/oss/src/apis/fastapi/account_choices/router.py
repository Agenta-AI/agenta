"""`/account-choices`: a person's choice of their own account for a "user" item of an
agent, and the resolved view of every "user" item for the caller.

Every route acts for the caller in the request's project; no body names a person. Every
route needs a signed-in person and the deployment switch (`require_person`). Upsert and
resolve also need that the caller may run the agent.
"""

from functools import wraps
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import Response

from agenta.sdk.agents.accounts import read_user_items

from oss.src.apis.fastapi.account_choices.models import (
    AccountChoiceQueryRequest,
    AccountChoiceResponse,
    AccountChoicesResolveRequest,
    AccountChoicesResponse,
    AccountChoiceUpsertRequest,
    ItemAccountsResponse,
)
from oss.src.apis.fastapi.shared.personal import require_person
from oss.src.apis.fastapi.sharing.utils import allow_agent, artifact_id_of
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.account_choices.dtos import AccountChoiceQuery
from oss.src.core.account_choices.exceptions import AccountChoicesError
from oss.src.core.account_choices.items import user_items_of_revision
from oss.src.core.account_choices.service import AccountChoicesService
from oss.src.utils.exceptions import intercept_exceptions

_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail={"code": "not_found", "message": "Agent not found."},
)


def _handle_account_choice_errors(func):
    @wraps(func)
    async def wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except AccountChoicesError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": error.code, "message": error.message},
            ) from None

    return wrapper


async def _require_may_run_agent(request: Request, workflow_id: UUID) -> None:
    """`RUN_SESSIONS` on the project and the agent's sharing rule. A hidden or unknown
    agent answers 404."""
    if not await check_action_access(
        user_uid=request.state.user_id,
        project_id=request.state.project_id,
        permission=Permission.RUN_SESSIONS,
    ):
        raise _NOT_FOUND
    if not await allow_agent(
        request, action=Permission.RUN_SESSIONS, artifact_id=workflow_id
    ):
        raise _NOT_FOUND


class AccountChoicesRouter:
    def __init__(
        self, *, account_choices_service: AccountChoicesService, workflows_service
    ):
        self.account_choices_service = account_choices_service
        self.workflows_service = workflows_service
        self.router = APIRouter()
        self.router.add_api_route(
            "/",
            self.upsert_account_choice,
            methods=["POST"],
            operation_id="upsert_account_choice",
            response_model=AccountChoiceResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/query",
            self.query_account_choices,
            methods=["POST"],
            operation_id="query_account_choices",
            response_model=AccountChoicesResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/resolve",
            self.resolve_account_choices,
            methods=["POST"],
            operation_id="resolve_account_choices",
            response_model=ItemAccountsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/{account_choice_id}",
            self.fetch_account_choice,
            methods=["GET"],
            operation_id="fetch_account_choice",
            response_model=AccountChoiceResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/{account_choice_id}",
            self.delete_account_choice,
            methods=["DELETE"],
            operation_id="delete_account_choice",
            status_code=status.HTTP_204_NO_CONTENT,
        )

    @intercept_exceptions()
    @_handle_account_choice_errors
    async def upsert_account_choice(
        self, request: Request, body: AccountChoiceUpsertRequest
    ) -> AccountChoiceResponse:
        organization_id, user_id = require_person(request)
        await _require_may_run_agent(request, body.account_choice.workflow_id)
        choice = await self.account_choices_service.upsert(
            organization_id=organization_id,
            project_id=UUID(request.state.project_id),
            user_id=user_id,
            choice=body.account_choice,
        )
        return AccountChoiceResponse(count=1, account_choice=choice)

    @intercept_exceptions()
    async def fetch_account_choice(
        self, request: Request, account_choice_id: UUID
    ) -> AccountChoiceResponse:
        _, user_id = require_person(request)
        choice = await self.account_choices_service.fetch(
            project_id=UUID(request.state.project_id),
            user_id=user_id,
            account_choice_id=account_choice_id,
        )
        return AccountChoiceResponse(count=1 if choice else 0, account_choice=choice)

    @intercept_exceptions()
    async def query_account_choices(
        self, request: Request, body: Optional[AccountChoiceQueryRequest] = None
    ) -> AccountChoicesResponse:
        _, user_id = require_person(request)
        body = body or AccountChoiceQueryRequest()
        choices = await self.account_choices_service.query(
            project_id=UUID(request.state.project_id),
            user_id=user_id,
            query=body.account_choice or AccountChoiceQuery(),
            windowing=body.windowing,
        )
        return AccountChoicesResponse(count=len(choices), account_choices=choices)

    @intercept_exceptions()
    async def delete_account_choice(
        self, request: Request, account_choice_id: UUID
    ) -> Response:
        _, user_id = require_person(request)
        await self.account_choices_service.delete(
            project_id=UUID(request.state.project_id),
            user_id=user_id,
            account_choice_id=account_choice_id,
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @intercept_exceptions()
    async def resolve_account_choices(
        self, request: Request, body: AccountChoicesResolveRequest
    ) -> ItemAccountsResponse:
        """Every "user" item of the agent (a saved revision, or a draft configuration),
        resolved for the caller with the same rules as a run. Never writes."""
        organization_id, user_id = require_person(request)
        await _require_may_run_agent(request, body.workflow_id)
        project_id = UUID(request.state.project_id)
        if body.workflow_revision_ref is not None:
            revision = await self.workflows_service.fetch_workflow_revision(
                project_id=project_id,
                workflow_revision_ref=body.workflow_revision_ref,
            )
            if revision is None or artifact_id_of(revision) != body.workflow_id:
                raise _NOT_FOUND
            items = user_items_of_revision(revision.data)
        else:
            items = read_user_items(body.parameters)
        item_accounts = await self.account_choices_service.resolve(
            organization_id=organization_id,
            project_id=project_id,
            artifact_id=body.workflow_id,
            # A person route: the caller is the run person (`require_person` holds).
            user_id=user_id,
            items=items,
        )
        return ItemAccountsResponse(
            count=len(item_accounts), item_accounts=item_accounts
        )

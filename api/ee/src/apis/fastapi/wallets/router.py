"""The wallet's read routes: what the caller's organization holds and what it spent.

Mounted only while the wallet is on, so with the flag off every route here is a 404.

Both routes answer for the whole organization while the permission check reads one project.
The summary is balances only, like the billing routes, so `VIEW_BILLING` gates it. The usage
detail names users and spans every project, so it takes `EDIT_BILLING`, which only the
organization owner holds by default.
"""

from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.utils.context import get_auth_scope
from oss.src.utils.exceptions import BadRequestException, intercept_exceptions

from ee.src.apis.fastapi.wallets.models import (
    WalletSummaryResponse,
    WalletUsageQueryRequest,
    WalletUsageResponse,
)
from ee.src.core.wallets.errors import InvalidUsageWindowError
from ee.src.core.wallets.usage.service import WalletUsageService

FORBIDDEN_RESPONSE = JSONResponse(
    status_code=403,
    content={"detail": "You do not have access to this organization's usage."},
)


class WalletsRouter:
    def __init__(self, *, wallet_usage_service: WalletUsageService):
        self.service = wallet_usage_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/summary",
            self.fetch_summary,
            methods=["GET"],
            operation_id="fetch_wallet_summary",
            response_model=WalletSummaryResponse,
        )
        self.router.add_api_route(
            "/usage/query",
            self.query_usage,
            methods=["POST"],
            operation_id="query_wallet_usage",
            response_model=WalletUsageResponse,
        )

    async def _allowed(self, request: Request, permission: Permission) -> bool:
        return await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=permission,
        )

    @intercept_exceptions()
    async def fetch_summary(self, request: Request):
        if not await self._allowed(request, Permission.VIEW_BILLING):
            return FORBIDDEN_RESPONSE
        summary = await self.service.summary(
            organization_id=get_auth_scope().organization_id
        )
        return WalletSummaryResponse(summary=summary)

    @intercept_exceptions()
    async def query_usage(
        self,
        request: Request,
        body: Optional[WalletUsageQueryRequest] = None,
    ):
        if not await self._allowed(request, Permission.EDIT_BILLING):
            return FORBIDDEN_RESPONSE
        body = body or WalletUsageQueryRequest()
        try:
            usage = await self.service.usage(
                organization_id=get_auth_scope().organization_id,
                start=body.start,
                end=body.end,
            )
        except InvalidUsageWindowError as e:
            raise BadRequestException(message=str(e)) from e
        return WalletUsageResponse(usage=usage)

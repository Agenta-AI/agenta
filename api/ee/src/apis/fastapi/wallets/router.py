"""The wallet's routes: what the caller's organization holds and what it spent, and the
runner's sandbox admission and usage reports.

Mounted only while the wallet is on, so with the flag off every route here is a 404, and
the runner reads that 404 as "sandboxes are not metered here".
"""

from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.utils.context import get_auth_scope
from oss.src.utils.exceptions import intercept_exceptions

from ee.src.apis.fastapi.wallets.models import (
    SandboxAdmissionResponse,
    SandboxUsageRecordResponse,
    WalletSummaryResponse,
    WalletUsageQueryRequest,
    WalletUsageResponse,
)
from ee.src.core.measurements.sandboxes import (
    SandboxIntervalInvalidError,
    SandboxUsageInterval,
    SandboxUsageNotRecordedError,
    SandboxUsageService,
)
from ee.src.core.wallets.usage.service import WalletUsageService

FORBIDDEN_RESPONSE = JSONResponse(
    status_code=403,
    content={"detail": "You do not have access to this organization's usage."},
)


class WalletsRouter:
    def __init__(
        self,
        *,
        wallet_usage_service: WalletUsageService,
        sandbox_usage_service: SandboxUsageService,
    ):
        self.service = wallet_usage_service
        self.sandbox_usage_service = sandbox_usage_service
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
        # Called by the runner with the run's own credential. No permission beyond it:
        # the organization is the credential's, so a report can only charge the caller.
        self.router.add_api_route(
            "/sandboxes/admit",
            self.admit_sandbox,
            methods=["POST"],
            operation_id="admit_wallet_sandbox",
            response_model=SandboxAdmissionResponse,
            include_in_schema=False,
        )
        self.router.add_api_route(
            "/sandboxes/usage",
            self.record_sandbox_usage,
            methods=["POST"],
            operation_id="record_wallet_sandbox_usage",
            response_model=SandboxUsageRecordResponse,
            include_in_schema=False,
        )

    async def _allowed(self, request: Request) -> bool:
        return await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_BILLING,
        )

    @intercept_exceptions()
    async def fetch_summary(self, request: Request):
        if not await self._allowed(request):
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
        if not await self._allowed(request):
            return FORBIDDEN_RESPONSE
        body = body or WalletUsageQueryRequest()
        usage = await self.service.usage(
            organization_id=get_auth_scope().organization_id,
            start=body.start,
            end=body.end,
        )
        return WalletUsageResponse(usage=usage)

    @intercept_exceptions()
    async def admit_sandbox(self, request: Request):
        allowed = await self.sandbox_usage_service.admit(scope=get_auth_scope())
        return SandboxAdmissionResponse(allowed=allowed)

    @intercept_exceptions()
    async def record_sandbox_usage(
        self,
        request: Request,
        body: SandboxUsageInterval,
    ):
        try:
            measurement_id = await self.sandbox_usage_service.record(
                scope=get_auth_scope(), interval=body
            )
        except SandboxIntervalInvalidError as e:
            return JSONResponse(status_code=422, content={"detail": e.message})
        except SandboxUsageNotRecordedError as e:
            return JSONResponse(status_code=503, content={"detail": e.message})
        return SandboxUsageRecordResponse(measurement_id=measurement_id)

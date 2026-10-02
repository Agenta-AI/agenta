"""The wallet's routes: what the caller's organization holds and what it spent, and the
runner's sandbox admission and usage reports.

Mounted only while the wallet is on, so with the flag off every route here is a 404. The
runner is told the same switch (`AGENTA_WALLETS_ENABLED`) and does not call them then.

The two read routes answer for the whole organization while the permission check reads one
project. The summary is balances only, like the billing routes, so `VIEW_BILLING` gates it.
The usage detail names users and spans every project, so it takes `EDIT_BILLING`, which only
the organization owner holds by default.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response

from oss.src.apis.fastapi.shared.runner_auth import assert_runner_token
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.rollout.switches import wallet_mode_for
from oss.src.core.access.permissions.types import Permission
from oss.src.utils.context import get_auth_scope
from oss.src.utils.exceptions import BadRequestException, intercept_exceptions

from ee.src.apis.fastapi.wallets.models import (
    SandboxAdmissionRequest,
    SandboxAdmissionResponse,
    SandboxTurnLimit,
    SandboxTurnRequest,
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
from ee.src.core.wallets.errors import InvalidUsageWindowError
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
        # Runner-only: the runner token proves the platform's runner is reporting a sandbox
        # it runs on the platform's account, and the run's own credential names the payer.
        # A tenant credential alone would let any member charge its organization for
        # sandboxes that never ran.
        self.router.add_api_route(
            "/sandboxes/admit",
            self.admit_sandbox,
            methods=["POST"],
            operation_id="admit_wallet_sandbox",
            response_model=SandboxAdmissionResponse,
            include_in_schema=False,
            dependencies=[Depends(assert_runner_token)],
        )
        self.router.add_api_route(
            "/sandboxes/turns/heartbeat",
            self.renew_sandbox_turn,
            methods=["POST"],
            operation_id="renew_wallet_sandbox_turn",
            status_code=204,
            include_in_schema=False,
            dependencies=[Depends(assert_runner_token)],
        )
        self.router.add_api_route(
            "/sandboxes/turns/release",
            self.release_sandbox_turn,
            methods=["POST"],
            operation_id="release_wallet_sandbox_turn",
            status_code=204,
            include_in_schema=False,
            dependencies=[Depends(assert_runner_token)],
        )
        self.router.add_api_route(
            "/sandboxes/usage",
            self.record_sandbox_usage,
            methods=["POST"],
            operation_id="record_wallet_sandbox_usage",
            response_model=SandboxUsageRecordResponse,
            include_in_schema=False,
            dependencies=[Depends(assert_runner_token)],
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
        organization_id = get_auth_scope().organization_id
        summary = await self.service.summary(organization_id=organization_id)
        mode = await wallet_mode_for(organization_id)
        return WalletSummaryResponse(summary=summary, mode=mode.value)

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

    @intercept_exceptions()
    async def admit_sandbox(
        self,
        request: Request,
        body: Optional[SandboxAdmissionRequest] = None,
    ):
        admission = await self.sandbox_usage_service.admit(
            scope=get_auth_scope(), turn_id=body.turn_id if body else None
        )
        return SandboxAdmissionResponse(
            allowed=admission.allowed,
            code=admission.code,
            message=admission.message,
            turn_limit=(
                SandboxTurnLimit(
                    seconds=admission.turn_limit.seconds,
                    message=admission.turn_limit.message,
                )
                if admission.turn_limit
                else None
            ),
            slot_held=admission.slot_held,
        )

    @intercept_exceptions()
    async def renew_sandbox_turn(self, request: Request, body: SandboxTurnRequest):
        await self.sandbox_usage_service.renew_turn(
            scope=get_auth_scope(), turn_id=body.turn_id
        )
        return Response(status_code=204)

    @intercept_exceptions()
    async def release_sandbox_turn(self, request: Request, body: SandboxTurnRequest):
        await self.sandbox_usage_service.release_turn(
            scope=get_auth_scope(), turn_id=body.turn_id
        )
        return Response(status_code=204)

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

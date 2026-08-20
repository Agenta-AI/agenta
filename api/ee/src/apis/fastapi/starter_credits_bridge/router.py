"""Admin entry point for starter-credits-bridge reconciliation.

Mounted at ``/admin/starter-credits`` (platform operators only). Repairs the
partial seed states of one organization: orphaned key without a vault row,
or vault row without a key.
"""

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from oss.src.utils.exceptions import intercept_exceptions

from ee.src.core.starter_credits_bridge.service import (
    reconcile_starter_credits_bridge,
)


class StarterCreditsReconcileRequest(BaseModel):
    organization_id: str


class StarterCreditsBridgeAdminRouter:
    def __init__(self):
        self.admin_router = APIRouter()

        self.admin_router.add_api_route(
            "/reconcile",
            self.reconcile,
            methods=["POST"],
        )

    @intercept_exceptions()
    async def reconcile(self, request_body: StarterCreditsReconcileRequest):
        outcome = await reconcile_starter_credits_bridge(
            organization_id=request_body.organization_id,
        )
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"outcome": outcome},
        )

"""Sandbox metering ingestion routes.

Public (unauthenticated) webhook receiver for E2B events.
Admin-only endpoint to trigger a Daytona usage poll on-demand.
"""

import math
from typing import Optional

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.common import is_ee

from ee.src.core.sandboxes.service import SandboxMeteringService
from ee.src.core.sandboxes.dtos import SandboxUsageDTO
from ee.src.core.sandboxes.exceptions import SandboxWebhookSignatureError
from ee.src.apis.fastapi.sandboxes.models import DaytonaPollRequest

log = get_module_logger(__name__)

_GIB = 1024.0 * 1024.0 * 1024.0


def _mb_ms_to_gib_seconds(memory_mb: Optional[int], duration_ms: Optional[int]) -> int:
    """Convert memory_mb × duration_ms to GiB-seconds (ceiling)."""
    if not memory_mb or not duration_ms:
        return 0
    gib = memory_mb / 1024.0
    seconds = duration_ms / 1000.0
    return max(1, math.ceil(gib * seconds))


def _vcpu_ms_to_vcpu_seconds(vcpu: Optional[int], duration_ms: Optional[int]) -> int:
    """Convert vCPU count × duration_ms to vCPU-seconds (ceiling)."""
    if not vcpu or not duration_ms:
        return 0
    return max(1, math.ceil(vcpu * duration_ms / 1000.0))


class SandboxMeteringRouter:
    def __init__(self, *, sandboxes_service: SandboxMeteringService):
        self.service = sandboxes_service

        # Public webhook receiver (no auth — verified by HMAC).
        self.router = APIRouter()
        self.router.add_api_route(
            "/e2b/events/",
            self.receive_e2b_event,
            methods=["POST"],
            operation_id="sandboxes_e2b_event",
            include_in_schema=False,
        )

        # Admin-only routes.
        self.admin_router = APIRouter()
        self.admin_router.add_api_route(
            "/daytona/poll",
            self.trigger_daytona_poll,
            methods=["POST"],
            operation_id="sandboxes_daytona_poll",
        )

    @intercept_exceptions()
    async def receive_e2b_event(self, request: Request):
        """Receive and verify an E2B sandbox lifecycle webhook event."""
        if not is_ee() or not env.e2b.enabled:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={"status": "disabled"},
            )

        raw_body = await request.body()
        signature = request.headers.get("e2b-signature", "")
        delivery_id = request.headers.get("e2b-delivery-id", "")

        # HMAC verification against env.e2b.webhook_secret.
        if not self.service.verify_e2b_signature(
            raw_body=raw_body,
            signature_header=signature,
        ):
            log.warning(
                "[sandboxes] E2B HMAC verification failed delivery_id=%s sig=%r",
                delivery_id,
                signature[:32],
            )
            raise SandboxWebhookSignatureError()

        # Parse payload (loose — log raw on unknown events for issue #1103 debugging).
        try:
            import json as _json

            payload = _json.loads(raw_body)
        except Exception:
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"status": "invalid_json"},
            )

        log.debug(
            "[sandboxes] E2B event delivery_id=%s payload=%s",
            delivery_id,
            payload,
        )

        event_type = payload.get("event", "")
        sandbox_id = payload.get("sandbox_id") or payload.get("id") or "unknown"
        team_id = payload.get("team_id", "")
        vcpu = payload.get("vcpu")
        memory_mb = payload.get("memory_mb")
        duration_ms = payload.get("duration_ms")

        # Only billing-relevant events carry resource usage.
        billable_events = {"sandbox.killed", "sandbox.paused", "sandbox.checkpointed"}
        if event_type not in billable_events:
            return JSONResponse(
                status_code=status.HTTP_202_ACCEPTED,
                content={"status": "accepted", "metered": False},
            )

        # Map team_id → organization_id.
        # Phase 1: expect team_id to be set to the Agenta organization UUID.
        # Phase 2 will add a proper lookup table.
        from uuid import UUID as _UUID

        try:
            org_id = _UUID(team_id)
        except (ValueError, TypeError):
            log.warning(
                "[sandboxes] E2B team_id is not a valid UUID: %r — skipping metering",
                team_id,
            )
            return JSONResponse(
                status_code=status.HTTP_202_ACCEPTED,
                content={
                    "status": "accepted",
                    "metered": False,
                    "reason": "team_id_not_uuid",
                },
            )

        usage = SandboxUsageDTO(
            organization_id=org_id,
            provider="e2b",
            sandbox_id=sandbox_id,
            vcpu_seconds=_vcpu_ms_to_vcpu_seconds(vcpu, duration_ms),
            ram_gib_seconds=_mb_ms_to_gib_seconds(memory_mb, duration_ms),
            disk_gib_seconds=0,  # E2B doesn't report disk per event
            gpu_seconds=0,
            delivery_id=delivery_id,
        )

        result = await self.service.record_usage(usage)

        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content={"status": "accepted", "metered": result.accepted},
        )

    @intercept_exceptions()
    async def trigger_daytona_poll(self, body: DaytonaPollRequest):
        """Admin endpoint to trigger an on-demand Daytona usage poll."""
        if not is_ee() or not env.daytona.enabled:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={"status": "disabled"},
            )

        ran = await self.service.run_daytona_poll(
            org_id=body.organization_id,
            api_key=env.daytona.api_key,
            analytics_url=env.daytona.analytics_url,
            daytona_organization_id=env.daytona.organization_id,
            period_start=body.period_start,
            period_end=body.period_end,
        )

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"status": "ran" if ran else "skipped"},
        )

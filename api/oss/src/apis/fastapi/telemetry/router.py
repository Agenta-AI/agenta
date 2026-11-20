"""`/instance/telemetry`: whether the browser sends product events, and the identity
it sends them under, computed by the API so the browser and the API always agree."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from oss.src.apis.fastapi.telemetry.models import InstanceTelemetryResponse
from oss.src.core.telemetry.service import instance_telemetry_for
from oss.src.utils.exceptions import intercept_exceptions


class TelemetryRouter:
    def __init__(self):
        self.router = APIRouter()
        self.router.add_api_route(
            "/telemetry",
            self.fetch_instance_telemetry,
            methods=["GET"],
            operation_id="fetch_instance_telemetry",
            response_model=InstanceTelemetryResponse,
        )

    @intercept_exceptions()
    async def fetch_instance_telemetry(
        self, request: Request
    ) -> InstanceTelemetryResponse:
        user_id = getattr(request.state, "user_id", None)
        email = getattr(request.state, "user_email", None)
        if not user_id or not email:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
        telemetry = await instance_telemetry_for(UUID(str(user_id)), email)
        return InstanceTelemetryResponse(**telemetry.model_dump())

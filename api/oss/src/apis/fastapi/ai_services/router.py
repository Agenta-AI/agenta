from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import ValidationError

from oss.src.utils.exceptions import intercept_exceptions

from oss.src.core.ai_services.dtos import AIServicesUnknownToolError
from oss.src.core.ai_services.service import AIServicesService
from oss.src.apis.fastapi.ai_services.models import (
    AIServicesStatusResponse,
    ToolCallRequestModel,
    ToolCallResponseModel,
)


class AIServicesRouter:
    def __init__(
        self,
        *,
        ai_services_service: AIServicesService,
    ):
        self.service = ai_services_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/status",
            self.get_status,
            methods=["GET"],
            operation_id="ai_services_status",
            status_code=status.HTTP_200_OK,
            response_model=AIServicesStatusResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/tools/call",
            self.call_tool,
            methods=["POST"],
            operation_id="ai_services_tools_call",
            status_code=status.HTTP_200_OK,
            response_model=ToolCallResponseModel,
            response_model_exclude_none=True,
        )

    @intercept_exceptions()
    async def get_status(self) -> AIServicesStatusResponse:
        # TODO: Access control should be org-level feature flag (org owner
        # enables/disables AI services for the whole org) rather than
        # per-user permissions.  For now, env-var gating is sufficient.
        return self.service.status()

    @intercept_exceptions()
    async def call_tool(
        self,
        *,
        tool_call: ToolCallRequestModel,
    ) -> ToolCallResponseModel:
        if not self.service.enabled:
            raise HTTPException(status_code=503, detail="AI services are disabled")

        # TODO: Access control should be org-level feature flag (org owner
        # enables/disables AI services for the whole org) rather than
        # per-user permissions.  For now, env-var gating is sufficient.

        try:
            return await self.service.call_tool(
                name=tool_call.name,
                arguments=tool_call.arguments,
            )
        except AIServicesUnknownToolError as e:
            raise HTTPException(status_code=400, detail=e.message) from e
        except ValidationError as e:
            raise HTTPException(status_code=400, detail=e.errors()) from e

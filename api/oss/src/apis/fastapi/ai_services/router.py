from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import ValidationError

from oss.src.utils.common import is_ee
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.throttling import check_throttle

from oss.src.core.ai_services.dtos import TOOL_REFINE_PROMPT
from oss.src.core.ai_services.service import AIServicesService
from oss.src.apis.fastapi.ai_services.models import (
    AIServicesStatusResponse,
    ToolCallRequestModel,
    ToolCallResponseModel,
)


if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


_RATE_LIMIT_BURST = 10
_RATE_LIMIT_PER_MIN = 30


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
    async def get_status(self, request: Request) -> AIServicesStatusResponse:
        allow_tools = True

        if is_ee():
            allow_tools = await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            )

        return self.service.status(allow_tools=allow_tools)

    @intercept_exceptions()
    async def call_tool(
        self,
        request: Request,
        *,
        tool_call: ToolCallRequestModel,
    ) -> ToolCallResponseModel:
        if not self.service.enabled:
            raise HTTPException(status_code=503, detail="AI services are disabled")

        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        # Router-level rate limit
        key = {
            "ep": "ai_services",
            "tool": tool_call.name,
            "org": getattr(request.state, "organization_id", None),
            "user": getattr(request.state, "user_id", None),
        }
        result = await check_throttle(
            key,
            max_capacity=_RATE_LIMIT_BURST,
            refill_rate=_RATE_LIMIT_PER_MIN,
        )
        if not result.allow:
            retry_after = (
                int(result.retry_after_seconds) if result.retry_after_seconds else 1
            )
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded",
                headers={"Retry-After": str(retry_after)},
            )

        # Tool routing + strict request validation
        if tool_call.name != TOOL_REFINE_PROMPT:
            raise HTTPException(status_code=400, detail="Unknown tool")

        try:
            return await self.service.call_tool(
                name=tool_call.name,
                arguments=tool_call.arguments,
            )
        except ValidationError as e:
            raise HTTPException(status_code=400, detail=e.errors()) from e
        except ValueError as e:
            # Unknown tool or invalid argument shape
            raise HTTPException(status_code=400, detail=str(e)) from e

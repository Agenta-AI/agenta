from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import JSONResponse

from oss.src.apis.fastapi.providers.models import (
    ProbeProviderRequest,
    ProbeProviderResponse,
)
from oss.src.apis.fastapi.vault.router import SecretSafeRoute
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.providers.exceptions import ProviderProbeError
from oss.src.core.providers.service import ProviderProbeService
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


class ProvidersRouter:
    """Credential test and model discovery for a provider connection.

    Shares the vault router's `SecretSafeRoute`: the probe body IS a credential, so a
    validation error on this route must not echo what the caller sent.
    """

    def __init__(
        self,
        provider_probe_service: ProviderProbeService,
    ):
        self.service = provider_probe_service

        self.router = APIRouter(route_class=SecretSafeRoute)

        self.router.add_api_route(
            "/providers/probe",
            self.probe_provider,
            methods=["POST"],
            operation_id="probe_provider",
            response_model=ProbeProviderResponse,
        )

    @intercept_exceptions()
    async def probe_provider(self, request: Request, body: ProbeProviderRequest):
        # EDIT_SECRET, not VIEW_SECRET: a probe spends a caller-supplied credential on an
        # outbound request, so it belongs to whoever may change the connection.
        has_permission = await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(request.state.project_id),
            permission=Permission.EDIT_SECRET,
        )

        if not has_permission:
            error_msg = "You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

        try:
            return await self.service.probe(
                kind=body.kind,
                credentials=body.provider,
            )
        except ProviderProbeError as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=e.message,
            ) from None

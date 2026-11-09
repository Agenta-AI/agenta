"""`/instance/license`: the license of a self-hosted instance, for its instance admin.

The key check and the plan order are enterprise code, so on the OSS image `GET` reports
the community plan and `PUT` is not registered. A deployment with Stripe (cloud) takes
its plans from Stripe and has no instance license.
"""

from fastapi import APIRouter, HTTPException, Request, status

from oss.src.apis.fastapi.licenses.models import (
    InstanceLicenseActivateRequest,
    InstanceLicenseKey,
    InstanceLicenseResponse,
    InstanceLicenseUsage,
    InstanceRegistrationRequest,
    InstanceRegistrationResponse,
)
from oss.src.core.access.context import get_request_access
from oss.src.core.access.dtos import PrincipalKind, RequestCredentialKind
from oss.src.core.licenses.admins import count_users, is_instance_admin
from oss.src.core.licenses.registrations import (
    RegistrationFailed,
    request_registration,
)
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.src.utils.exceptions import intercept_exceptions

COMMUNITY_PLAN = "self_hosted_community"

_NOT_AVAILABLE = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="This deployment has no instance license.",
)
_NOT_INSTANCE_ADMIN = HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="Only an instance admin can manage the license.",
)


async def require_instance_admin() -> None:
    """A signed-in person in the browser, acting as themselves, who is the instance
    admin. API keys and run credentials are refused, as for organization admin work."""
    access = get_request_access()
    if (
        access is None
        or access.credential_kind != RequestCredentialKind.BEARER_SESSION
        or access.envelope is not None
        or access.principal.kind != PrincipalKind.HUMAN
        or access.principal.id != access.acting_user_id
    ):
        raise _NOT_INSTANCE_ADMIN
    if not await is_instance_admin(access.principal.id):
        raise _NOT_INSTANCE_ADMIN


class LicensesRouter:
    def __init__(self):
        self.router = APIRouter()

        self.router.add_api_route(
            "/license",
            self.fetch_instance_license,
            methods=["GET"],
            operation_id="fetch_instance_license",
            status_code=status.HTTP_200_OK,
            response_model=InstanceLicenseResponse,
        )

        self.router.add_api_route(
            "/license/registrations",
            self.create_instance_registration,
            methods=["POST"],
            operation_id="create_instance_registration",
            status_code=status.HTTP_202_ACCEPTED,
            response_model=InstanceRegistrationResponse,
        )

        if is_ee():
            self.router.add_api_route(
                "/license",
                self.activate_instance_license,
                methods=["PUT"],
                operation_id="activate_instance_license",
                status_code=status.HTTP_200_OK,
                response_model=InstanceLicenseResponse,
            )

    @intercept_exceptions()
    async def fetch_instance_license(self, request: Request) -> InstanceLicenseResponse:
        if env.stripe.enabled:
            raise _NOT_AVAILABLE
        await require_instance_admin()

        if not is_ee():
            return InstanceLicenseResponse(
                plan=COMMUNITY_PLAN,
                usage=InstanceLicenseUsage(users=await count_users()),
            )

        from ee.src.core.licenses.service import (  # noqa: PLC0415
            get_licenses_service,
        )

        return await _response(await get_licenses_service().read_state())

    @intercept_exceptions()
    async def activate_instance_license(
        self,
        request: Request,
        *,
        body: InstanceLicenseActivateRequest,
    ) -> InstanceLicenseResponse:
        if env.stripe.enabled:
            raise _NOT_AVAILABLE
        await require_instance_admin()

        from ee.src.core.licenses.service import (  # noqa: PLC0415
            get_licenses_service,
        )
        from ee.src.core.licenses.types import (  # noqa: PLC0415
            InvalidLicenseKey,
            LicenseKeyInEnvironment,
        )

        try:
            state = await get_licenses_service().activate(
                key=body.key,
                user_id=get_request_access().principal.id,
            )
        except InvalidLicenseKey:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This license key is not valid",
            ) from None
        except LicenseKeyInEnvironment:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The license key is set in the environment",
            ) from None

        return await _response(state)

    @intercept_exceptions()
    async def create_instance_registration(
        self,
        request: Request,
        *,
        body: InstanceRegistrationRequest,
    ) -> InstanceRegistrationResponse:
        if env.stripe.enabled:
            raise _NOT_AVAILABLE
        await require_instance_admin()

        if not body.product_updates:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A registration needs consent to product updates.",
            )

        try:
            await request_registration(body.email)
        except RegistrationFailed:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="We could not reach Agenta. Try again later.",
            ) from None

        return InstanceRegistrationResponse(email=body.email)


async def _response(state) -> InstanceLicenseResponse:
    return InstanceLicenseResponse(
        plan=state.plan,
        source=state.source,
        license=(
            InstanceLicenseKey.model_validate(state.license.model_dump())
            if state.license
            else None
        ),
        usage=InstanceLicenseUsage(users=await count_users()),
    )

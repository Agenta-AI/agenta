"""`/organization-secrets/`: organization credentials that projects inherit (M5).

Every route asks the one organization access decision first (`decide_organization`:
a browser-session owner or admin of the request's organization) and answers 403 on a
denial; no project RBAC shortcut applies. Every route addresses inheritable organization
rows of the request's organization only, so an SSO row or another organization's row
answers 404. No response carries a credential value or a part of one.
"""

from functools import wraps
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

from oss.src.apis.fastapi.organization_secrets.models import (
    OrganizationSecretCreateRequest,
    OrganizationSecretEditRequest,
    OrganizationSecretProjectsRequest,
    PublicOrganizationSecretResponse,
    PublicOrganizationSecretsResponse,
)
from oss.src.apis.fastapi.vault.router import SecretSafeRoute
from oss.src.core.access.context import get_request_access
from oss.src.core.access.organizations import OrganizationAction, decide_organization
from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    SecretResponseDTO,
    SecretValueRequiredError,
    UpdateSecretDTO,
)
from oss.src.core.secrets.redaction import organization_secret_response
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.types import (
    OrganizationSecretKindNotInheritable,
    OrganizationSecretNotFound,
    OrganizationSecretNotServed,
    OrganizationSecretValueNotScannable,
    OrganizationSecretValueTooShort,
    ProjectLimitNotAllowed,
    ProjectNotInOrganization,
    SecretShadowConflict,
    SecretSlugConflict,
    SecretWriteConflict,
    ServerOwnedFieldNotWritable,
)
from oss.src.utils.exceptions import intercept_exceptions

DENIED_MESSAGE = (
    "Only owners and admins of the organization, signed in to the app, can manage "
    "organization credentials."
)

_UNPROCESSABLE = (
    OrganizationSecretKindNotInheritable,
    OrganizationSecretNotServed,
    OrganizationSecretValueNotScannable,
    OrganizationSecretValueTooShort,
    ProjectNotInOrganization,
    ServerOwnedFieldNotWritable,
)
_CONFLICTS = (SecretSlugConflict, SecretShadowConflict, SecretWriteConflict)


def handle_organization_secret_exceptions():
    """The domain refusals of organization credentials as their HTTP answers, caught by
    name before `intercept_exceptions` would turn them into 500. Raised `from None`: the
    answer carries the domain message only."""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except _UNPROCESSABLE as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=e.message
                ) from None
            except _CONFLICTS as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail=e.message
                ) from None
            except ProjectLimitNotAllowed as e:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN, detail=e.message
                ) from None
            except OrganizationSecretNotFound as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail=e.message
                ) from None
            except SecretValueRequiredError as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail=e.message
                ) from None

        return wrapper

    return decorator


def _response(secret: SecretResponseDTO) -> PublicOrganizationSecretResponse:
    return PublicOrganizationSecretResponse.model_validate(
        organization_secret_response(secret).model_dump(mode="python")
    )


class OrganizationSecretsRouter:
    def __init__(self, *, vault_service: VaultService):
        self.service = vault_service
        self.router = APIRouter(route_class=SecretSafeRoute)

        self.router.add_api_route(
            "/organization-secrets/",
            self.create_organization_secret,
            methods=["POST"],
            operation_id="create_organization_secret",
            response_model=PublicOrganizationSecretResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/organization-secrets/",
            self.list_organization_secrets,
            methods=["GET"],
            operation_id="list_organization_secrets",
            response_model=PublicOrganizationSecretsResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/organization-secrets/{secret_id}",
            self.fetch_organization_secret,
            methods=["GET"],
            operation_id="fetch_organization_secret",
            response_model=PublicOrganizationSecretResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/organization-secrets/{secret_id}",
            self.edit_organization_secret,
            methods=["PUT"],
            operation_id="edit_organization_secret",
            response_model=PublicOrganizationSecretResponse,
            response_model_exclude_none=True,
        )
        self.router.add_api_route(
            "/organization-secrets/{secret_id}",
            self.delete_organization_secret,
            methods=["DELETE"],
            operation_id="delete_organization_secret",
            status_code=status.HTTP_204_NO_CONTENT,
        )
        self.router.add_api_route(
            "/organization-secrets/{secret_id}/projects",
            self.set_organization_secret_projects,
            methods=["PUT"],
            operation_id="set_organization_secret_projects",
            response_model=PublicOrganizationSecretResponse,
            response_model_exclude_none=True,
        )

    @staticmethod
    async def _organization_id(request: Request):
        """The request's organization when the decision allows, else None."""
        raw = getattr(request.state, "organization_id", None)
        if not raw:
            return None
        organization_id = UUID(str(raw))
        decision = await decide_organization(
            access=get_request_access(),
            organization_id=organization_id,
            action=OrganizationAction.MANAGE_ORGANIZATION_SECRETS,
        )
        return organization_id if decision.allowed else None

    @staticmethod
    def _denied() -> JSONResponse:
        return JSONResponse({"detail": DENIED_MESSAGE}, status_code=403)

    @staticmethod
    def _user_id(request: Request):
        raw = getattr(request.state, "user_id", None)
        return UUID(str(raw)) if raw else None

    @intercept_exceptions()
    @handle_organization_secret_exceptions()
    async def create_organization_secret(
        self, request: Request, body: OrganizationSecretCreateRequest
    ):
        organization_id = await self._organization_id(request)
        if organization_id is None:
            return self._denied()
        create_secret_dto = CreateSecretDTO.model_validate(
            body.model_dump(mode="python", exclude={"availability", "project_ids"})
        )
        secret = await self.service.create_organization_secret(
            organization_id=organization_id,
            create_secret_dto=create_secret_dto,
            user_id=self._user_id(request),
            availability=body.availability,
            project_ids=body.project_ids,
        )
        return _response(secret)

    @intercept_exceptions()
    @handle_organization_secret_exceptions()
    async def list_organization_secrets(self, request: Request):
        organization_id = await self._organization_id(request)
        if organization_id is None:
            return self._denied()
        secrets = await self.service.list_organization_secrets(
            organization_id=organization_id
        )
        return PublicOrganizationSecretsResponse(
            count=len(secrets), secrets=[_response(secret) for secret in secrets]
        )

    @intercept_exceptions()
    @handle_organization_secret_exceptions()
    async def fetch_organization_secret(self, request: Request, secret_id: UUID):
        organization_id = await self._organization_id(request)
        if organization_id is None:
            return self._denied()
        secret = await self.service.fetch_organization_secret(
            organization_id=organization_id, secret_id=secret_id
        )
        if secret is None:
            raise OrganizationSecretNotFound()
        return _response(secret)

    @intercept_exceptions()
    @handle_organization_secret_exceptions()
    async def edit_organization_secret(
        self, request: Request, secret_id: UUID, body: OrganizationSecretEditRequest
    ):
        organization_id = await self._organization_id(request)
        if organization_id is None:
            return self._denied()
        secret = await self.service.update_organization_secret(
            organization_id=organization_id,
            secret_id=secret_id,
            update_secret_dto=UpdateSecretDTO.model_validate(
                body.model_dump(mode="python", exclude_unset=True)
            ),
            user_id=self._user_id(request),
        )
        if secret is None:
            raise OrganizationSecretNotFound()
        return _response(secret)

    @intercept_exceptions()
    @handle_organization_secret_exceptions()
    async def delete_organization_secret(self, request: Request, secret_id: UUID):
        organization_id = await self._organization_id(request)
        if organization_id is None:
            return self._denied()
        deleted = await self.service.delete_organization_secret(
            organization_id=organization_id,
            secret_id=secret_id,
            user_id=self._user_id(request),
        )
        if not deleted:
            raise OrganizationSecretNotFound()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @intercept_exceptions()
    @handle_organization_secret_exceptions()
    async def set_organization_secret_projects(
        self,
        request: Request,
        secret_id: UUID,
        body: OrganizationSecretProjectsRequest,
    ):
        organization_id = await self._organization_id(request)
        if organization_id is None:
            return self._denied()
        secret = await self.service.set_organization_secret_availability(
            organization_id=organization_id,
            secret_id=secret_id,
            availability=body.availability,
            project_ids=body.project_ids,
            user_id=self._user_id(request),
        )
        if secret is None:
            raise OrganizationSecretNotFound()
        return _response(secret)

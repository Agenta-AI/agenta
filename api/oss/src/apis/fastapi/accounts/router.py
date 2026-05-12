"""
Platform Admin Accounts Router.

Mounts all account-related admin routes under the /admin prefix
(applied by the entrypoint).  Route handlers are thin — they
convert HTTP models to service calls and map domain errors to
HTTP responses.
"""

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse, Response

from oss.src.utils.exceptions import (
    BadRequestException,
    ConflictException,
    NotFoundException,
    intercept_exceptions,
)

from oss.src.core.accounts.service import PlatformAdminAccountsService
from oss.src.core.accounts.errors import (
    AdminApiKeyNotFoundError,
    AdminError,
    AdminInvalidReferenceError,
    AdminMembershipNotFoundError,
    AdminNotImplementedError,
    AdminOrganizationNotFoundError,
    AdminProjectNotFoundError,
    AdminUserAlreadyExistsError,
    AdminUserNotFoundError,
    AdminValidationError,
    AdminWorkspaceNotFoundError,
    OssMultiOrgNotSupportedError,
)
from oss.src.apis.fastapi.accounts.models import (
    AdminAccountsCreate,
    AdminAccountsDelete,
    AdminAccountsResponse,
    AdminDeleteResponse,
    AdminSimpleAccountsApiKeysCreate,
    AdminSimpleAccountsCreate,
    AdminSimpleAccountsDelete,
    AdminSimpleAccountsOrganizationsCreate,
    AdminSimpleAccountsOrganizationsMembershipsCreate,
    AdminSimpleAccountsOrganizationsTransferOwnership,
    AdminSimpleAccountsOrganizationsTransferOwnershipResponse,
    AdminSimpleAccountsProjectsCreate,
    AdminSimpleAccountsProjectsMembershipsCreate,
    AdminSimpleAccountsResponse,
    AdminSimpleAccountsUsersCreate,
    AdminSimpleAccountsUsersIdentitiesCreate,
    AdminSimpleAccountsUsersResetPassword,
    AdminSimpleAccountsWorkspacesCreate,
    AdminSimpleAccountsWorkspacesMembershipsCreate,
)


def _handle_admin_error(exc: AdminError) -> None:
    """Convert a domain AdminError to the appropriate HTTP exception."""
    if isinstance(exc, AdminUserAlreadyExistsError):
        raise ConflictException(message=exc.message, **exc.details)
    if isinstance(
        exc,
        (
            AdminUserNotFoundError,
            AdminOrganizationNotFoundError,
            AdminWorkspaceNotFoundError,
            AdminProjectNotFoundError,
            AdminApiKeyNotFoundError,
            AdminMembershipNotFoundError,
        ),
    ):
        raise NotFoundException(message=exc.message, **exc.details)
    if isinstance(exc, AdminNotImplementedError):
        raise BadRequestException(code=501, message=exc.message, **exc.details)
    if isinstance(exc, AdminValidationError):
        raise BadRequestException(message=exc.message, **(exc.details or {}))
    if isinstance(exc, AdminInvalidReferenceError):
        raise BadRequestException(message=exc.message, **exc.details)
    if isinstance(exc, OssMultiOrgNotSupportedError):
        raise BadRequestException(message=exc.message, **(exc.details or {}))
    # Generic admin error → 400
    raise BadRequestException(message=exc.message)


class PlatformAdminAccountsRouter:
    def __init__(
        self,
        *,
        accounts_service: PlatformAdminAccountsService,
    ):
        self.accounts_service = accounts_service
        self.router = APIRouter()

        # ------------------------------------------------------------------
        # Account graph
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/accounts/",
            self.create_accounts,
            methods=["POST"],
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create accounts",
        )

        self.router.add_api_route(
            "/accounts/",
            self.delete_accounts,
            methods=["DELETE"],
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete accounts",
        )

        # ------------------------------------------------------------------
        # Simple account
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/",
            self.create_simple_accounts,
            methods=["POST"],
            status_code=status.HTTP_200_OK,
            response_model=AdminSimpleAccountsResponse,
            response_model_exclude_none=True,
            summary="Create simple accounts",
        )

        self.router.add_api_route(
            "/simple/accounts/",
            self.delete_simple_accounts,
            methods=["DELETE"],
            status_code=status.HTTP_204_NO_CONTENT,
            summary="Delete simple accounts",
        )

        # ------------------------------------------------------------------
        # Simple users
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/users/",
            self.create_user,
            methods=["POST"],
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create users",
        )

        self.router.add_api_route(
            "/simple/accounts/users/{user_id}",
            self.delete_user,
            methods=["DELETE"],
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete user",
        )

        # ------------------------------------------------------------------
        # Simple user identities
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/users/identities/",
            self.create_user_identity,
            methods=["POST"],
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create user identities",
        )

        self.router.add_api_route(
            "/simple/accounts/users/{user_id}/identities/{identity_id}",
            self.delete_user_identity,
            methods=["DELETE"],
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete user identity",
        )

        # ------------------------------------------------------------------
        # Simple organizations
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/organizations/",
            self.create_organization,
            methods=["POST"],
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create organizations",
        )

        self.router.add_api_route(
            "/simple/accounts/organizations/{organization_id}",
            self.delete_organization,
            methods=["DELETE"],
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete organization",
        )

        # ------------------------------------------------------------------
        # Simple organization memberships
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/organizations/memberships/",
            self.create_organization_membership,
            methods=["POST"],
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create organization memberships",
        )

        self.router.add_api_route(
            "/simple/accounts/organizations/{organization_id}/memberships/{membership_id}",
            self.delete_organization_membership,
            methods=["DELETE"],
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete organization membership",
        )

        # ------------------------------------------------------------------
        # Simple workspaces
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/workspaces/",
            self.create_workspace,
            methods=["POST"],
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create workspaces",
        )

        self.router.add_api_route(
            "/simple/accounts/workspaces/{workspace_id}",
            self.delete_workspace,
            methods=["DELETE"],
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete workspace",
        )

        # ------------------------------------------------------------------
        # Simple workspace memberships
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/workspaces/memberships/",
            self.create_workspace_membership,
            methods=["POST"],
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create workspace memberships",
        )

        self.router.add_api_route(
            "/simple/accounts/workspaces/{workspace_id}/memberships/{membership_id}",
            self.delete_workspace_membership,
            methods=["DELETE"],
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete workspace membership",
        )

        # ------------------------------------------------------------------
        # Simple projects
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/projects/",
            self.create_project,
            methods=["POST"],
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create projects",
        )

        self.router.add_api_route(
            "/simple/accounts/projects/{project_id}",
            self.delete_project,
            methods=["DELETE"],
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete project",
        )

        # ------------------------------------------------------------------
        # Simple project memberships
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/projects/memberships/",
            self.create_project_membership,
            methods=["POST"],
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create project memberships",
        )

        self.router.add_api_route(
            "/simple/accounts/projects/{project_id}/memberships/{membership_id}",
            self.delete_project_membership,
            methods=["DELETE"],
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete project membership",
        )

        # ------------------------------------------------------------------
        # Simple API keys
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/api-keys/",
            self.create_api_key,
            methods=["POST"],
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create API keys",
        )

        self.router.add_api_route(
            "/simple/accounts/api-keys/{api_key_id}",
            self.delete_api_key,
            methods=["DELETE"],
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete API key",
        )

        # ------------------------------------------------------------------
        # RPC actions (no trailing slash)
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/reset-password",
            self.reset_password,
            methods=["POST"],
            status_code=status.HTTP_204_NO_CONTENT,
            summary="Reset user password",
        )

        self.router.add_api_route(
            "/simple/accounts/transfer-ownership",
            self.transfer_ownership,
            methods=["POST"],
            status_code=status.HTTP_204_NO_CONTENT,
            responses={
                status.HTTP_200_OK: {
                    "model": AdminSimpleAccountsOrganizationsTransferOwnershipResponse,
                    "description": "Partial transfer — some orgs could not be transferred.",
                },
            },
            summary="Transfer organization ownership",
        )

    # ------------------------------------------------------------------
    # Route handlers — account graph
    # ------------------------------------------------------------------

    @intercept_exceptions()
    async def create_accounts(
        self,
        payload: AdminAccountsCreate,
    ) -> AdminAccountsResponse:
        try:
            result = await self.accounts_service.create_accounts(dto=payload.to_dto())
            return AdminAccountsResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_accounts(
        self,
        payload: AdminAccountsDelete,
    ) -> AdminDeleteResponse:
        try:
            result = await self.accounts_service.delete_accounts(dto=payload.to_dto())
            return AdminDeleteResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    # ------------------------------------------------------------------
    # Simple account
    # ------------------------------------------------------------------

    @intercept_exceptions()
    async def create_simple_accounts(
        self,
        payload: AdminSimpleAccountsCreate,
    ) -> AdminSimpleAccountsResponse:
        try:
            result = await self.accounts_service.create_simple_accounts(
                dto=payload.to_dto()
            )
            return AdminSimpleAccountsResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_simple_accounts(
        self,
        payload: AdminSimpleAccountsDelete,
    ) -> None:
        try:
            await self.accounts_service.delete_simple_accounts(dto=payload.to_dto())
        except AdminError as exc:
            _handle_admin_error(exc)

    # ------------------------------------------------------------------
    # Simple users
    # ------------------------------------------------------------------

    @intercept_exceptions()
    async def create_user(
        self,
        payload: AdminSimpleAccountsUsersCreate,
    ) -> AdminAccountsResponse:
        try:
            result = await self.accounts_service.create_user(dto=payload.to_dto())
            return AdminAccountsResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_user(
        self,
        user_id: str,
    ) -> AdminDeleteResponse:
        try:
            result = await self.accounts_service.delete_user(user_id=user_id)
            return AdminDeleteResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    # ------------------------------------------------------------------
    # Simple user identities
    # ------------------------------------------------------------------

    @intercept_exceptions()
    async def create_user_identity(
        self,
        payload: AdminSimpleAccountsUsersIdentitiesCreate,
    ) -> AdminAccountsResponse:
        try:
            result = await self.accounts_service.create_user_identity(
                dto=payload.to_dto()
            )
            return AdminAccountsResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_user_identity(
        self,
        user_id: str,
        identity_id: str,
    ) -> AdminDeleteResponse:
        try:
            result = await self.accounts_service.delete_user_identity(
                user_id=user_id,
                identity_id=identity_id,
            )
            return AdminDeleteResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    # ------------------------------------------------------------------
    # Simple organizations
    # ------------------------------------------------------------------

    @intercept_exceptions()
    async def create_organization(
        self,
        payload: AdminSimpleAccountsOrganizationsCreate,
    ) -> AdminAccountsResponse:
        try:
            result = await self.accounts_service.create_organization(
                dto=payload.to_dto()
            )
            return AdminAccountsResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_organization(
        self,
        organization_id: str,
    ) -> AdminDeleteResponse:
        try:
            result = await self.accounts_service.delete_organization(
                organization_id=organization_id
            )
            return AdminDeleteResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    # ------------------------------------------------------------------
    # Simple organization memberships
    # ------------------------------------------------------------------

    @intercept_exceptions()
    async def create_organization_membership(
        self,
        payload: AdminSimpleAccountsOrganizationsMembershipsCreate,
    ) -> AdminAccountsResponse:
        try:
            result = await self.accounts_service.create_organization_membership(
                dto=payload.to_dto()
            )
            return AdminAccountsResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_organization_membership(
        self,
        organization_id: str,
        membership_id: str,
    ) -> AdminDeleteResponse:
        try:
            result = await self.accounts_service.delete_organization_membership(
                organization_id=organization_id,
                membership_id=membership_id,
            )
            return AdminDeleteResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    # ------------------------------------------------------------------
    # Simple workspaces
    # ------------------------------------------------------------------

    @intercept_exceptions()
    async def create_workspace(
        self,
        payload: AdminSimpleAccountsWorkspacesCreate,
    ) -> AdminAccountsResponse:
        try:
            result = await self.accounts_service.create_workspace(dto=payload.to_dto())
            return AdminAccountsResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_workspace(
        self,
        workspace_id: str,
    ) -> AdminDeleteResponse:
        try:
            result = await self.accounts_service.delete_workspace(
                workspace_id=workspace_id
            )
            return AdminDeleteResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    # ------------------------------------------------------------------
    # Simple workspace memberships
    # ------------------------------------------------------------------

    @intercept_exceptions()
    async def create_workspace_membership(
        self,
        payload: AdminSimpleAccountsWorkspacesMembershipsCreate,
    ) -> AdminAccountsResponse:
        try:
            result = await self.accounts_service.create_workspace_membership(
                dto=payload.to_dto()
            )
            return AdminAccountsResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_workspace_membership(
        self,
        workspace_id: str,
        membership_id: str,
    ) -> AdminDeleteResponse:
        try:
            result = await self.accounts_service.delete_workspace_membership(
                workspace_id=workspace_id,
                membership_id=membership_id,
            )
            return AdminDeleteResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    # ------------------------------------------------------------------
    # Simple projects
    # ------------------------------------------------------------------

    @intercept_exceptions()
    async def create_project(
        self,
        payload: AdminSimpleAccountsProjectsCreate,
    ) -> AdminAccountsResponse:
        try:
            result = await self.accounts_service.create_project(dto=payload.to_dto())
            return AdminAccountsResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_project(
        self,
        project_id: str,
    ) -> AdminDeleteResponse:
        try:
            result = await self.accounts_service.delete_project(project_id=project_id)
            return AdminDeleteResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    # ------------------------------------------------------------------
    # Simple project memberships
    # ------------------------------------------------------------------

    @intercept_exceptions()
    async def create_project_membership(
        self,
        payload: AdminSimpleAccountsProjectsMembershipsCreate,
    ) -> AdminAccountsResponse:
        try:
            result = await self.accounts_service.create_project_membership(
                dto=payload.to_dto()
            )
            return AdminAccountsResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_project_membership(
        self,
        project_id: str,
        membership_id: str,
    ) -> AdminDeleteResponse:
        try:
            result = await self.accounts_service.delete_project_membership(
                project_id=project_id,
                membership_id=membership_id,
            )
            return AdminDeleteResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    # ------------------------------------------------------------------
    # Simple API keys
    # ------------------------------------------------------------------

    @intercept_exceptions()
    async def create_api_key(
        self,
        payload: AdminSimpleAccountsApiKeysCreate,
    ) -> AdminAccountsResponse:
        try:
            result = await self.accounts_service.create_api_key(dto=payload.to_dto())
            return AdminAccountsResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_api_key(
        self,
        api_key_id: str,
    ) -> AdminDeleteResponse:
        try:
            result = await self.accounts_service.delete_api_key(api_key_id=api_key_id)
            return AdminDeleteResponse.from_dto(result)
        except AdminError as exc:
            _handle_admin_error(exc)

    # ------------------------------------------------------------------
    # RPC actions
    # ------------------------------------------------------------------

    @intercept_exceptions()
    async def reset_password(
        self,
        payload: AdminSimpleAccountsUsersResetPassword,
    ) -> None:
        try:
            await self.accounts_service.reset_password(
                dto=payload.to_dto(),
            )
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def transfer_ownership(
        self,
        payload: AdminSimpleAccountsOrganizationsTransferOwnership,
    ) -> Response:
        try:
            result = await self.accounts_service.transfer_ownership(
                dto=payload.to_dto()
            )
        except AdminError as exc:
            _handle_admin_error(exc)

        if result.errors:
            response = (
                AdminSimpleAccountsOrganizationsTransferOwnershipResponse.from_dto(
                    result
                )
            )
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content=response.model_dump(),
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

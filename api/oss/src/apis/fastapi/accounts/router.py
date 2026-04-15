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
            operation_id="admin_create_accounts",
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create account graph",
        )

        self.router.add_api_route(
            "/accounts/",
            self.delete_accounts,
            methods=["DELETE"],
            operation_id="admin_delete_accounts",
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete account graph by selector",
        )

        # ------------------------------------------------------------------
        # Simple account
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/",
            self.create_simple_accounts,
            methods=["POST"],
            operation_id="admin_create_simple_accounts",
            status_code=status.HTTP_200_OK,
            response_model=AdminSimpleAccountsResponse,
            response_model_exclude_none=True,
            summary="Create simple account",
        )

        self.router.add_api_route(
            "/simple/accounts/",
            self.delete_simple_accounts,
            methods=["DELETE"],
            operation_id="admin_delete_simple_accounts",
            status_code=status.HTTP_204_NO_CONTENT,
            summary="Delete simple accounts by user ref",
        )

        # ------------------------------------------------------------------
        # Simple users
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/users/",
            self.create_user,
            methods=["POST"],
            operation_id="admin_create_user",
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create user account",
        )

        # ------------------------------------------------------------------
        # Simple user identities
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/users/identities/",
            self.create_user_identity,
            methods=["POST"],
            operation_id="admin_create_user_identity",
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create user identity",
        )

        self.router.add_api_route(
            "/simple/accounts/users/{user_id}/identities/{identity_id}/",
            self.delete_user_identity,
            methods=["DELETE"],
            operation_id="admin_delete_user_identity",
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete user identity by ID",
        )

        # ------------------------------------------------------------------
        # Simple organizations
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/organizations/",
            self.create_organization,
            methods=["POST"],
            operation_id="admin_create_organization",
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create organization",
        )

        self.router.add_api_route(
            "/simple/accounts/organizations/{organization_id}/",
            self.delete_organization,
            methods=["DELETE"],
            operation_id="admin_delete_organization",
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete organization by ID",
        )

        # ------------------------------------------------------------------
        # Simple organization memberships
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/organizations/memberships/",
            self.create_organization_membership,
            methods=["POST"],
            operation_id="admin_create_organization_membership",
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create organization membership",
        )

        self.router.add_api_route(
            "/simple/accounts/organizations/{organization_id}/memberships/{membership_id}/",
            self.delete_organization_membership,
            methods=["DELETE"],
            operation_id="admin_delete_organization_membership",
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete organization membership by ID",
        )

        # ------------------------------------------------------------------
        # Simple workspaces
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/workspaces/",
            self.create_workspace,
            methods=["POST"],
            operation_id="admin_create_workspace",
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create workspace",
        )

        self.router.add_api_route(
            "/simple/accounts/workspaces/{workspace_id}/",
            self.delete_workspace,
            methods=["DELETE"],
            operation_id="admin_delete_workspace",
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete workspace by ID",
        )

        # ------------------------------------------------------------------
        # Simple workspace memberships
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/workspaces/memberships/",
            self.create_workspace_membership,
            methods=["POST"],
            operation_id="admin_create_workspace_membership",
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create workspace membership",
        )

        self.router.add_api_route(
            "/simple/accounts/workspaces/{workspace_id}/memberships/{membership_id}/",
            self.delete_workspace_membership,
            methods=["DELETE"],
            operation_id="admin_delete_workspace_membership",
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete workspace membership by ID",
        )

        # ------------------------------------------------------------------
        # Simple projects
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/projects/",
            self.create_project,
            methods=["POST"],
            operation_id="admin_create_project",
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create project",
        )

        self.router.add_api_route(
            "/simple/accounts/projects/{project_id}/",
            self.delete_project,
            methods=["DELETE"],
            operation_id="admin_delete_project",
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete project by ID",
        )

        # ------------------------------------------------------------------
        # Simple project memberships
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/projects/memberships/",
            self.create_project_membership,
            methods=["POST"],
            operation_id="admin_create_project_membership",
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create project membership",
        )

        self.router.add_api_route(
            "/simple/accounts/projects/{project_id}/memberships/{membership_id}/",
            self.delete_project_membership,
            methods=["DELETE"],
            operation_id="admin_delete_project_membership",
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete project membership by ID",
        )

        # ------------------------------------------------------------------
        # Simple API keys
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/api-keys/",
            self.create_api_key,
            methods=["POST"],
            operation_id="admin_create_api_key",
            status_code=status.HTTP_200_OK,
            response_model=AdminAccountsResponse,
            response_model_exclude_none=True,
            summary="Create API key",
        )

        self.router.add_api_route(
            "/simple/accounts/api-keys/{api_key_id}/",
            self.delete_api_key,
            methods=["DELETE"],
            operation_id="admin_delete_api_key",
            status_code=status.HTTP_200_OK,
            response_model=AdminDeleteResponse,
            response_model_exclude_none=True,
            summary="Delete API key by ID",
        )

        # ------------------------------------------------------------------
        # RPC actions (no trailing slash)
        # ------------------------------------------------------------------

        self.router.add_api_route(
            "/simple/accounts/reset-password",
            self.reset_password,
            methods=["POST"],
            operation_id="admin_reset_password",
            status_code=status.HTTP_204_NO_CONTENT,
            summary="Reset user password",
        )

        self.router.add_api_route(
            "/simple/accounts/transfer-ownership",
            self.transfer_ownership,
            methods=["POST"],
            operation_id="admin_transfer_ownership",
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
            return await self.accounts_service.create_accounts(dto=payload)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_accounts(
        self,
        payload: AdminAccountsDelete,
    ) -> AdminDeleteResponse:
        try:
            return await self.accounts_service.delete_accounts(dto=payload)
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
            return await self.accounts_service.create_simple_accounts(dto=payload)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_simple_accounts(
        self,
        payload: AdminSimpleAccountsDelete,
    ) -> None:
        try:
            await self.accounts_service.delete_simple_accounts(dto=payload)
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
            return await self.accounts_service.create_user(dto=payload)
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
            return await self.accounts_service.create_user_identity(dto=payload)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_user_identity(
        self,
        user_id: str,
        identity_id: str,
    ) -> AdminDeleteResponse:
        try:
            return await self.accounts_service.delete_user_identity(
                user_id=user_id,
                identity_id=identity_id,
            )
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
            return await self.accounts_service.create_organization(dto=payload)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_organization(
        self,
        organization_id: str,
    ) -> AdminDeleteResponse:
        try:
            return await self.accounts_service.delete_organization(
                organization_id=organization_id
            )
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
            return await self.accounts_service.create_organization_membership(
                dto=payload
            )
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_organization_membership(
        self,
        organization_id: str,
        membership_id: str,
    ) -> AdminDeleteResponse:
        try:
            return await self.accounts_service.delete_organization_membership(
                organization_id=organization_id,
                membership_id=membership_id,
            )
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
            return await self.accounts_service.create_workspace(dto=payload)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_workspace(
        self,
        workspace_id: str,
    ) -> AdminDeleteResponse:
        try:
            return await self.accounts_service.delete_workspace(
                workspace_id=workspace_id
            )
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
            return await self.accounts_service.create_workspace_membership(dto=payload)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_workspace_membership(
        self,
        workspace_id: str,
        membership_id: str,
    ) -> AdminDeleteResponse:
        try:
            return await self.accounts_service.delete_workspace_membership(
                workspace_id=workspace_id,
                membership_id=membership_id,
            )
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
            return await self.accounts_service.create_project(dto=payload)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_project(
        self,
        project_id: str,
    ) -> AdminDeleteResponse:
        try:
            return await self.accounts_service.delete_project(project_id=project_id)
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
            return await self.accounts_service.create_project_membership(dto=payload)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_project_membership(
        self,
        project_id: str,
        membership_id: str,
    ) -> AdminDeleteResponse:
        try:
            return await self.accounts_service.delete_project_membership(
                project_id=project_id,
                membership_id=membership_id,
            )
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
            return await self.accounts_service.create_api_key(dto=payload)
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def delete_api_key(
        self,
        api_key_id: str,
    ) -> AdminDeleteResponse:
        try:
            return await self.accounts_service.delete_api_key(api_key_id=api_key_id)
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
                dto=payload,
            )
        except AdminError as exc:
            _handle_admin_error(exc)

    @intercept_exceptions()
    async def transfer_ownership(
        self,
        payload: AdminSimpleAccountsOrganizationsTransferOwnership,
    ) -> Response:
        try:
            result = await self.accounts_service.transfer_ownership(dto=payload)
        except AdminError as exc:
            _handle_admin_error(exc)

        if result.errors:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content=result.model_dump(),
            )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

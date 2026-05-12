"""
HTTP-facing request/response models for the platform admin accounts surface.

These models are used by FastAPI for validation, OpenAPI schema generation,
and serialization. Each model subclasses its corresponding core DTO and
provides ``to_dto()`` / ``from_dto()`` to convert at the router boundary.
"""

from typing import Type

from pydantic import BaseModel

from oss.src.core.accounts import dtos as _dtos


def _bind(dto_cls: Type[BaseModel]) -> Type[BaseModel]:
    """Build an HTTP model subclassing ``dto_cls`` with to_dto/from_dto wired up."""

    def to_dto(self, _cls=dto_cls):
        return _cls(**self.model_dump())

    @classmethod
    def from_dto(cls, dto):
        return cls(**dto.model_dump())

    return type(
        dto_cls.__name__,
        (dto_cls,),
        {"to_dto": to_dto, "from_dto": from_dto},
    )


# Shared types -----------------------------------------------------------------

EntityRef = _dtos.EntityRef
AdminAccountCreateOptions = _bind(_dtos.AdminAccountCreateOptions)
AdminStructuredError = _bind(_dtos.AdminStructuredError)
AdminDeletedEntity = _bind(_dtos.AdminDeletedEntity)
AdminDeletedEntities = _bind(_dtos.AdminDeletedEntities)

# Entity read models -----------------------------------------------------------

AdminUserRead = _bind(_dtos.AdminUserRead)
AdminUserIdentityRead = _bind(_dtos.AdminUserIdentityRead)
AdminSubscriptionCreate = _bind(_dtos.AdminSubscriptionCreate)
AdminSubscriptionRead = _bind(_dtos.AdminSubscriptionRead)
AdminOrganizationRead = _bind(_dtos.AdminOrganizationRead)
AdminWorkspaceRead = _bind(_dtos.AdminWorkspaceRead)
AdminProjectRead = _bind(_dtos.AdminProjectRead)
AdminOrganizationMembershipRead = _bind(_dtos.AdminOrganizationMembershipRead)
AdminWorkspaceMembershipRead = _bind(_dtos.AdminWorkspaceMembershipRead)
AdminProjectMembershipRead = _bind(_dtos.AdminProjectMembershipRead)
AdminApiKeyRead = _bind(_dtos.AdminApiKeyRead)
AdminApiKeyResponse = _bind(_dtos.AdminApiKeyResponse)
AdminAccountRead = _bind(_dtos.AdminAccountRead)
AdminSimpleAccountRead = _bind(_dtos.AdminSimpleAccountRead)

# Entity create models ---------------------------------------------------------

AdminUserCreate = _bind(_dtos.AdminUserCreate)
AdminUserIdentityCreate = _bind(_dtos.AdminUserIdentityCreate)
AdminOrganizationCreate = _bind(_dtos.AdminOrganizationCreate)
AdminWorkspaceCreate = _bind(_dtos.AdminWorkspaceCreate)
AdminProjectCreate = _bind(_dtos.AdminProjectCreate)
AdminOrganizationMembershipCreate = _bind(_dtos.AdminOrganizationMembershipCreate)
AdminWorkspaceMembershipCreate = _bind(_dtos.AdminWorkspaceMembershipCreate)
AdminProjectMembershipCreate = _bind(_dtos.AdminProjectMembershipCreate)
AdminApiKeyCreate = _bind(_dtos.AdminApiKeyCreate)

# Account graph create / response ---------------------------------------------

AdminAccountsCreate = _bind(_dtos.AdminAccountsCreate)
AdminAccountsResponse = _bind(_dtos.AdminAccountsResponse)

# Account graph delete --------------------------------------------------------

AdminAccountsDeleteTarget = _bind(_dtos.AdminAccountsDeleteTarget)
AdminAccountsDelete = _bind(_dtos.AdminAccountsDelete)
AdminDeleteResponse = _bind(_dtos.AdminDeleteResponse)

# Simple account create / response --------------------------------------------

AdminSimpleAccountCreate = _bind(_dtos.AdminSimpleAccountCreate)
AdminSimpleAccountsCreate = _bind(_dtos.AdminSimpleAccountsCreate)
AdminSimpleAccountsResponse = _bind(_dtos.AdminSimpleAccountsResponse)

# Simple account delete -------------------------------------------------------

AdminSimpleAccountDeleteEntry = _bind(_dtos.AdminSimpleAccountDeleteEntry)
AdminSimpleAccountsDelete = _bind(_dtos.AdminSimpleAccountsDelete)

# Simple entity creates -------------------------------------------------------

AdminSimpleAccountsUsersCreate = _bind(_dtos.AdminSimpleAccountsUsersCreate)
AdminSimpleAccountsUsersIdentitiesCreate = _bind(
    _dtos.AdminSimpleAccountsUsersIdentitiesCreate
)
AdminSimpleAccountsOrganizationsCreate = _bind(
    _dtos.AdminSimpleAccountsOrganizationsCreate
)
AdminSimpleAccountsOrganizationsMembershipsCreate = _bind(
    _dtos.AdminSimpleAccountsOrganizationsMembershipsCreate
)
AdminSimpleAccountsWorkspacesCreate = _bind(_dtos.AdminSimpleAccountsWorkspacesCreate)
AdminSimpleAccountsWorkspacesMembershipsCreate = _bind(
    _dtos.AdminSimpleAccountsWorkspacesMembershipsCreate
)
AdminSimpleAccountsProjectsCreate = _bind(_dtos.AdminSimpleAccountsProjectsCreate)
AdminSimpleAccountsProjectsMembershipsCreate = _bind(
    _dtos.AdminSimpleAccountsProjectsMembershipsCreate
)
AdminSimpleAccountsApiKeysCreate = _bind(_dtos.AdminSimpleAccountsApiKeysCreate)

# Actions ---------------------------------------------------------------------

AdminSimpleAccountsUsersResetPassword = _bind(
    _dtos.AdminSimpleAccountsUsersResetPassword
)
AdminSimpleAccountsOrganizationsTransferOwnership = _bind(
    _dtos.AdminSimpleAccountsOrganizationsTransferOwnership
)
AdminSimpleAccountsOrganizationsTransferOwnershipResponse = _bind(
    _dtos.AdminSimpleAccountsOrganizationsTransferOwnershipResponse
)


__all__ = [
    "EntityRef",
    "AdminAccountCreateOptions",
    "AdminStructuredError",
    "AdminDeletedEntity",
    "AdminDeletedEntities",
    # Read
    "AdminUserRead",
    "AdminUserIdentityRead",
    "AdminSubscriptionCreate",
    "AdminSubscriptionRead",
    "AdminOrganizationRead",
    "AdminWorkspaceRead",
    "AdminProjectRead",
    "AdminOrganizationMembershipRead",
    "AdminWorkspaceMembershipRead",
    "AdminProjectMembershipRead",
    "AdminApiKeyRead",
    "AdminApiKeyResponse",
    "AdminAccountRead",
    # Create
    "AdminUserCreate",
    "AdminUserIdentityCreate",
    "AdminOrganizationCreate",
    "AdminWorkspaceCreate",
    "AdminProjectCreate",
    "AdminOrganizationMembershipCreate",
    "AdminWorkspaceMembershipCreate",
    "AdminProjectMembershipCreate",
    "AdminApiKeyCreate",
    # Account graph
    "AdminAccountsCreate",
    "AdminAccountsResponse",
    "AdminAccountsDeleteTarget",
    "AdminAccountsDelete",
    "AdminDeleteResponse",
    # Simple
    "AdminSimpleAccountRead",
    "AdminSimpleAccountCreate",
    "AdminSimpleAccountsCreate",
    "AdminSimpleAccountsResponse",
    "AdminSimpleAccountDeleteEntry",
    "AdminSimpleAccountsDelete",
    # Simple entity creates
    "AdminSimpleAccountsUsersCreate",
    "AdminSimpleAccountsUsersIdentitiesCreate",
    "AdminSimpleAccountsOrganizationsCreate",
    "AdminSimpleAccountsOrganizationsMembershipsCreate",
    "AdminSimpleAccountsWorkspacesCreate",
    "AdminSimpleAccountsWorkspacesMembershipsCreate",
    "AdminSimpleAccountsProjectsCreate",
    "AdminSimpleAccountsProjectsMembershipsCreate",
    "AdminSimpleAccountsApiKeysCreate",
    # Actions
    "AdminSimpleAccountsUsersResetPassword",
    "AdminSimpleAccountsOrganizationsTransferOwnership",
    "AdminSimpleAccountsOrganizationsTransferOwnershipResponse",
]

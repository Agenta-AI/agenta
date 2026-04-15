"""
HTTP-facing request/response models for the platform admin accounts surface.

These models are used by FastAPI for validation, OpenAPI schema generation,
and serialization.  They mirror the core DTOs closely; the router converts
between the two layers.
"""

# Re-export the core DTOs as HTTP models.
# Names follow the route contract defined in contracts.md.

from oss.src.core.accounts.dtos import (
    # Shared types
    EntityRef as EntityRef,
    AdminAccountCreateOptionsDTO as AdminAccountCreateOptions,
    AdminStructuredErrorDTO as AdminStructuredError,
    AdminDeletedEntityDTO as AdminDeletedEntity,
    AdminDeletedEntitiesDTO as AdminDeletedEntities,
    # Entity read models
    AdminUserReadDTO as AdminUserRead,
    AdminUserIdentityReadDTO as AdminUserIdentityRead,
    AdminSubscriptionCreateDTO as AdminSubscriptionCreate,
    AdminSubscriptionReadDTO as AdminSubscriptionRead,
    AdminOrganizationReadDTO as AdminOrganizationRead,
    AdminWorkspaceReadDTO as AdminWorkspaceRead,
    AdminProjectReadDTO as AdminProjectRead,
    AdminOrganizationMembershipReadDTO as AdminOrganizationMembershipRead,
    AdminWorkspaceMembershipReadDTO as AdminWorkspaceMembershipRead,
    AdminProjectMembershipReadDTO as AdminProjectMembershipRead,
    AdminApiKeyReadDTO as AdminApiKeyRead,
    AdminApiKeyResponseDTO as AdminApiKeyResponse,
    AdminAccountReadDTO as AdminAccountRead,
    AdminSimpleAccountReadDTO as AdminSimpleAccountRead,
    # Entity create models
    AdminUserCreateDTO as AdminUserCreate,
    AdminUserIdentityCreateDTO as AdminUserIdentityCreate,
    AdminOrganizationCreateDTO as AdminOrganizationCreate,
    AdminWorkspaceCreateDTO as AdminWorkspaceCreate,
    AdminProjectCreateDTO as AdminProjectCreate,
    AdminOrganizationMembershipCreateDTO as AdminOrganizationMembershipCreate,
    AdminWorkspaceMembershipCreateDTO as AdminWorkspaceMembershipCreate,
    AdminProjectMembershipCreateDTO as AdminProjectMembershipCreate,
    AdminApiKeyCreateDTO as AdminApiKeyCreate,
    # Account graph create / response
    AdminAccountsCreateDTO as AdminAccountsCreate,
    AdminAccountsResponseDTO as AdminAccountsResponse,
    # Account graph delete
    AdminAccountsDeleteTargetDTO as AdminAccountsDeleteTarget,
    AdminAccountsDeleteDTO as AdminAccountsDelete,
    AdminDeleteResponseDTO as AdminDeleteResponse,
    # Simple account create / response
    AdminSimpleAccountCreateDTO as AdminSimpleAccountCreate,
    AdminSimpleAccountsCreateDTO as AdminSimpleAccountsCreate,
    AdminSimpleAccountsResponseDTO as AdminSimpleAccountsResponse,
    # Simple account delete
    AdminSimpleAccountDeleteEntryDTO as AdminSimpleAccountDeleteEntry,
    AdminSimpleAccountsDeleteDTO as AdminSimpleAccountsDelete,
    # Simple entity creates
    AdminSimpleAccountsUsersCreateDTO as AdminSimpleAccountsUsersCreate,
    AdminSimpleAccountsUsersIdentitiesCreateDTO as AdminSimpleAccountsUsersIdentitiesCreate,
    AdminSimpleAccountsOrganizationsCreateDTO as AdminSimpleAccountsOrganizationsCreate,
    AdminSimpleAccountsOrganizationsMembershipsCreateDTO as AdminSimpleAccountsOrganizationsMembershipsCreate,
    AdminSimpleAccountsWorkspacesCreateDTO as AdminSimpleAccountsWorkspacesCreate,
    AdminSimpleAccountsWorkspacesMembershipsCreateDTO as AdminSimpleAccountsWorkspacesMembershipsCreate,
    AdminSimpleAccountsProjectsCreateDTO as AdminSimpleAccountsProjectsCreate,
    AdminSimpleAccountsProjectsMembershipsCreateDTO as AdminSimpleAccountsProjectsMembershipsCreate,
    AdminSimpleAccountsApiKeysCreateDTO as AdminSimpleAccountsApiKeysCreate,
    # Actions
    AdminSimpleAccountsUsersResetPasswordDTO as AdminSimpleAccountsUsersResetPassword,
    AdminSimpleAccountsOrganizationsTransferOwnershipDTO as AdminSimpleAccountsOrganizationsTransferOwnership,
    AdminSimpleAccountsOrganizationsTransferOwnershipResponseDTO as AdminSimpleAccountsOrganizationsTransferOwnershipResponse,
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

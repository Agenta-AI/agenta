from typing import Optional, Dict, List, Union, Literal, Any
from pydantic import BaseModel, model_validator


# ---------------------------------------------------------------------------
# Entity References
# ---------------------------------------------------------------------------


class EntityRef(BaseModel):
    """Polymorphic reference that can point to a request-local key, an
    existing persisted ID, a stable slug, or an email address.
    Exactly one field must be set."""

    ref: Optional[str] = None  # request-local map key
    id: Optional[str] = None  # persisted UUID
    slug: Optional[str] = None  # stable unique slug
    email: Optional[str] = None  # email address (users only)

    @model_validator(mode="after")
    def _exactly_one(self) -> "EntityRef":
        set_fields = sum(
            1 for v in (self.ref, self.id, self.slug, self.email) if v is not None
        )
        if set_fields != 1:
            raise ValueError(
                "Exactly one of 'ref', 'id', 'slug', or 'email' must be provided."
            )
        return self


# Type aliases (string map keys)
UserRef = str
UserIdentityRef = str
OrganizationRef = str
WorkspaceRef = str
ProjectRef = str
MembershipRef = str
ApiKeyRef = str
AccountRef = str  # request-local key for one account in a batch simple create

IdentityMethod = str  # e.g. "email:password", "email:otp", "social:google"


# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------


class AdminAccountCreateOptionsDTO(BaseModel):
    dry_run: Optional[bool] = False
    idempotency_key: Optional[str] = None
    create_identities: Optional[bool] = None  # None = inferred by the caller context
    create_api_keys: Optional[bool] = None  # None = caller-context default
    return_api_keys: Optional[bool] = None  # None = caller-context default
    seed_defaults: Optional[bool] = True
    reason: Optional[str] = None


# ---------------------------------------------------------------------------
# User DTOs
# ---------------------------------------------------------------------------


class AdminUserCreateDTO(BaseModel):
    email: str
    username: Optional[str] = None
    name: Optional[str] = None
    is_admin: Optional[bool] = None
    is_root: Optional[bool] = None
    metadata: Optional[Dict[str, Any]] = None


class AdminUserReadDTO(BaseModel):
    id: str
    uid: str
    email: str
    username: Optional[str] = None
    name: Optional[str] = None
    is_admin: Optional[bool] = None
    is_root: Optional[bool] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# User Identity DTOs
# ---------------------------------------------------------------------------


class AdminUserIdentityCreateDTO(BaseModel):
    user_ref: Optional[EntityRef] = None  # optional when nested under users
    method: IdentityMethod
    subject: str
    domain: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    verified: Optional[bool] = None
    provider_user_id: Optional[str] = None
    claims: Optional[Dict[str, Any]] = None


class AdminUserIdentityReadDTO(BaseModel):
    id: Optional[str] = None
    user_id: str
    method: IdentityMethod
    subject: str
    domain: Optional[str] = None
    email: Optional[str] = None
    status: Literal[
        "created", "linked", "pending_confirmation", "skipped", "failed"
    ] = "created"
    verified: Optional[bool] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Organization DTOs
# ---------------------------------------------------------------------------


class AdminOrganizationCreateDTO(BaseModel):
    name: str
    slug: Optional[str] = None
    owner_user_ref: Optional[EntityRef] = None
    metadata: Optional[Dict[str, Any]] = None


class AdminSubscriptionCreateDTO(BaseModel):
    plan: str  # EE plan slug, e.g. "cloud_v0_hobby", "self_hosted_enterprise"


class AdminSubscriptionReadDTO(BaseModel):
    plan: str
    active: Optional[bool] = None


class AdminOrganizationReadDTO(BaseModel):
    id: str
    name: str
    slug: Optional[str] = None
    owner_user_id: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Workspace DTOs
# ---------------------------------------------------------------------------


class AdminWorkspaceCreateDTO(BaseModel):
    name: str
    slug: Optional[str] = None
    organization_ref: EntityRef
    metadata: Optional[Dict[str, Any]] = None


class AdminWorkspaceReadDTO(BaseModel):
    id: str
    name: str
    slug: Optional[str] = None
    organization_id: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Project DTOs
# ---------------------------------------------------------------------------


class AdminProjectCreateDTO(BaseModel):
    name: str
    slug: Optional[str] = None
    organization_ref: EntityRef
    workspace_ref: EntityRef
    is_default: Optional[bool] = None
    metadata: Optional[Dict[str, Any]] = None


class AdminProjectReadDTO(BaseModel):
    id: str
    name: str
    slug: Optional[str] = None
    organization_id: str
    workspace_id: str
    is_default: Optional[bool] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Membership DTOs
# ---------------------------------------------------------------------------


class AdminOrganizationMembershipCreateDTO(BaseModel):
    organization_ref: EntityRef
    user_ref: EntityRef
    role: str


class AdminOrganizationMembershipReadDTO(BaseModel):
    id: str
    organization_id: str
    user_id: str
    role: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AdminWorkspaceMembershipCreateDTO(BaseModel):
    workspace_ref: EntityRef
    user_ref: EntityRef
    role: str


class AdminWorkspaceMembershipReadDTO(BaseModel):
    id: str
    workspace_id: str
    user_id: str
    role: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AdminProjectMembershipCreateDTO(BaseModel):
    project_ref: EntityRef
    user_ref: EntityRef
    role: str


class AdminProjectMembershipReadDTO(BaseModel):
    id: str
    project_id: str
    user_id: str
    role: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ---------------------------------------------------------------------------
# API Key DTOs
# ---------------------------------------------------------------------------


class AdminApiKeyCreateDTO(BaseModel):
    project_ref: EntityRef
    user_ref: EntityRef
    name: Optional[str] = None
    expires_at: Optional[str] = None


class AdminApiKeyReadDTO(BaseModel):
    id: Optional[str] = None
    prefix: str
    name: Optional[str] = None
    project_id: str
    user_id: str
    expires_at: Optional[str] = None
    created_at: Optional[str] = None
    revoked_at: Optional[str] = None


class AdminApiKeyResponseDTO(AdminApiKeyReadDTO):
    value: Optional[str] = None
    returned_once: Optional[bool] = None


# ---------------------------------------------------------------------------
# Structured Error
# ---------------------------------------------------------------------------


class AdminStructuredErrorDTO(BaseModel):
    code: str
    message: str
    details: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Account Projection (groups one user's graph)
# ---------------------------------------------------------------------------


class AdminAccountReadDTO(BaseModel):
    """Per-account projection in the full graph response (plural entity maps)."""

    users: Dict[UserRef, AdminUserReadDTO] = {}
    user_identities: Dict[UserIdentityRef, AdminUserIdentityReadDTO] = {}
    organizations: Dict[OrganizationRef, AdminOrganizationReadDTO] = {}
    workspaces: Dict[WorkspaceRef, AdminWorkspaceReadDTO] = {}
    projects: Dict[ProjectRef, AdminProjectReadDTO] = {}
    organization_memberships: Dict[
        MembershipRef, AdminOrganizationMembershipReadDTO
    ] = {}
    workspace_memberships: Dict[MembershipRef, AdminWorkspaceMembershipReadDTO] = {}
    project_memberships: Dict[MembershipRef, AdminProjectMembershipReadDTO] = {}
    subscriptions: Optional[Dict[OrganizationRef, AdminSubscriptionReadDTO]] = None
    api_keys: Optional[Dict[ApiKeyRef, AdminApiKeyResponseDTO]] = None


class AdminSimpleAccountReadDTO(BaseModel):
    """Per-account entry in the simple-accounts response.

    ``user`` is a flat object (there is always exactly one per account).
    ``organizations``, ``workspaces``, ``projects`` are named dicts (keys match
    the ref keys used internally, e.g. "org", "wrk", "prj").
    ``api_keys`` maps ref names to raw key values (plain strings, not DTOs).
    """

    user: Optional[AdminUserReadDTO] = None
    user_identities: Optional[List[AdminUserIdentityReadDTO]] = None
    organizations: Optional[Dict[str, AdminOrganizationReadDTO]] = None
    workspaces: Optional[Dict[str, AdminWorkspaceReadDTO]] = None
    projects: Optional[Dict[str, AdminProjectReadDTO]] = None
    organization_memberships: Optional[List[AdminOrganizationMembershipReadDTO]] = None
    workspace_memberships: Optional[List[AdminWorkspaceMembershipReadDTO]] = None
    project_memberships: Optional[List[AdminProjectMembershipReadDTO]] = None
    subscriptions: Optional[Dict[str, AdminSubscriptionReadDTO]] = None
    api_keys: Optional[Dict[str, str]] = None


# ---------------------------------------------------------------------------
# Response DTOs
# ---------------------------------------------------------------------------


class AdminAccountsResponseDTO(BaseModel):
    """Response for the full graph endpoint (POST /accounts/)."""

    accounts: List[AdminAccountReadDTO] = []
    errors: Optional[List[AdminStructuredErrorDTO]] = None


class AdminSimpleAccountsResponseDTO(BaseModel):
    """Response for the simple batch endpoint (POST /simple/accounts/).

    ``accounts`` is keyed by the same refs used in the request so callers
    can look up each created account directly.
    """

    accounts: Dict[AccountRef, AdminSimpleAccountReadDTO] = {}
    errors: Optional[List[AdminStructuredErrorDTO]] = None


# ---------------------------------------------------------------------------
# Delete DTOs
# ---------------------------------------------------------------------------


class AdminDeletedEntityDTO(BaseModel):
    id: str
    ref: Optional[str] = None


class AdminDeletedEntitiesDTO(BaseModel):
    users: Optional[List[AdminDeletedEntityDTO]] = None
    user_identities: Optional[List[AdminDeletedEntityDTO]] = None
    organizations: Optional[List[AdminDeletedEntityDTO]] = None
    workspaces: Optional[List[AdminDeletedEntityDTO]] = None
    projects: Optional[List[AdminDeletedEntityDTO]] = None
    organization_memberships: Optional[List[AdminDeletedEntityDTO]] = None
    workspace_memberships: Optional[List[AdminDeletedEntityDTO]] = None
    project_memberships: Optional[List[AdminDeletedEntityDTO]] = None
    api_keys: Optional[List[AdminDeletedEntityDTO]] = None


class AdminDeleteResponseDTO(BaseModel):
    dry_run: bool = False
    deleted: AdminDeletedEntitiesDTO = AdminDeletedEntitiesDTO()
    skipped: Optional[AdminDeletedEntitiesDTO] = None
    errors: Optional[List[AdminStructuredErrorDTO]] = None


# ---------------------------------------------------------------------------
# Account Graph Create / Delete DTOs
# ---------------------------------------------------------------------------


class AdminAccountsCreateDTO(BaseModel):
    options: Optional[AdminAccountCreateOptionsDTO] = None
    users: Optional[Dict[UserRef, AdminUserCreateDTO]] = None
    user_identities: Optional[Dict[UserIdentityRef, AdminUserIdentityCreateDTO]] = None
    organizations: Optional[Dict[OrganizationRef, AdminOrganizationCreateDTO]] = None
    workspaces: Optional[Dict[WorkspaceRef, AdminWorkspaceCreateDTO]] = None
    projects: Optional[Dict[ProjectRef, AdminProjectCreateDTO]] = None
    organization_memberships: Optional[
        Dict[MembershipRef, AdminOrganizationMembershipCreateDTO]
    ] = None
    workspace_memberships: Optional[
        Dict[MembershipRef, AdminWorkspaceMembershipCreateDTO]
    ] = None
    project_memberships: Optional[
        Dict[MembershipRef, AdminProjectMembershipCreateDTO]
    ] = None
    api_keys: Optional[Dict[ApiKeyRef, AdminApiKeyCreateDTO]] = None
    subscriptions: Optional[Dict[OrganizationRef, AdminSubscriptionCreateDTO]] = None


class AdminAccountsDeleteTargetDTO(BaseModel):
    user_ids: Optional[List[str]] = None
    user_emails: Optional[List[str]] = None
    organization_ids: Optional[List[str]] = None
    workspace_ids: Optional[List[str]] = None
    project_ids: Optional[List[str]] = None


class AdminAccountsDeleteDTO(BaseModel):
    target: AdminAccountsDeleteTargetDTO
    dry_run: Optional[bool] = True
    reason: Optional[str] = None
    confirm: Optional[str] = None


# ---------------------------------------------------------------------------
# Simple Account Create / Delete DTOs
# ---------------------------------------------------------------------------


class AdminSimpleAccountCreateDTO(BaseModel):
    """One account entry in a batch simple-accounts create request."""

    options: Optional[AdminAccountCreateOptionsDTO] = None
    user: AdminUserCreateDTO
    user_identities: Optional[List[AdminUserIdentityCreateDTO]] = None
    organization: Optional[AdminOrganizationCreateDTO] = None
    workspace: Optional[AdminWorkspaceCreateDTO] = None
    project: Optional[AdminProjectCreateDTO] = None
    organization_memberships: Optional[List[AdminOrganizationMembershipCreateDTO]] = (
        None
    )
    workspace_memberships: Optional[List[AdminWorkspaceMembershipCreateDTO]] = None
    project_memberships: Optional[List[AdminProjectMembershipCreateDTO]] = None
    api_keys: Optional[List[AdminApiKeyCreateDTO]] = None
    subscription: Optional[AdminSubscriptionCreateDTO] = None


class AdminSimpleAccountsCreateDTO(BaseModel):
    """Batch simple-accounts create.

    ``accounts`` is a caller-keyed map of account entries.  Each entry
    scaffolds one user with their own org → workspace → project graph.
    Per-account ``options`` override the top-level ``options`` defaults.
    """

    options: Optional[AdminAccountCreateOptionsDTO] = None
    accounts: Dict[AccountRef, AdminSimpleAccountCreateDTO]


class AdminSimpleAccountDeleteEntryDTO(BaseModel):
    """One account entry in a batch simple-accounts delete request.

    Identifies the account by its user (typically by id).
    """

    user: EntityRef


class AdminSimpleAccountsDeleteDTO(BaseModel):
    """Batch simple-accounts delete.

    ``accounts`` is a caller-keyed map of entries to delete.
    Each entry identifies the account by its user ref.
    """

    accounts: Dict[AccountRef, AdminSimpleAccountDeleteEntryDTO]
    dry_run: Optional[bool] = False
    reason: Optional[str] = None
    confirm: Optional[str] = None


# ---------------------------------------------------------------------------
# Simple Entity Create DTOs
# ---------------------------------------------------------------------------


class AdminSimpleAccountsUsersCreateDTO(BaseModel):
    options: Optional[AdminAccountCreateOptionsDTO] = None
    user: AdminUserCreateDTO


class AdminSimpleAccountsUsersIdentitiesCreateDTO(BaseModel):
    options: Optional[AdminAccountCreateOptionsDTO] = None
    user_ref: EntityRef
    user_identity: AdminUserIdentityCreateDTO


class AdminSimpleAccountsOrganizationsCreateDTO(BaseModel):
    options: Optional[AdminAccountCreateOptionsDTO] = None
    organization: AdminOrganizationCreateDTO
    owner: Optional[AdminUserCreateDTO] = None


class AdminSimpleAccountsOrganizationsMembershipsCreateDTO(BaseModel):
    options: Optional[AdminAccountCreateOptionsDTO] = None
    membership: AdminOrganizationMembershipCreateDTO


class AdminSimpleAccountsWorkspacesCreateDTO(BaseModel):
    options: Optional[AdminAccountCreateOptionsDTO] = None
    workspace: AdminWorkspaceCreateDTO


class AdminSimpleAccountsWorkspacesMembershipsCreateDTO(BaseModel):
    options: Optional[AdminAccountCreateOptionsDTO] = None
    membership: AdminWorkspaceMembershipCreateDTO


class AdminSimpleAccountsProjectsCreateDTO(BaseModel):
    options: Optional[AdminAccountCreateOptionsDTO] = None
    project: AdminProjectCreateDTO


class AdminSimpleAccountsProjectsMembershipsCreateDTO(BaseModel):
    options: Optional[AdminAccountCreateOptionsDTO] = None
    membership: AdminProjectMembershipCreateDTO


class AdminSimpleAccountsApiKeysCreateDTO(BaseModel):
    options: Optional[AdminAccountCreateOptionsDTO] = None
    api_key: AdminApiKeyCreateDTO


# ---------------------------------------------------------------------------
# Action DTOs
# ---------------------------------------------------------------------------


class AdminSimpleAccountsUsersResetPasswordDTO(BaseModel):
    """Patch the password on one or more existing identities.

    Each identity is matched by method + subject (or email); only the
    password field is updated.  No user ID in the path — the subject is
    the lookup key.  Pass multiple entries to reset several identities
    in one call.
    """

    user_identities: List[AdminUserIdentityCreateDTO]


class AdminSimpleAccountsOrganizationsTransferOwnershipDTO(BaseModel):
    """Transfer ownership of one or more organizations from one user to another.

    ``organizations`` is a keyed map of org refs; omit to transfer all orgs owned
    by the source user.
    ``users`` is a two-key dict: "source" (current owner) and "target" (new owner).
    Both ``include_workspaces`` and ``include_projects`` default to "all".
    """

    organizations: Optional[Dict[str, EntityRef]] = None  # None = all owned orgs
    users: Dict[str, EntityRef]  # keys: "source", "target"
    include_workspaces: Union[Literal["all"], List[str]] = "all"
    include_projects: Union[Literal["all"], List[str]] = "all"
    reason: Optional[str] = None
    recovery: Optional[bool] = None


class AdminSimpleAccountsOrganizationsTransferOwnershipResponseDTO(BaseModel):
    """Response for the transfer-ownership endpoint.

    ``transferred`` lists the IDs of organizations whose ownership was updated.
    ``errors`` lists any org refs that were requested but not transferred
    (e.g. not owned by the source user).
    """

    transferred: List[str] = []
    errors: Optional[List[AdminStructuredErrorDTO]] = None

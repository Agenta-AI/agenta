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


class AdminAccountCreateOptions(BaseModel):
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


class AdminUserCreate(BaseModel):
    email: str
    username: Optional[str] = None
    name: Optional[str] = None
    is_admin: Optional[bool] = None
    is_root: Optional[bool] = None
    metadata: Optional[Dict[str, Any]] = None


class AdminUserRead(BaseModel):
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


class AdminUserIdentityCreate(BaseModel):
    user_ref: Optional[EntityRef] = None  # optional when nested under users
    method: IdentityMethod
    subject: str
    domain: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    verified: Optional[bool] = None
    provider_user_id: Optional[str] = None
    claims: Optional[Dict[str, Any]] = None


class AdminUserIdentityRead(BaseModel):
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


class AdminOrganizationCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    owner_user_ref: Optional[EntityRef] = None
    metadata: Optional[Dict[str, Any]] = None


class AdminSubscriptionCreate(BaseModel):
    plan: str  # EE plan slug, e.g. "cloud_v0_hobby", "self_hosted_enterprise"


class AdminSubscriptionRead(BaseModel):
    plan: str
    active: Optional[bool] = None


class AdminOrganizationRead(BaseModel):
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


class AdminWorkspaceCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    organization_ref: EntityRef
    metadata: Optional[Dict[str, Any]] = None


class AdminWorkspaceRead(BaseModel):
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


class AdminProjectCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    organization_ref: EntityRef
    workspace_ref: EntityRef
    is_default: Optional[bool] = None
    metadata: Optional[Dict[str, Any]] = None


class AdminProjectRead(BaseModel):
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


class AdminOrganizationMembershipCreate(BaseModel):
    organization_ref: EntityRef
    user_ref: EntityRef
    role: str


class AdminOrganizationMembershipRead(BaseModel):
    id: str
    organization_id: str
    user_id: str
    role: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AdminWorkspaceMembershipCreate(BaseModel):
    workspace_ref: EntityRef
    user_ref: EntityRef
    role: str


class AdminWorkspaceMembershipRead(BaseModel):
    id: str
    workspace_id: str
    user_id: str
    role: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AdminProjectMembershipCreate(BaseModel):
    project_ref: EntityRef
    user_ref: EntityRef
    role: str


class AdminProjectMembershipRead(BaseModel):
    id: str
    project_id: str
    user_id: str
    role: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


# ---------------------------------------------------------------------------
# API Key DTOs
# ---------------------------------------------------------------------------


class AdminApiKeyCreate(BaseModel):
    project_ref: EntityRef
    user_ref: EntityRef
    name: Optional[str] = None
    expires_at: Optional[str] = None


class AdminApiKeyRead(BaseModel):
    id: Optional[str] = None
    prefix: str
    name: Optional[str] = None
    project_id: str
    user_id: str
    expires_at: Optional[str] = None
    created_at: Optional[str] = None
    revoked_at: Optional[str] = None


class AdminApiKeyResponse(AdminApiKeyRead):
    value: Optional[str] = None
    returned_once: Optional[bool] = None


# ---------------------------------------------------------------------------
# Structured Error
# ---------------------------------------------------------------------------


class AdminStructuredError(BaseModel):
    code: str
    message: str
    details: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Account Projection (groups one user's graph)
# ---------------------------------------------------------------------------


class AdminAccountRead(BaseModel):
    """Per-account projection in the full graph response (plural entity maps)."""

    users: Dict[UserRef, AdminUserRead] = {}
    user_identities: Dict[UserIdentityRef, AdminUserIdentityRead] = {}
    organizations: Dict[OrganizationRef, AdminOrganizationRead] = {}
    workspaces: Dict[WorkspaceRef, AdminWorkspaceRead] = {}
    projects: Dict[ProjectRef, AdminProjectRead] = {}
    organization_memberships: Dict[MembershipRef, AdminOrganizationMembershipRead] = {}
    workspace_memberships: Dict[MembershipRef, AdminWorkspaceMembershipRead] = {}
    project_memberships: Dict[MembershipRef, AdminProjectMembershipRead] = {}
    subscriptions: Optional[Dict[OrganizationRef, AdminSubscriptionRead]] = None
    api_keys: Optional[Dict[ApiKeyRef, AdminApiKeyResponse]] = None


class AdminSimpleAccountRead(BaseModel):
    """Per-account entry in the simple-accounts response.

    ``user`` is a flat object (there is always exactly one per account).
    ``organizations``, ``workspaces``, ``projects`` are named dicts (keys match
    the ref keys used internally, e.g. "org", "wrk", "prj").
    ``api_keys`` maps ref names to raw key values (plain strings, not DTOs).
    """

    user: Optional[AdminUserRead] = None
    user_identities: Optional[List[AdminUserIdentityRead]] = None
    organizations: Optional[Dict[str, AdminOrganizationRead]] = None
    workspaces: Optional[Dict[str, AdminWorkspaceRead]] = None
    projects: Optional[Dict[str, AdminProjectRead]] = None
    organization_memberships: Optional[List[AdminOrganizationMembershipRead]] = None
    workspace_memberships: Optional[List[AdminWorkspaceMembershipRead]] = None
    project_memberships: Optional[List[AdminProjectMembershipRead]] = None
    subscriptions: Optional[Dict[str, AdminSubscriptionRead]] = None
    api_keys: Optional[Dict[str, str]] = None


# ---------------------------------------------------------------------------
# Response DTOs
# ---------------------------------------------------------------------------


class AdminAccountsResponse(BaseModel):
    """Response for the full graph endpoint (POST /accounts/)."""

    accounts: List[AdminAccountRead] = []
    errors: Optional[List[AdminStructuredError]] = None


class AdminSimpleAccountsResponse(BaseModel):
    """Response for the simple batch endpoint (POST /simple/accounts/).

    ``accounts`` is keyed by the same refs used in the request so callers
    can look up each created account directly.
    """

    accounts: Dict[AccountRef, AdminSimpleAccountRead] = {}
    errors: Optional[List[AdminStructuredError]] = None


# ---------------------------------------------------------------------------
# Delete DTOs
# ---------------------------------------------------------------------------


class AdminDeletedEntity(BaseModel):
    id: str
    ref: Optional[str] = None


class AdminDeletedEntities(BaseModel):
    users: Optional[List[AdminDeletedEntity]] = None
    user_identities: Optional[List[AdminDeletedEntity]] = None
    organizations: Optional[List[AdminDeletedEntity]] = None
    workspaces: Optional[List[AdminDeletedEntity]] = None
    projects: Optional[List[AdminDeletedEntity]] = None
    organization_memberships: Optional[List[AdminDeletedEntity]] = None
    workspace_memberships: Optional[List[AdminDeletedEntity]] = None
    project_memberships: Optional[List[AdminDeletedEntity]] = None
    api_keys: Optional[List[AdminDeletedEntity]] = None


class AdminDeleteResponse(BaseModel):
    dry_run: bool = False
    deleted: AdminDeletedEntities = AdminDeletedEntities()
    skipped: Optional[AdminDeletedEntities] = None
    errors: Optional[List[AdminStructuredError]] = None


# ---------------------------------------------------------------------------
# Account Graph Create / Delete DTOs
# ---------------------------------------------------------------------------


class AdminAccountsCreate(BaseModel):
    options: Optional[AdminAccountCreateOptions] = None
    users: Optional[Dict[UserRef, AdminUserCreate]] = None
    user_identities: Optional[Dict[UserIdentityRef, AdminUserIdentityCreate]] = None
    organizations: Optional[Dict[OrganizationRef, AdminOrganizationCreate]] = None
    workspaces: Optional[Dict[WorkspaceRef, AdminWorkspaceCreate]] = None
    projects: Optional[Dict[ProjectRef, AdminProjectCreate]] = None
    organization_memberships: Optional[
        Dict[MembershipRef, AdminOrganizationMembershipCreate]
    ] = None
    workspace_memberships: Optional[
        Dict[MembershipRef, AdminWorkspaceMembershipCreate]
    ] = None
    project_memberships: Optional[Dict[MembershipRef, AdminProjectMembershipCreate]] = (
        None
    )
    api_keys: Optional[Dict[ApiKeyRef, AdminApiKeyCreate]] = None
    subscriptions: Optional[Dict[OrganizationRef, AdminSubscriptionCreate]] = None


class AdminAccountsDeleteTarget(BaseModel):
    user_ids: Optional[List[str]] = None
    user_emails: Optional[List[str]] = None
    organization_ids: Optional[List[str]] = None
    workspace_ids: Optional[List[str]] = None
    project_ids: Optional[List[str]] = None


class AdminAccountsDelete(BaseModel):
    target: AdminAccountsDeleteTarget
    dry_run: Optional[bool] = True
    reason: Optional[str] = None
    confirm: Optional[str] = None


# ---------------------------------------------------------------------------
# Simple Account Create / Delete DTOs
# ---------------------------------------------------------------------------


class AdminSimpleAccountCreate(BaseModel):
    """One account entry in a batch simple-accounts create request."""

    options: Optional[AdminAccountCreateOptions] = None
    user: AdminUserCreate
    user_identities: Optional[List[AdminUserIdentityCreate]] = None
    organization: Optional[AdminOrganizationCreate] = None
    workspace: Optional[AdminWorkspaceCreate] = None
    project: Optional[AdminProjectCreate] = None
    organization_memberships: Optional[List[AdminOrganizationMembershipCreate]] = None
    workspace_memberships: Optional[List[AdminWorkspaceMembershipCreate]] = None
    project_memberships: Optional[List[AdminProjectMembershipCreate]] = None
    api_keys: Optional[List[AdminApiKeyCreate]] = None
    subscription: Optional[AdminSubscriptionCreate] = None


class AdminSimpleAccountsCreate(BaseModel):
    """Batch simple-accounts create.

    ``accounts`` is a caller-keyed map of account entries.  Each entry
    scaffolds one user with their own org → workspace → project graph.
    Per-account ``options`` override the top-level ``options`` defaults.
    """

    options: Optional[AdminAccountCreateOptions] = None
    accounts: Dict[AccountRef, AdminSimpleAccountCreate]


class AdminSimpleAccountDeleteEntry(BaseModel):
    """One account entry in a batch simple-accounts delete request.

    Identifies the account by its user (typically by id).
    """

    user: EntityRef


class AdminSimpleAccountsDelete(BaseModel):
    """Batch simple-accounts delete.

    ``accounts`` is a caller-keyed map of entries to delete.
    Each entry identifies the account by its user ref.
    """

    accounts: Dict[AccountRef, AdminSimpleAccountDeleteEntry]
    dry_run: Optional[bool] = False
    reason: Optional[str] = None
    confirm: Optional[str] = None


# ---------------------------------------------------------------------------
# Simple Entity Create DTOs
# ---------------------------------------------------------------------------


class AdminSimpleAccountsUsersCreate(BaseModel):
    options: Optional[AdminAccountCreateOptions] = None
    user: AdminUserCreate


class AdminSimpleAccountsUsersIdentitiesCreate(BaseModel):
    options: Optional[AdminAccountCreateOptions] = None
    user_ref: EntityRef
    user_identity: AdminUserIdentityCreate


class AdminSimpleAccountsOrganizationsCreate(BaseModel):
    options: Optional[AdminAccountCreateOptions] = None
    organization: AdminOrganizationCreate
    owner: Optional[AdminUserCreate] = None


class AdminSimpleAccountsOrganizationsMembershipsCreate(BaseModel):
    options: Optional[AdminAccountCreateOptions] = None
    membership: AdminOrganizationMembershipCreate


class AdminSimpleAccountsWorkspacesCreate(BaseModel):
    options: Optional[AdminAccountCreateOptions] = None
    workspace: AdminWorkspaceCreate


class AdminSimpleAccountsWorkspacesMembershipsCreate(BaseModel):
    options: Optional[AdminAccountCreateOptions] = None
    membership: AdminWorkspaceMembershipCreate


class AdminSimpleAccountsProjectsCreate(BaseModel):
    options: Optional[AdminAccountCreateOptions] = None
    project: AdminProjectCreate


class AdminSimpleAccountsProjectsMembershipsCreate(BaseModel):
    options: Optional[AdminAccountCreateOptions] = None
    membership: AdminProjectMembershipCreate


class AdminSimpleAccountsApiKeysCreate(BaseModel):
    options: Optional[AdminAccountCreateOptions] = None
    api_key: AdminApiKeyCreate


# ---------------------------------------------------------------------------
# Action DTOs
# ---------------------------------------------------------------------------


class AdminSimpleAccountsUsersResetPassword(BaseModel):
    """Patch the password on one or more existing identities.

    Each identity is matched by method + subject (or email); only the
    password field is updated.  No user ID in the path — the subject is
    the lookup key.  Pass multiple entries to reset several identities
    in one call.
    """

    user_identities: List[AdminUserIdentityCreate]


class AdminSimpleAccountsOrganizationsTransferOwnership(BaseModel):
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


class AdminSimpleAccountsOrganizationsTransferOwnershipResponse(BaseModel):
    """Response for the transfer-ownership endpoint.

    ``transferred`` lists the IDs of organizations whose ownership was updated.
    ``errors`` lists any org refs that were requested but not transferred
    (e.g. not owned by the source user).
    """

    transferred: List[str] = []
    errors: Optional[List[AdminStructuredError]] = None

"""
Platform Admin Accounts Service.

Orchestrates account graph creation and deletion using existing
services/managers.  No new DAO is introduced here — this layer
wires existing persistence helpers together with validation and
reference-resolution logic.
"""

from __future__ import annotations

import uuid as _uuid_mod
from typing import Dict, List, Optional
from uuid import UUID

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.services.api_key_service import create_api_key as _create_raw_api_key
from oss.src.services.db_manager import (
    admin_get_user_by_id as _db_get_user_by_id,
    admin_get_user_by_email as _db_get_user_by_email,
    admin_get_org_by_id as _db_get_org_by_id,
    admin_get_org_by_slug as _db_get_org_by_slug,
    admin_get_workspace_by_id as _db_get_workspace_by_id,
    admin_get_project_by_id as _db_get_project_by_id,
    admin_get_api_key_by_id as _db_get_api_key_by_id,
    admin_get_api_key_by_prefix as _db_get_api_key_by_prefix,
    admin_get_orgs_owned_by_user as _db_get_orgs_owned_by_user,
    admin_get_workspace_ids_for_orgs as _db_get_workspace_ids_for_orgs,
    admin_get_project_ids_for_orgs as _db_get_project_ids_for_orgs,
    admin_get_or_create_user as _db_get_or_create_user,
    admin_create_organization as _db_create_organization,
    admin_create_workspace as _db_create_workspace,
    admin_create_project as _db_create_project,
    admin_delete_organization as _db_delete_organization,
    admin_delete_workspace as _db_delete_workspace,
    admin_delete_project as _db_delete_project,
    admin_delete_api_key as _db_delete_api_key,
    admin_delete_accounts_batch as _db_delete_accounts_batch,
    admin_delete_user_with_cascade as _db_delete_user_with_cascade,
    admin_transfer_org_ownership_batch as _db_transfer_org_ownership_batch,
    get_or_bootstrap_oss_organization as _db_get_or_bootstrap_oss_organization,
    _assign_user_to_organization_oss as _db_assign_user_to_organization_oss,
    get_default_project_by_organization_id as _db_get_default_project_by_organization_id,
    OSS_SINGLETON_ORG_SLUG,
)
from oss.src.core.environments.defaults import (
    create_default_environments as _create_default_environments,
)
from oss.src.core.evaluators.defaults import (
    create_default_evaluators as _create_default_evaluators,
)
from oss.src.models.db_models import (
    APIKeyDB,
    OrganizationDB,
    ProjectDB,
    UserDB,
    WorkspaceDB,
)

try:
    from ee.src.services.db_manager_ee import (  # type: ignore[import]
        admin_delete_org_membership as _ee_delete_org_membership,
        admin_delete_workspace_membership as _ee_delete_workspace_membership,
        admin_delete_project_membership as _ee_delete_project_membership,
        admin_delete_user_memberships as _ee_delete_user_memberships,
        admin_get_member_org_ids as _ee_get_member_org_ids,
        admin_swap_org_memberships as _ee_swap_org_memberships,
        admin_swap_workspace_memberships as _ee_swap_workspace_memberships,
        admin_swap_project_memberships as _ee_swap_project_memberships,
    )
    from ee.src.services.admin_manager import (  # type: ignore[import]
        Reference as _EeReference,
        OrganizationMembershipRequest as _EeOrgMembershipReq,
        WorkspaceMembershipRequest as _EeWsMembershipReq,
        ProjectMembershipRequest as _EeProjectMembershipReq,
        create_organization_membership as _ee_create_org_membership,
        create_workspace_membership as _ee_create_ws_membership,
        create_project_membership as _ee_create_project_membership,
    )
    from ee.src.core.subscriptions.service import (  # type: ignore[import]
        SubscriptionsService as _EeSubscriptionsService,
    )
    from ee.src.dbs.postgres.subscriptions.dao import (  # type: ignore[import]
        SubscriptionsDAO as _EeSubscriptionsDAO,
    )
    from ee.src.core.subscriptions.types import (  # type: ignore[import]
        get_default_plan as _ee_get_default_plan,
        Plan as _EePlan,
    )
    from ee.src.core.meters.service import MetersService as _EeMetersService  # type: ignore[import]
    from ee.src.dbs.postgres.meters.dao import MetersDAO as _EeMetersDAO  # type: ignore[import]

    _ee_subscription_service = _EeSubscriptionsService(
        subscriptions_dao=_EeSubscriptionsDAO(),
        meters_service=_EeMetersService(meters_dao=_EeMetersDAO()),
    )
except ImportError:
    pass

# SuperTokens — imported lazily-style at module level to keep the import
# unconditional; the service will only call these when ST is initialised.
from supertokens_python.types.base import AccountInfoInput as _StAccountInfoInput
from supertokens_python.types import RecipeUserId as _StRecipeUserId
from supertokens_python.asyncio import (
    list_users_by_account_info as _st_list_users_by_account_info,
)
import supertokens_python.recipe.emailpassword.asyncio as _ep
from supertokens_python.recipe.emailpassword.interfaces import (
    SignUpOkResult as _EpSignUpOkResult,
    EmailAlreadyExistsError as _EpEmailAlreadyExistsError,
    UnknownUserIdError as _EpUnknownUserIdError,
    PasswordPolicyViolationError as _EpPasswordPolicyViolationError,
)
from supertokens_python.recipe.passwordless.asyncio import (
    signinup as _pwl_signinup,
)

from oss.src.utils.env import env

from oss.src.core.accounts.dtos import (
    AdminAccountCreateOptions,
    AdminAccountRead,
    AdminAccountsCreate,
    AdminAccountsDelete,
    AdminAccountsResponse,
    AdminApiKeyCreate,
    AdminApiKeyResponse,
    AdminDeleteResponse,
    AdminDeletedEntities,
    AdminDeletedEntity,
    AdminOrganizationCreate,
    AdminOrganizationMembershipCreate,
    AdminOrganizationMembershipRead,
    AdminOrganizationRead,
    AdminSubscriptionRead,
    AdminProjectCreate,
    AdminProjectMembershipCreate,
    AdminProjectMembershipRead,
    AdminProjectRead,
    AdminSimpleAccountCreate,
    AdminSimpleAccountRead,
    AdminSimpleAccountsApiKeysCreate,
    AdminSimpleAccountsCreate,
    AdminSimpleAccountsResponse,
    AdminSimpleAccountsDelete,
    AdminSimpleAccountsOrganizationsCreate,
    AdminSimpleAccountsOrganizationsMembershipsCreate,
    AdminSimpleAccountsProjectsCreate,
    AdminSimpleAccountsProjectsMembershipsCreate,
    AdminSimpleAccountsUsersCreate,
    AdminSimpleAccountsUsersIdentitiesCreate,
    AdminSimpleAccountsWorkspacesCreate,
    AdminSimpleAccountsWorkspacesMembershipsCreate,
    AdminSimpleAccountsUsersResetPassword,
    AdminSimpleAccountsOrganizationsTransferOwnership,
    AdminSimpleAccountsOrganizationsTransferOwnershipResponse,
    AdminStructuredError,
    AdminUserCreate,
    AdminUserIdentityRead,
    AdminUserRead,
    AdminWorkspaceCreate,
    AdminWorkspaceMembershipCreate,
    AdminWorkspaceMembershipRead,
    AdminWorkspaceRead,
    EntityRef,
)
from oss.src.core.accounts.errors import (
    AdminApiKeyNotFoundError,
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

log = get_module_logger(__name__)

# ---------------------------------------------------------------------------
# Internal reference tracker
# ---------------------------------------------------------------------------


class _Tracker:
    """Maps request-local ref keys to resolved UUIDs across a single request."""

    def __init__(self) -> None:
        self.users: Dict[str, UUID] = {}
        self.organizations: Dict[str, UUID] = {}
        self.workspaces: Dict[str, UUID] = {}
        self.projects: Dict[str, UUID] = {}
        self.organization_memberships: Dict[str, UUID] = {}
        self.workspace_memberships: Dict[str, UUID] = {}
        self.project_memberships: Dict[str, UUID] = {}
        self.api_keys: Dict[str, UUID] = {}

    def resolve(
        self,
        ref: EntityRef,
        namespace: str,
        path: str,
    ) -> UUID:
        """Resolve an EntityRef to a UUID.

        - ``{ref: key}``  → look up in the in-request tracker namespace.
        - ``{id: uuid}``  → parse directly.
        - ``{slug: ...}`` → not resolved here; caller must do the DB look-up.
        """
        if ref.id is not None:
            try:
                return UUID(ref.id)
            except ValueError:
                raise AdminInvalidReferenceError(
                    path, f"'{ref.id}' is not a valid UUID"
                )

        if ref.ref is not None:
            store = getattr(self, namespace, {})
            resolved = store.get(ref.ref)
            if resolved is None:
                raise AdminInvalidReferenceError(
                    path,
                    f"request-local ref '{ref.ref}' was not found in {namespace}",
                )
            return resolved

        # slug — handled by callers that know the entity type
        raise AdminInvalidReferenceError(
            path,
            "slug-based references must be resolved by the caller",
        )


# ---------------------------------------------------------------------------
# DTO mapping helpers
# ---------------------------------------------------------------------------


def _user_db_to_read_dto(user: UserDB) -> AdminUserRead:
    return AdminUserRead(
        id=str(user.id),
        uid=str(user.uid),
        email=user.email,
        username=user.username,
        name=user.username,  # same field, username serves as name
        created_at=user.created_at.isoformat() if user.created_at else None,
        updated_at=user.updated_at.isoformat() if user.updated_at else None,
    )


def _org_db_to_read_dto(org: OrganizationDB) -> AdminOrganizationRead:
    return AdminOrganizationRead(
        id=str(org.id),
        name=org.name or "",
        slug=org.slug,
        owner_user_id=str(org.owner_id) if org.owner_id else None,
        created_at=org.created_at.isoformat() if org.created_at else None,
        updated_at=org.updated_at.isoformat() if org.updated_at else None,
    )


def _ws_db_to_read_dto(ws: WorkspaceDB) -> AdminWorkspaceRead:
    return AdminWorkspaceRead(
        id=str(ws.id),
        name=ws.name or "",
        organization_id=str(ws.organization_id),
        created_at=ws.created_at.isoformat() if ws.created_at else None,
        updated_at=ws.updated_at.isoformat() if ws.updated_at else None,
    )


def _proj_db_to_read_dto(proj: ProjectDB) -> AdminProjectRead:
    return AdminProjectRead(
        id=str(proj.id),
        name=proj.project_name or "",
        organization_id=str(proj.organization_id),
        workspace_id=str(proj.workspace_id),
        is_default=proj.is_default,
        created_at=proj.created_at.isoformat() if proj.created_at else None,
        updated_at=proj.updated_at.isoformat() if proj.updated_at else None,
    )


def _api_key_db_to_response_dto(
    key: APIKeyDB,
    *,
    raw_value: Optional[str] = None,
) -> AdminApiKeyResponse:
    return AdminApiKeyResponse(
        id=str(key.id),
        prefix=key.prefix,
        project_id=str(key.project_id),
        user_id=str(key.created_by_id) if key.created_by_id else "",
        created_at=key.created_at.isoformat() if key.created_at else None,
        value=raw_value,
        returned_once=True if raw_value else None,
    )


# ---------------------------------------------------------------------------
# SuperTokens identity helper
# ---------------------------------------------------------------------------


_SUPPORTED_IDENTITY_METHODS = ("email:password", "email:otp")


def _identity_method_supported(requested: str) -> bool:
    """Return True if the requested identity method can be provisioned via
    `_create_st_email_identity` on this deployment.

    The deployment's effective auth recipe is `env.auth.email_method` —
    "password", "otp", or "" (disabled). We accept:

    - "email:password" on either "password" or "otp" deployments. On "otp",
      `_create_st_email_identity` falls through to passwordless and silently
      drops the password — preserving historical behavior where clients can
      send a password-shaped request and get whatever identity the
      deployment supports.
    - "email:otp" only on "otp" deployments (the password recipe cannot
      provision an OTP identity).

    Both methods are rejected when email auth is disabled.
    """
    if requested not in _SUPPORTED_IDENTITY_METHODS:
        return False
    configured = env.auth.email_method
    if configured == "":
        return False
    if requested == "email:password":
        return True
    if requested == "email:otp":
        return configured == "otp"
    return False


async def _create_st_email_identity(
    *,
    tenant_id: str,
    email: str,
    password: Optional[str],
) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    """Create an email-based SuperTokens identity using the deployment's recipe.

    Returns ``(recipe_user_id, method, error_code, error_message)``. On success
    ``error_code`` and ``error_message`` are ``None`` and ``recipe_user_id`` /
    ``method`` are populated; on failure ``recipe_user_id`` and ``method`` are
    ``None``.

    The auth recipe is inferred from ``env.auth.email_method``:
      - ``"password"`` requires ``password`` and uses ``emailpassword.sign_up``.
      - ``"otp"`` ignores ``password`` and uses ``passwordless.signinup``.
      - ``""`` (disabled) returns ``identity_method_unavailable``.

    Existence is checked explicitly via ``list_users_by_account_info`` before
    creation so the error surface is uniform across recipes.
    """
    method_env = env.auth.email_method

    if method_env == "":
        return (
            None,
            None,
            "identity_method_unavailable",
            "Email identity creation is unavailable in this deployment.",
        )

    existing = await _st_list_users_by_account_info(
        tenant_id=tenant_id,
        account_info=_StAccountInfoInput(email=email),
    )
    if existing:
        return (
            None,
            None,
            "identity_already_exists",
            f"An email identity for '{email}' already exists.",
        )

    if method_env == "password":
        if not password:
            return (
                None,
                None,
                "invalid_identity",
                "email:password identity requires 'password' on this deployment.",
            )
        st_result = await _ep.sign_up(
            tenant_id=tenant_id,
            email=email,
            password=password,
            user_context={"admin_managed": True},
        )
        if isinstance(st_result, _EpEmailAlreadyExistsError):
            return (
                None,
                None,
                "identity_already_exists",
                f"An email identity for '{email}' already exists.",
            )
        if not isinstance(st_result, _EpSignUpOkResult):
            return (
                None,
                None,
                "identity_creation_failed",
                "SuperTokens sign_up returned an unexpected result.",
            )
        return (
            st_result.recipe_user_id.get_as_string(),
            "email:password",
            None,
            None,
        )

    # method_env == "otp" — passwordless. The provided password (if any) is
    # silently ignored: under OTP the deployment authenticates by code.
    pwl_result = await _pwl_signinup(
        tenant_id=tenant_id,
        email=email,
        phone_number=None,
        user_context={"admin_managed": True},
    )
    return (
        pwl_result.recipe_user_id.get_as_string(),
        "email:otp",
        None,
        None,
    )


# ---------------------------------------------------------------------------
# Reference resolution helper
# ---------------------------------------------------------------------------


async def _resolve_entity_ref_to_uuid(
    ref: EntityRef,
    entity_type: str,
    path: str,
    tracker: _Tracker,
) -> UUID:
    """Resolve an EntityRef to a UUID, handling slug look-ups for orgs/workspaces/projects."""
    if ref.id is not None:
        try:
            return UUID(ref.id)
        except ValueError:
            raise AdminInvalidReferenceError(path, f"'{ref.id}' is not a valid UUID")

    if ref.ref is not None:
        resolved = getattr(tracker, entity_type, {}).get(ref.ref)
        if resolved is None:
            raise AdminInvalidReferenceError(
                path,
                f"request-local ref '{ref.ref}' not found in {entity_type}",
            )
        return resolved

    if ref.slug is not None:
        if entity_type == "organizations":
            org = await _db_get_org_by_slug(ref.slug)
            if not org:
                raise AdminOrganizationNotFoundError(ref.slug)
            return org.id
        raise AdminInvalidReferenceError(
            path,
            f"slug-based references are not supported for {entity_type}",
        )

    raise AdminInvalidReferenceError(path, "empty reference")


# ---------------------------------------------------------------------------
# PlatformAdminAccountsService
# ---------------------------------------------------------------------------


class PlatformAdminAccountsService:
    """
    Service for platform admin account operations.

    Uses existing admin_manager helpers and direct DB access.
    No new DAO is introduced.
    """

    # -----------------------------------------------------------------------
    # Account Graph Create
    # -----------------------------------------------------------------------

    async def create_accounts(
        self,
        *,
        dto: AdminAccountsCreate,
    ) -> AdminAccountsResponse:
        options = dto.options or AdminAccountCreateOptions()
        tracker = _Tracker()
        account = AdminAccountRead()
        errors: List[AdminStructuredError] = []

        # 1. Users
        for user_ref, user_create in (dto.users or {}).items():
            user_db = await _db_get_or_create_user(
                user_create.email,
                user_create.username or user_create.name,
            )
            tracker.users[user_ref] = user_db.id
            account.users[user_ref] = _user_db_to_read_dto(user_db)

        # 2. User identities
        if dto.user_identities and options.create_identities:
            tenant_id = "public"
            for identity_ref, identity_create in dto.user_identities.items():
                if not _identity_method_supported(identity_create.method):
                    errors.append(
                        AdminStructuredError(
                            code="not_implemented",
                            message=(
                                f"Identity provisioning for method "
                                f"'{identity_create.method}' is not supported on this "
                                f"deployment (configured email_method="
                                f"'{env.auth.email_method}'; ref: {identity_ref})."
                            ),
                            details={
                                "ref": identity_ref,
                                "method": identity_create.method,
                                "configured_email_method": env.auth.email_method,
                            },
                        )
                    )
                    continue

                email = identity_create.email or identity_create.subject
                password = identity_create.password
                if not email:
                    errors.append(
                        AdminStructuredError(
                            code="invalid_identity",
                            message=(
                                f"email identity requires 'email' (or 'subject') "
                                f"(ref: {identity_ref})."
                            ),
                            details={"ref": identity_ref},
                        )
                    )
                    continue

                # Resolve which internal user this identity belongs to.
                user_id_str: Optional[str] = None
                if identity_create.user_ref and identity_create.user_ref.ref:
                    uid = tracker.users.get(identity_create.user_ref.ref)
                    user_id_str = str(uid) if uid else None
                elif identity_create.user_ref and identity_create.user_ref.id:
                    user_id_str = identity_create.user_ref.id
                elif tracker.users:
                    user_id_str = str(next(iter(tracker.users.values())))

                (
                    rid,
                    created_method,
                    err_code,
                    err_msg,
                ) = await _create_st_email_identity(
                    tenant_id=tenant_id,
                    email=email,
                    password=password,
                )
                if err_code is not None:
                    errors.append(
                        AdminStructuredError(
                            code=err_code,
                            message=f"{err_msg} (ref: {identity_ref}).",
                            details={"ref": identity_ref, "email": email},
                        )
                    )
                    continue

                account.user_identities[identity_ref] = AdminUserIdentityRead(
                    id=rid,
                    user_id=user_id_str or "",
                    method=created_method,
                    subject=email,
                    email=email,
                    verified=identity_create.verified or False,
                    status="created",
                )

        # 3. Organizations
        for org_ref, org_create in (dto.organizations or {}).items():
            owner_id: Optional[UUID] = None
            if org_create.owner_user_ref:
                owner_id = await _resolve_entity_ref_to_uuid(
                    org_create.owner_user_ref,
                    "users",
                    f"organizations.{org_ref}.owner_user_ref",
                    tracker,
                )
            elif tracker.users:
                owner_id = next(iter(tracker.users.values()))

            if not owner_id:
                raise AdminValidationError(
                    f"Organization '{org_ref}' requires a valid owner user."
                )

            org_db = await _db_create_organization(
                org_create.name, org_create.slug, owner_id
            )
            # EE: provision subscription for the newly created org.
            if is_ee():
                try:
                    sub_create = (dto.subscriptions or {}).get(org_ref)
                    plan = (
                        _EePlan(sub_create.plan)
                        if sub_create
                        else _ee_get_default_plan()
                    )
                    sub = await _ee_subscription_service.start_plan(
                        organization_id=str(org_db.id),
                        plan=plan,
                    )
                    account.subscriptions = account.subscriptions or {}
                    account.subscriptions[org_ref] = AdminSubscriptionRead(
                        plan=plan.value,
                        active=sub.active if sub else None,
                    )
                except Exception as exc:
                    log.error(
                        "[admin] subscription provision failed for org %s: %s",
                        org_db.id,
                        exc,
                    )
                    errors.append(
                        AdminStructuredError(
                            code="subscription_provision_failed",
                            message=f"Organization '{org_ref}' created but subscription provisioning failed.",
                            details={
                                "ref": org_ref,
                                "organization_id": str(org_db.id),
                            },
                        )
                    )
            tracker.organizations[org_ref] = org_db.id
            account.organizations[org_ref] = _org_db_to_read_dto(org_db)

        # 4. Workspaces
        for ws_ref, ws_create in (dto.workspaces or {}).items():
            org_id = await _resolve_entity_ref_to_uuid(
                ws_create.organization_ref,
                "organizations",
                f"workspaces.{ws_ref}.organization_ref",
                tracker,
            )
            ws_db = await _db_create_workspace(ws_create.name, org_id)
            tracker.workspaces[ws_ref] = ws_db.id
            account.workspaces[ws_ref] = _ws_db_to_read_dto(ws_db)

        # 5. Projects
        user_id_for_seed = next(iter(tracker.users.values()), None)
        for proj_ref, proj_create in (dto.projects or {}).items():
            org_id = await _resolve_entity_ref_to_uuid(
                proj_create.organization_ref,
                "organizations",
                f"projects.{proj_ref}.organization_ref",
                tracker,
            )
            ws_id = await _resolve_entity_ref_to_uuid(
                proj_create.workspace_ref,
                "workspaces",
                f"projects.{proj_ref}.workspace_ref",
                tracker,
            )
            proj_db = await _db_create_project(
                proj_create.name,
                org_id,
                ws_id,
                is_default=bool(proj_create.is_default),
            )
            if bool(options.seed_defaults) and user_id_for_seed:
                await _create_default_environments(
                    project_id=proj_db.id,
                    user_id=user_id_for_seed,
                )
                await _create_default_evaluators(
                    project_id=proj_db.id,
                    user_id=user_id_for_seed,
                )
            tracker.projects[proj_ref] = proj_db.id
            account.projects[proj_ref] = _proj_db_to_read_dto(proj_db)

        # 6. Memberships (EE only)
        if is_ee() and (
            dto.organization_memberships
            or dto.workspace_memberships
            or dto.project_memberships
        ):
            await self._create_memberships_ee(dto, tracker, account, options)

        # 7. API keys
        if options.create_api_keys:
            for key_ref, key_create in (dto.api_keys or {}).items():
                user_id_for_key = await _resolve_entity_ref_to_uuid(
                    key_create.user_ref,
                    "users",
                    f"api_keys.{key_ref}.user_ref",
                    tracker,
                )
                proj_id_for_key = await _resolve_entity_ref_to_uuid(
                    key_create.project_ref,
                    "projects",
                    f"api_keys.{key_ref}.project_ref",
                    tracker,
                )
                raw_key = await _create_raw_api_key(
                    user_id=str(user_id_for_key),
                    project_id=str(proj_id_for_key),
                )
                prefix = raw_key.split(".")[0]
                key_db = await _db_get_api_key_by_prefix(prefix)
                key_dto = AdminApiKeyResponse(
                    id=str(key_db.id) if key_db else None,
                    prefix=prefix,
                    project_id=str(proj_id_for_key),
                    user_id=str(user_id_for_key),
                    value=raw_key if options.return_api_keys else None,
                )
                account.api_keys = account.api_keys or {}
                account.api_keys[key_ref] = key_dto
                tracker.api_keys[key_ref] = key_db.id if key_db else _uuid_mod.uuid4()

        return AdminAccountsResponse(
            accounts=[account],
            errors=errors or None,
        )

    async def _create_memberships_ee(
        self,
        dto: AdminAccountsCreate,
        tracker: _Tracker,
        account: AdminAccountRead,
        options: AdminAccountCreateOptions,
    ) -> None:
        """EE-only: create organization/workspace/project memberships."""
        for mem_ref, mem_create in (dto.organization_memberships or {}).items():
            org_id = await _resolve_entity_ref_to_uuid(
                mem_create.organization_ref,
                "organizations",
                f"organization_memberships.{mem_ref}.organization_ref",
                tracker,
            )
            user_id = await _resolve_entity_ref_to_uuid(
                mem_create.user_ref,
                "users",
                f"organization_memberships.{mem_ref}.user_ref",
                tracker,
            )
            request = _EeOrgMembershipReq(
                role=mem_create.role,
                is_demo=False,
                user_ref=_EeReference(id=user_id),
                organization_ref=_EeReference(id=org_id),
            )
            ref = await _ee_create_org_membership(request=request)
            tracker.organization_memberships[mem_ref] = ref.id
            account.organization_memberships[mem_ref] = AdminOrganizationMembershipRead(
                id=str(ref.id),
                organization_id=str(org_id),
                user_id=str(user_id),
                role=mem_create.role,
            )

        for mem_ref, mem_create in (dto.workspace_memberships or {}).items():
            ws_id = await _resolve_entity_ref_to_uuid(
                mem_create.workspace_ref,
                "workspaces",
                f"workspace_memberships.{mem_ref}.workspace_ref",
                tracker,
            )
            user_id = await _resolve_entity_ref_to_uuid(
                mem_create.user_ref,
                "users",
                f"workspace_memberships.{mem_ref}.user_ref",
                tracker,
            )
            request = _EeWsMembershipReq(
                role=mem_create.role,
                is_demo=False,
                user_ref=_EeReference(id=user_id),
                workspace_ref=_EeReference(id=ws_id),
            )
            ref = await _ee_create_ws_membership(request=request)
            tracker.workspace_memberships[mem_ref] = ref.id
            account.workspace_memberships[mem_ref] = AdminWorkspaceMembershipRead(
                id=str(ref.id),
                workspace_id=str(ws_id),
                user_id=str(user_id),
                role=mem_create.role,
            )

        for mem_ref, mem_create in (dto.project_memberships or {}).items():
            proj_id = await _resolve_entity_ref_to_uuid(
                mem_create.project_ref,
                "projects",
                f"project_memberships.{mem_ref}.project_ref",
                tracker,
            )
            user_id = await _resolve_entity_ref_to_uuid(
                mem_create.user_ref,
                "users",
                f"project_memberships.{mem_ref}.user_ref",
                tracker,
            )
            request = _EeProjectMembershipReq(
                role=mem_create.role,
                is_demo=False,
                user_ref=_EeReference(id=user_id),
                project_ref=_EeReference(id=proj_id),
            )
            ref = await _ee_create_project_membership(request=request)
            tracker.project_memberships[mem_ref] = ref.id
            account.project_memberships[mem_ref] = AdminProjectMembershipRead(
                id=str(ref.id),
                project_id=str(proj_id),
                user_id=str(user_id),
                role=mem_create.role,
            )

    # -----------------------------------------------------------------------
    # Account Graph Delete
    # -----------------------------------------------------------------------

    async def delete_accounts(
        self,
        *,
        dto: AdminAccountsDelete,
    ) -> AdminDeleteResponse:
        """Delete account graphs by selector.

        Default behavior when only user selectors are given:
        delete their owned organizations first (which cascades to
        workspaces, projects, memberships, and API keys), then
        delete the user records.
        """
        dry_run = bool(dto.dry_run)
        deleted = AdminDeletedEntities()

        target = dto.target
        user_ids: List[UUID] = []

        # Resolve user IDs from user_ids or user_emails
        for uid in target.user_ids or []:
            try:
                user_ids.append(UUID(uid))
            except ValueError:
                pass

        for email in target.user_emails or []:
            user = await _db_get_user_by_email(email)
            if user:
                user_ids.append(user.id)

        # Collect org IDs to delete
        org_ids: List[UUID] = [UUID(oid) for oid in (target.organization_ids or [])]

        # Default cascade: when only users are given, delete their owned orgs
        explicit_scopes = bool(
            target.organization_ids or target.workspace_ids or target.project_ids
        )
        if user_ids and not explicit_scopes:
            for user_id in user_ids:
                owned = await _db_get_orgs_owned_by_user(user_id)
                for org in owned:
                    # On OSS the singleton org is shared across every user;
                    # cascading-delete it because some user happens to own
                    # it would tear down the whole tenant.
                    if not is_ee() and org.slug == OSS_SINGLETON_ORG_SLUG:
                        continue
                    if org.id not in org_ids:
                        org_ids.append(org.id)

        # Even when callers pass explicit organization_ids, the OSS
        # singleton must never be in the delete set.
        if not is_ee() and org_ids:
            kept_org_ids: List[UUID] = []
            for oid in org_ids:
                org = await _db_get_org_by_id(oid)
                if org and org.slug == OSS_SINGLETON_ORG_SLUG:
                    continue
                kept_org_ids.append(oid)
            org_ids = kept_org_ids

        # Collect workspace and project IDs
        workspace_ids: List[UUID] = [UUID(wid) for wid in (target.workspace_ids or [])]
        project_ids: List[UUID] = [UUID(pid) for pid in (target.project_ids or [])]

        # On OSS, the singleton workspace under the singleton org is
        # untouchable for the same reason as the org itself: deleting it
        # would orphan in-flight bootstraps. Filter any such workspace
        # IDs out of the delete set.
        if not is_ee() and workspace_ids:
            kept_ws_ids: List[UUID] = []
            for wid in workspace_ids:
                ws = await _db_get_workspace_by_id(wid)
                if ws is not None:
                    org = await _db_get_org_by_id(ws.organization_id)
                    if org and org.slug == OSS_SINGLETON_ORG_SLUG:
                        continue
                kept_ws_ids.append(wid)
            workspace_ids = kept_ws_ids

        if dry_run:
            # Report what would be deleted without writing
            deleted.organizations = [AdminDeletedEntity(id=str(oid)) for oid in org_ids]
            deleted.workspaces = [
                AdminDeletedEntity(id=str(wid)) for wid in workspace_ids
            ]
            deleted.projects = [AdminDeletedEntity(id=str(pid)) for pid in project_ids]
            deleted.users = [AdminDeletedEntity(id=str(uid)) for uid in user_ids]
            return AdminDeleteResponse(dry_run=True, deleted=deleted)

        await _db_delete_accounts_batch(
            org_ids=org_ids,
            workspace_ids=workspace_ids,
            project_ids=project_ids,
            user_ids=user_ids,
        )

        deleted.projects = [
            AdminDeletedEntity(id=str(pid)) for pid in project_ids
        ] or None
        deleted.workspaces = [
            AdminDeletedEntity(id=str(wid)) for wid in workspace_ids
        ] or None
        deleted.organizations = [
            AdminDeletedEntity(id=str(oid)) for oid in org_ids
        ] or None
        deleted.users = [AdminDeletedEntity(id=str(uid)) for uid in user_ids] or None

        return AdminDeleteResponse(dry_run=False, deleted=deleted)

    # -----------------------------------------------------------------------
    # Simple Account Create / Delete
    # -----------------------------------------------------------------------

    async def create_simple_accounts(
        self,
        *,
        dto: AdminSimpleAccountsCreate,
    ) -> AdminAccountsResponse:
        """Create one or more accounts from a keyed batch.

        The response ``accounts`` dict is keyed by the same refs used in
        the request, with each entry in the singular shape of the request:
        user/organization/workspace/project/api_key (no plural maps).
        """
        global_options = dto.options or AdminAccountCreateOptions()
        result = AdminSimpleAccountsResponse()

        for account_ref, entry in dto.accounts.items():
            existing = await _db_get_user_by_email(entry.user.email)
            if existing:
                raise AdminUserAlreadyExistsError(entry.user.email)
            sub = await self._create_one_simple_account(
                entry=entry,
                global_options=global_options,
            )
            if sub.accounts:
                acc = sub.accounts[0]
                # api_keys: map ref → raw value string (not the full DTO)
                api_keys: Optional[Dict[str, str]] = None
                if acc.api_keys:
                    api_keys = {
                        ref: _dto.value
                        for ref, _dto in acc.api_keys.items()
                        if _dto.value is not None
                    } or None
                result.accounts[account_ref] = AdminSimpleAccountRead(
                    user=acc.users.get("user"),
                    organizations=dict(acc.organizations)
                    if acc.organizations
                    else None,
                    workspaces=dict(acc.workspaces) if acc.workspaces else None,
                    projects=dict(acc.projects) if acc.projects else None,
                    subscriptions=dict(acc.subscriptions)
                    if acc.subscriptions
                    else None,
                    api_keys=api_keys,
                    user_identities=(
                        list(acc.user_identities.values())
                        if acc.user_identities
                        else None
                    ),
                    organization_memberships=(
                        list(acc.organization_memberships.values())
                        if acc.organization_memberships
                        else None
                    ),
                    workspace_memberships=(
                        list(acc.workspace_memberships.values())
                        if acc.workspace_memberships
                        else None
                    ),
                    project_memberships=(
                        list(acc.project_memberships.values())
                        if acc.project_memberships
                        else None
                    ),
                )
            if sub.errors:
                result.errors = result.errors or []
                result.errors.extend(sub.errors)

        return result

    async def _create_one_simple_account(
        self,
        *,
        entry: "AdminSimpleAccountCreate",
        global_options: AdminAccountCreateOptions,
    ) -> AdminAccountsResponse:
        """Build a graph DTO for one simple-account entry and delegate.

        Simple-account defaults (applied when the caller leaves a field as None):
        - create_api_keys   → True
        - return_api_keys   → True
        - create_identities → inferred from whether user_identities is provided
        - seed_defaults     → True  (already the DTO default)
        """
        raw = entry.options or global_options

        effective_options = AdminAccountCreateOptions(
            dry_run=raw.dry_run,
            seed_defaults=raw.seed_defaults,
            reason=raw.reason,
            create_identities=bool(entry.user_identities),
            create_api_keys=raw.create_api_keys
            if raw.create_api_keys is not None
            else True,
            return_api_keys=raw.return_api_keys
            if raw.return_api_keys is not None
            else True,
        )

        if not is_ee():
            if (
                entry.organization
                or entry.workspace
                or entry.project
                or entry.subscription
                or entry.organization_memberships
                or entry.workspace_memberships
                or entry.project_memberships
                or entry.api_keys
            ):
                raise OssMultiOrgNotSupportedError(
                    "OSS is single-tenant: organization, workspace, project, subscription, "
                    "explicit memberships, and explicit api_keys cannot be specified. "
                    "Use options.create_api_keys to request an API key on the per-account project."
                )
            return await self._create_one_simple_account_oss(
                entry=entry,
                options=effective_options,
            )

        org_create = entry.organization or _default_org_for_user(entry.user)
        ws_create = entry.workspace or _default_ws_for_org("org")
        proj_create = entry.project or _default_proj_for_ws("org", "wrk")

        ws_create.organization_ref = EntityRef(ref="org")
        proj_create.organization_ref = EntityRef(ref="org")
        proj_create.workspace_ref = EntityRef(ref="wrk")
        proj_create.is_default = True

        graph_dto = AdminAccountsCreate(
            options=effective_options,
            users={"user": entry.user},
            organizations={"org": org_create},
            workspaces={"wrk": ws_create},
            projects={"prj": proj_create},
        )

        if entry.user_identities and effective_options.create_identities:
            graph_dto.user_identities = {
                f"identity_{i}": identity
                for i, identity in enumerate(entry.user_identities)
            }

        if is_ee():
            # Explicit memberships override the default owner roles.
            # When none are supplied, auto-create owner membership for each scope
            # so the user can access their own org / workspace / project in EE.
            if entry.organization_memberships:
                graph_dto.organization_memberships = {
                    f"org_mem_{i}": m
                    for i, m in enumerate(entry.organization_memberships)
                }
            else:
                graph_dto.organization_memberships = {
                    "org_owner": AdminOrganizationMembershipCreate(
                        organization_ref=EntityRef(ref="org"),
                        user_ref=EntityRef(ref="user"),
                        role="owner",
                    )
                }
            if entry.workspace_memberships:
                graph_dto.workspace_memberships = {
                    f"wrk_mem_{i}": m for i, m in enumerate(entry.workspace_memberships)
                }
            else:
                graph_dto.workspace_memberships = {
                    "wrk_owner": AdminWorkspaceMembershipCreate(
                        workspace_ref=EntityRef(ref="wrk"),
                        user_ref=EntityRef(ref="user"),
                        role="owner",
                    )
                }
            if entry.project_memberships:
                graph_dto.project_memberships = {
                    f"prj_mem_{i}": m for i, m in enumerate(entry.project_memberships)
                }
            else:
                graph_dto.project_memberships = {
                    "prj_owner": AdminProjectMembershipCreate(
                        project_ref=EntityRef(ref="prj"),
                        user_ref=EntityRef(ref="user"),
                        role="owner",
                    )
                }

        if entry.subscription:
            graph_dto.subscriptions = {"org": entry.subscription}

        if effective_options.create_api_keys:
            graph_dto.api_keys = {
                "key": AdminApiKeyCreate(
                    user_ref=EntityRef(ref="user"),
                    project_ref=EntityRef(ref="prj"),
                )
            }

        return await self.create_accounts(dto=graph_dto)

    async def _create_one_simple_account_oss(
        self,
        *,
        entry: "AdminSimpleAccountCreate",
        options: AdminAccountCreateOptions,
    ) -> AdminAccountsResponse:
        """OSS-only path for simple account creation.

        OSS is single-tenant: every user lives under one organization with one
        workspace and one default project. We bootstrap that singleton on first
        use (mirroring `_create_account` in the SuperTokens override) and
        attach every subsequent user to it via `_assign_user_to_organization_oss`.
        """
        account = AdminAccountRead()
        errors: List[AdminStructuredError] = []

        # 1. Create the user (the existence check already happened in caller).
        user_db = await _db_get_or_create_user(
            entry.user.email,
            entry.user.username or entry.user.name,
        )
        account.users["user"] = _user_db_to_read_dto(user_db)

        # 2. Get-or-bootstrap the OSS singleton org/workspace/default project.
        # The org row is race-free via INSERT ... ON CONFLICT (slug) on the
        # deterministic OSS singleton slug. The workspace under that org is
        # serialized by a SELECT FOR UPDATE row lock on the org during
        # bootstrap, so concurrent first-user signups all converge on the
        # same workspace. No application-level lock is involved.
        org_db = await _db_get_or_bootstrap_oss_organization(
            user_id=user_db.id,
            user_email=entry.user.email,
        )

        # Resolve the singleton default project + workspace BEFORE assigning
        # the user, so that an inconsistent singleton state surfaces as a
        # deterministic AdminValidationError (400) rather than a NoResultFound
        # bubbling out of `_db_assign_user_to_organization_oss` as a 500.
        default_proj_db = await _db_get_default_project_by_organization_id(
            str(org_db.id)
        )
        if default_proj_db is None:
            raise AdminValidationError(
                "OSS singleton is in an inconsistent state: no default project found for organization."
            )

        ws_db = await _db_get_workspace_by_id(default_proj_db.workspace_id)
        if ws_db is None:
            raise AdminValidationError(
                "OSS singleton is in an inconsistent state: project's workspace not found."
            )

        await _db_assign_user_to_organization_oss(
            user_db=user_db,
            organization_id=str(org_db.id),
            email=entry.user.email,
        )

        # Always mint a fresh project per account under the singleton
        # workspace. Org and workspace stay singleton; only projects
        # multiply. This isolates per-account state (entities, traces,
        # api-keys) so concurrent or sequential accounts don't see each
        # other's data — required for test isolation under the OSS
        # singleton, and harmless for non-test callers.
        proj_db = await _db_create_project(
            f"account-{user_db.id}",
            org_db.id,
            ws_db.id,
            is_default=False,
        )
        if options.seed_defaults:
            await _create_default_environments(
                project_id=proj_db.id,
                user_id=user_db.id,
            )
            await _create_default_evaluators(
                project_id=proj_db.id,
                user_id=user_db.id,
            )

        account.organizations["org"] = _org_db_to_read_dto(org_db)
        account.workspaces["wrk"] = _ws_db_to_read_dto(ws_db)
        account.projects["prj"] = _proj_db_to_read_dto(proj_db)

        # 3. Optional SuperTokens identities.
        if entry.user_identities and options.create_identities:
            tenant_id = "public"
            for index, identity_create in enumerate(entry.user_identities):
                identity_ref = f"identity_{index}"
                if not _identity_method_supported(identity_create.method):
                    errors.append(
                        AdminStructuredError(
                            code="not_implemented",
                            message=(
                                f"Identity provisioning for method "
                                f"'{identity_create.method}' is not supported on this "
                                f"deployment (configured email_method="
                                f"'{env.auth.email_method}'; ref: {identity_ref})."
                            ),
                            details={
                                "ref": identity_ref,
                                "method": identity_create.method,
                                "configured_email_method": env.auth.email_method,
                            },
                        )
                    )
                    continue

                email = identity_create.email or identity_create.subject
                password = identity_create.password
                if not email:
                    errors.append(
                        AdminStructuredError(
                            code="invalid_identity",
                            message=(
                                f"email identity requires 'email' (or 'subject') "
                                f"(ref: {identity_ref})."
                            ),
                            details={"ref": identity_ref},
                        )
                    )
                    continue

                (
                    rid,
                    created_method,
                    err_code,
                    err_msg,
                ) = await _create_st_email_identity(
                    tenant_id=tenant_id,
                    email=email,
                    password=password,
                )
                if err_code is not None:
                    errors.append(
                        AdminStructuredError(
                            code=err_code,
                            message=f"{err_msg} (ref: {identity_ref}).",
                            details={"ref": identity_ref, "email": email},
                        )
                    )
                    continue

                account.user_identities[identity_ref] = AdminUserIdentityRead(
                    id=rid,
                    user_id=str(user_db.id),
                    method=created_method,
                    subject=email,
                    email=email,
                    verified=identity_create.verified or False,
                    status="created",
                )

        # 4. API key on this account's per-account project (proj_db is the
        # ephemeral project minted above, not the singleton default).
        if options.create_api_keys:
            raw_key = await _create_raw_api_key(
                user_id=str(user_db.id),
                project_id=str(proj_db.id),
            )
            prefix = raw_key.split(".")[0]
            key_db = await _db_get_api_key_by_prefix(prefix)
            account.api_keys = {
                "key": AdminApiKeyResponse(
                    id=str(key_db.id) if key_db else None,
                    prefix=prefix,
                    project_id=str(proj_db.id),
                    user_id=str(user_db.id),
                    value=raw_key if options.return_api_keys else None,
                )
            }

        return AdminAccountsResponse(
            accounts=[account],
            errors=errors or None,
        )

    async def delete_simple_accounts(
        self,
        *,
        dto: AdminSimpleAccountsDelete,
    ) -> None:
        """Delete one or more accounts identified by user ref."""
        if dto.dry_run:
            return

        for _ref, entry in dto.accounts.items():
            user_ref = entry.user
            if user_ref.id:
                await self.delete_user(user_id=user_ref.id)
            elif user_ref.email:
                user = await _db_get_user_by_email(user_ref.email)
                if user:
                    await self.delete_user(user_id=str(user.id))
                # else: user not found — silently no-op (idempotent delete)
            else:
                raise AdminInvalidReferenceError("user", str(user_ref))

    # -----------------------------------------------------------------------
    # Simple Entity Creates
    # -----------------------------------------------------------------------

    async def create_user(
        self,
        *,
        dto: AdminSimpleAccountsUsersCreate,
    ) -> AdminAccountsResponse:
        options = dto.options or AdminAccountCreateOptions()

        # On OSS, when seed_defaults is requested, route through the
        # simple-account path so the singleton org/workspace are reused
        # via ``get_or_bootstrap_oss_organization`` (deterministic slug,
        # race free). The graph-shaped ``create_accounts`` path mints a
        # fresh org per call and would break the singleton invariant.
        # When seed_defaults is False, no org/workspace is created here,
        # so falling through to the graph path is safe.
        if options.seed_defaults and not is_ee():
            simple_entry = AdminSimpleAccountCreate(
                user=dto.user,
                options=options,
            )
            simple_dto = AdminSimpleAccountsCreate(
                accounts={"user": simple_entry},
                options=options,
            )
            simple_response = await self.create_simple_accounts(dto=simple_dto)

            # Translate the simple response shape back into the graph
            # response shape that callers of ``create_user`` expect.
            # Note: ``AdminAccountsResponse.accounts`` is a *list* of
            # ``AdminAccountRead`` (not a dict), so we append rather
            # than subscript.
            graph_response = AdminAccountsResponse()
            for _account_ref, simple_account in simple_response.accounts.items():
                read = AdminAccountRead()
                if simple_account.user is not None:
                    read.users = {"user": simple_account.user}
                if simple_account.organizations:
                    read.organizations = dict(simple_account.organizations)
                if simple_account.workspaces:
                    read.workspaces = dict(simple_account.workspaces)
                if simple_account.projects:
                    read.projects = dict(simple_account.projects)
                # NOTE: simple-account responses expose api_keys as raw
                # value strings, while the graph shape expects a richer
                # AdminApiKeyResponse. We cannot losslessly reconstruct
                # the latter, so leave ``read.api_keys`` unset on this OSS
                # path. Tests for this endpoint only assert on ``users``.
                graph_response.accounts.append(read)
            if simple_response.errors:
                graph_response.errors = list(simple_response.errors)
            return graph_response

        graph_dto = AdminAccountsCreate(
            options=options,
            users={"user": dto.user},
        )
        if options.seed_defaults:
            # Also scaffold default org / workspace / project
            org_create = _default_org_for_user(dto.user)
            ws_create = _default_ws_for_org("org")
            proj_create = _default_proj_for_ws("org", "wrk")
            graph_dto.organizations = {"org": org_create}
            graph_dto.workspaces = {"wrk": ws_create}
            graph_dto.projects = {"prj": proj_create}
            if is_ee():
                graph_dto.organization_memberships = {
                    "org_owner": AdminOrganizationMembershipCreate(
                        organization_ref=EntityRef(ref="org"),
                        user_ref=EntityRef(ref="user"),
                        role="owner",
                    )
                }
                graph_dto.workspace_memberships = {
                    "wrk_owner": AdminWorkspaceMembershipCreate(
                        workspace_ref=EntityRef(ref="wrk"),
                        user_ref=EntityRef(ref="user"),
                        role="owner",
                    )
                }
                graph_dto.project_memberships = {
                    "prj_owner": AdminProjectMembershipCreate(
                        project_ref=EntityRef(ref="prj"),
                        user_ref=EntityRef(ref="user"),
                        role="owner",
                    )
                }
            if options.create_api_keys:
                graph_dto.api_keys = {
                    "key": AdminApiKeyCreate(
                        user_ref=EntityRef(ref="user"),
                        project_ref=EntityRef(ref="prj"),
                    )
                }
        return await self.create_accounts(dto=graph_dto)

    async def create_user_identity(
        self,
        *,
        dto: AdminSimpleAccountsUsersIdentitiesCreate,
    ) -> AdminAccountsResponse:
        """Create a SuperTokens identity for an existing user."""
        identity = dto.user_identity
        if not _identity_method_supported(identity.method):
            raise AdminNotImplementedError(
                f"create_user_identity for method '{identity.method}' "
                f"(configured email_method='{env.auth.email_method}')"
            )

        email = identity.email or identity.subject
        password = identity.password
        if not email:
            raise AdminValidationError(
                "email identity requires 'email' (or 'subject')."
            )

        # Resolve the user this identity should attach to
        user_id_str: Optional[str] = None
        if dto.user_ref.id:
            user_id_str = dto.user_ref.id
        elif dto.user_ref.email:
            u = await _db_get_user_by_email(dto.user_ref.email)
            if not u:
                raise AdminUserNotFoundError(dto.user_ref.email)
            user_id_str = str(u.id)

        rid, created_method, err_code, err_msg = await _create_st_email_identity(
            tenant_id="public",
            email=email,
            password=password,
        )
        if err_code is not None:
            raise AdminValidationError(err_msg)

        identity_dto = AdminUserIdentityRead(
            id=rid,
            user_id=user_id_str or "",
            method=created_method,
            subject=email,
            email=email,
            verified=identity.verified or False,
            status="created",
        )
        account = AdminAccountRead()
        account.user_identities["identity_0"] = identity_dto
        return AdminAccountsResponse(accounts=[account])

    async def create_organization(
        self,
        *,
        dto: AdminSimpleAccountsOrganizationsCreate,
    ) -> AdminAccountsResponse:
        options = dto.options or AdminAccountCreateOptions()
        users: dict = {}
        if dto.owner:
            # Require the owner to already exist — look up by email
            owner_db = await _db_get_user_by_email(dto.owner.email)
            if not owner_db:
                raise AdminUserNotFoundError(dto.owner.email)
            users["owner"] = dto.owner
            owner_ref = EntityRef(ref="owner")
        else:
            owner_ref = None

        org_create = AdminOrganizationCreate(
            name=dto.organization.name,
            slug=dto.organization.slug,
            owner_user_ref=owner_ref,
        )
        ws_create = _default_ws_for_org("org")
        proj_create = _default_proj_for_ws("org", "wrk")

        graph_dto = AdminAccountsCreate(
            options=options,
            users=users or None,
            organizations={"org": org_create},
            workspaces={"wrk": ws_create},
            projects={"prj": proj_create},
        )
        if is_ee() and dto.owner:
            graph_dto.organization_memberships = {
                "org_owner": AdminOrganizationMembershipCreate(
                    organization_ref=EntityRef(ref="org"),
                    user_ref=EntityRef(ref="owner"),
                    role="owner",
                )
            }
            graph_dto.workspace_memberships = {
                "wrk_owner": AdminWorkspaceMembershipCreate(
                    workspace_ref=EntityRef(ref="wrk"),
                    user_ref=EntityRef(ref="owner"),
                    role="owner",
                )
            }
            graph_dto.project_memberships = {
                "prj_owner": AdminProjectMembershipCreate(
                    project_ref=EntityRef(ref="prj"),
                    user_ref=EntityRef(ref="owner"),
                    role="owner",
                )
            }
        return await self.create_accounts(dto=graph_dto)

    async def create_organization_membership(
        self,
        *,
        dto: AdminSimpleAccountsOrganizationsMembershipsCreate,
    ) -> AdminAccountsResponse:
        if not is_ee():
            raise AdminNotImplementedError("organization_memberships")
        options = dto.options or AdminAccountCreateOptions()
        graph_dto = AdminAccountsCreate(
            options=options,
            organization_memberships={"mem": dto.membership},
        )
        return await self.create_accounts(dto=graph_dto)

    async def create_workspace(
        self,
        *,
        dto: AdminSimpleAccountsWorkspacesCreate,
    ) -> AdminAccountsResponse:
        options = dto.options or AdminAccountCreateOptions()
        ws_create = dto.workspace
        # The workspace's organization must be specified by id/slug
        # We create a minimal graph: workspace + default project
        proj_create = AdminProjectCreate(
            name="Default",
            organization_ref=ws_create.organization_ref,
            workspace_ref=EntityRef(ref="wrk"),
            is_default=True,
        )
        graph_dto = AdminAccountsCreate(
            options=options,
            workspaces={"wrk": ws_create},
            projects={"prj": proj_create},
        )
        return await self.create_accounts(dto=graph_dto)

    async def create_workspace_membership(
        self,
        *,
        dto: AdminSimpleAccountsWorkspacesMembershipsCreate,
    ) -> AdminAccountsResponse:
        if not is_ee():
            raise AdminNotImplementedError("workspace_memberships")
        options = dto.options or AdminAccountCreateOptions()
        graph_dto = AdminAccountsCreate(
            options=options,
            workspace_memberships={"mem": dto.membership},
        )
        return await self.create_accounts(dto=graph_dto)

    async def create_project(
        self,
        *,
        dto: AdminSimpleAccountsProjectsCreate,
    ) -> AdminAccountsResponse:
        options = dto.options or AdminAccountCreateOptions()
        graph_dto = AdminAccountsCreate(
            options=options,
            projects={"prj": dto.project},
        )
        return await self.create_accounts(dto=graph_dto)

    async def create_project_membership(
        self,
        *,
        dto: AdminSimpleAccountsProjectsMembershipsCreate,
    ) -> AdminAccountsResponse:
        if not is_ee():
            raise AdminNotImplementedError("project_memberships")
        options = dto.options or AdminAccountCreateOptions()
        graph_dto = AdminAccountsCreate(
            options=options,
            project_memberships={"mem": dto.membership},
        )
        return await self.create_accounts(dto=graph_dto)

    async def create_api_key(
        self,
        *,
        dto: AdminSimpleAccountsApiKeysCreate,
    ) -> AdminAccountsResponse:
        options = AdminAccountCreateOptions(
            create_api_keys=True,
            return_api_keys=(dto.options.return_api_keys if dto.options else False),
        )
        graph_dto = AdminAccountsCreate(
            options=options,
            api_keys={"key": dto.api_key},
        )
        return await self.create_accounts(dto=graph_dto)

    # -----------------------------------------------------------------------
    # Simple Entity Deletes
    # -----------------------------------------------------------------------

    async def delete_user(
        self,
        *,
        user_id: str,
    ) -> AdminDeleteResponse:
        uid = _parse_uuid(user_id, "user_id")
        user = await _db_get_user_by_id(uid)
        if not user:
            raise AdminUserNotFoundError(user_id)

        # Remove EE membership records before deleting the user to avoid FK violations
        if is_ee():
            await _ee_delete_user_memberships(uid)

        deleted_org_ids = await _db_delete_user_with_cascade(uid)
        deleted = AdminDeletedEntities(
            organizations=[AdminDeletedEntity(id=str(oid)) for oid in deleted_org_ids]
            or None,
            users=[AdminDeletedEntity(id=user_id)],
        )
        return AdminDeleteResponse(dry_run=False, deleted=deleted)

    async def delete_user_identity(
        self,
        *,
        user_id: str,
        identity_id: str,
    ) -> AdminDeleteResponse:
        """Delete a SuperTokens recipe identity (recipe user) by its ID."""
        from supertokens_python.asyncio import (
            get_user as _st_get_user,
            delete_user as _st_delete_user,
        )

        st_user = await _st_get_user(identity_id)
        if st_user is None:
            raise AdminUserNotFoundError(identity_id)

        await _st_delete_user(user_id=identity_id, remove_all_linked_accounts=False)
        deleted = AdminDeletedEntities(
            user_identities=[AdminDeletedEntity(id=identity_id)]
        )
        return AdminDeleteResponse(dry_run=False, deleted=deleted)

    async def delete_organization(
        self,
        *,
        organization_id: str,
    ) -> AdminDeleteResponse:
        oid = _parse_uuid(organization_id, "organization_id")
        org = await _db_get_org_by_id(oid)
        if not org:
            raise AdminOrganizationNotFoundError(organization_id)

        # On OSS the deterministic singleton org is structurally required
        # by the bootstrap path; deleting it leaves any in-flight
        # workspace/project insert with a dangling FK and breaks
        # subsequent first-user signups until the row is recreated.
        # Refuse the delete rather than allow a partial nuke.
        if not is_ee() and org.slug == OSS_SINGLETON_ORG_SLUG:
            raise AdminValidationError(
                "The OSS singleton organization cannot be deleted."
            )

        await _db_delete_organization(oid)
        deleted = AdminDeletedEntities(
            organizations=[AdminDeletedEntity(id=organization_id)]
        )
        return AdminDeleteResponse(dry_run=False, deleted=deleted)

    async def delete_organization_membership(
        self,
        *,
        organization_id: str,
        membership_id: str,
    ) -> AdminDeleteResponse:
        if not is_ee():
            raise AdminNotImplementedError("delete_organization_membership")
        return await self._delete_ee_membership(
            membership_id=membership_id,
            scope_type="organization",
        )

    async def delete_workspace(
        self,
        *,
        workspace_id: str,
    ) -> AdminDeleteResponse:
        wid = _parse_uuid(workspace_id, "workspace_id")
        ws = await _db_get_workspace_by_id(wid)
        if not ws:
            raise AdminWorkspaceNotFoundError(workspace_id)

        # On OSS the workspace under the singleton org is itself a
        # singleton; deleting it would orphan in-flight projects and
        # break the bootstrap. Refuse rather than allow a partial nuke.
        if not is_ee():
            org = await _db_get_org_by_id(ws.organization_id)
            if org and org.slug == OSS_SINGLETON_ORG_SLUG:
                raise AdminValidationError(
                    "The OSS singleton workspace cannot be deleted."
                )

        await _db_delete_workspace(wid)
        deleted = AdminDeletedEntities(workspaces=[AdminDeletedEntity(id=workspace_id)])
        return AdminDeleteResponse(dry_run=False, deleted=deleted)

    async def delete_workspace_membership(
        self,
        *,
        workspace_id: str,
        membership_id: str,
    ) -> AdminDeleteResponse:
        if not is_ee():
            raise AdminNotImplementedError("delete_workspace_membership")
        return await self._delete_ee_membership(
            membership_id=membership_id,
            scope_type="workspace",
        )

    async def delete_project(
        self,
        *,
        project_id: str,
    ) -> AdminDeleteResponse:
        pid = _parse_uuid(project_id, "project_id")
        proj = await _db_get_project_by_id(pid)
        if not proj:
            raise AdminProjectNotFoundError(project_id)

        await _db_delete_project(pid)
        deleted = AdminDeletedEntities(projects=[AdminDeletedEntity(id=project_id)])
        return AdminDeleteResponse(dry_run=False, deleted=deleted)

    async def delete_project_membership(
        self,
        *,
        project_id: str,
        membership_id: str,
    ) -> AdminDeleteResponse:
        if not is_ee():
            raise AdminNotImplementedError("delete_project_membership")
        return await self._delete_ee_membership(
            membership_id=membership_id,
            scope_type="project",
        )

    async def delete_api_key(
        self,
        *,
        api_key_id: str,
    ) -> AdminDeleteResponse:
        kid = _parse_uuid(api_key_id, "api_key_id")
        key = await _db_get_api_key_by_id(kid)
        if not key:
            raise AdminApiKeyNotFoundError(api_key_id)

        await _db_delete_api_key(kid)
        deleted = AdminDeletedEntities(api_keys=[AdminDeletedEntity(id=api_key_id)])
        return AdminDeleteResponse(dry_run=False, deleted=deleted)

    # -----------------------------------------------------------------------
    # Actions
    # -----------------------------------------------------------------------

    async def reset_password(
        self,
        *,
        dto: AdminSimpleAccountsUsersResetPassword,
    ) -> None:
        """Update the password on one or more existing email:password identities.

        For each identity in ``dto.user_identities``:
        1. Look up the SuperTokens user by email (or subject).
        2. Find the ``emailpassword`` login method on that user.
        3. Call ``update_email_or_password`` with the new password.
        """
        tenant_id = "public"
        password_recipe_active = env.auth.email_method == "password"

        for identity in dto.user_identities:
            if identity.method != "email:password":
                raise AdminValidationError(
                    f"reset_password only supports method 'email:password'; "
                    f"got '{identity.method}'."
                )

            email = identity.email or identity.subject
            password = identity.password
            if not email or not password:
                raise AdminValidationError(
                    "reset_password requires 'email' (or 'subject') and 'password' "
                    "on every user_identity entry."
                )

            # Look up the ST user by email. We do this regardless of the
            # configured email_method so that truly unknown identities return
            # a deterministic 404 even on OTP-only deployments. The lookup
            # has two distinct miss states:
            #
            #   1. No SuperTokens user at all → 404 AdminUserNotFoundError.
            #   2. User exists but has no `emailpassword` login method → on
            #      OTP-only deployments this is expected (the user was
            #      provisioned via passwordless), so we no-op; on password
            #      deployments this is still a "not found" for the password
            #      recipe and we 404.
            st_users = await _st_list_users_by_account_info(
                tenant_id=tenant_id,
                account_info=_StAccountInfoInput(email=email),
            )

            if not st_users:
                raise AdminUserNotFoundError(email)

            recipe_user_id: Optional[str] = None
            for st_user in st_users:
                for lm in st_user.login_methods:
                    if lm.recipe_id == "emailpassword":
                        rid = lm.recipe_user_id
                        recipe_user_id = (
                            rid.get_as_string()
                            if hasattr(rid, "get_as_string")
                            else str(rid)
                        )
                        break
                if recipe_user_id:
                    break

            if not recipe_user_id:
                # The user exists but has no password recipe. On OTP-only
                # deployments this is the expected state for every account;
                # treat as a no-op so callers can run a uniform reset flow.
                if not password_recipe_active:
                    continue
                raise AdminUserNotFoundError(email)

            result = await _ep.update_email_or_password(
                recipe_user_id=_StRecipeUserId(recipe_user_id),
                password=password,
                apply_password_policy=True,
                tenant_id_for_password_policy=tenant_id,
            )

            if isinstance(result, _EpUnknownUserIdError):
                raise AdminUserNotFoundError(recipe_user_id)
            if isinstance(result, _EpPasswordPolicyViolationError):
                raise AdminValidationError(result.failure_reason)

    async def transfer_ownership(
        self,
        *,
        dto: AdminSimpleAccountsOrganizationsTransferOwnership,
    ) -> AdminSimpleAccountsOrganizationsTransferOwnershipResponse:
        """Transfer organization ownership from one user to another.

        Updates only ``owner_id`` on each targeted org (``created_by_id`` is
        intentionally left unchanged).

        When ``dto.organizations`` is None, all orgs owned by the source user
        are transferred.  When a list is provided, only orgs that are *both* in
        the request list *and* currently owned by the source user are
        transferred; any others produce a structured error in the response.

        ``include_workspaces`` / ``include_projects`` are accepted but are
        no-ops in OSS (workspaces and projects carry no owner column).
        """
        source_ref = dto.users.get("source")
        target_ref = dto.users.get("target")
        if source_ref is None or target_ref is None:
            raise AdminValidationError(
                "transfer_ownership requires 'source' and 'target' keys in 'users'."
            )

        # Resolve source/target by id or email
        if source_ref.id is not None:
            source_id = _parse_uuid(source_ref.id, "users.source")
            if not await _db_get_user_by_id(source_id):
                raise AdminUserNotFoundError(str(source_id))
        elif source_ref.email is not None:
            source_user = await _db_get_user_by_email(source_ref.email)
            if not source_user:
                raise AdminUserNotFoundError(source_ref.email)
            source_id = source_user.id
        else:
            raise AdminValidationError("users.source must use 'id' or 'email'.")

        if target_ref.id is not None:
            target_id = _parse_uuid(target_ref.id, "users.target")
            if not await _db_get_user_by_id(target_id):
                raise AdminUserNotFoundError(str(target_id))
        elif target_ref.email is not None:
            target_user = await _db_get_user_by_email(target_ref.email)
            if not target_user:
                raise AdminUserNotFoundError(target_ref.email)
            target_id = target_user.id
        else:
            raise AdminValidationError("users.target must use 'id' or 'email'.")

        # All orgs currently owned by source (used for both modes)
        owned_by_source = {
            org.id for org in await _db_get_orgs_owned_by_user(source_id)
        }

        errors: List[AdminStructuredError] = []

        if dto.organizations is None:
            # Transfer every org owned by source
            org_ids = list(owned_by_source)
        else:
            # Resolve requested orgs, then intersect with owned set
            org_ids = []
            for org_key, ref in dto.organizations.items():
                if ref.id:
                    oid = _parse_uuid(ref.id, f"organizations.{org_key}.id")
                    label = ref.id
                elif ref.slug:
                    org = await _db_get_org_by_slug(ref.slug)
                    if not org:
                        errors.append(
                            AdminStructuredError(
                                code="organization_not_found",
                                message=f"Organization '{ref.slug}' was not found.",
                                details={"slug": ref.slug, "ref": org_key},
                            )
                        )
                        continue
                    oid = org.id
                    label = ref.slug
                else:
                    raise AdminInvalidReferenceError(
                        f"organizations.{org_key}",
                        "only 'id' or 'slug' are supported here",
                    )

                if oid not in owned_by_source:
                    errors.append(
                        AdminStructuredError(
                            code="not_owned_by_source",
                            message=(
                                f"Organization '{label}' is not owned by the source user "
                                f"and will not be transferred."
                            ),
                            details={"ref": org_key, "organization_id": label},
                        )
                    )
                else:
                    org_ids.append(oid)

        if org_ids:
            # Pre-condition (EE): both source and target must be members.
            # Drop orgs where target has no membership and emit a structured
            # error so the caller knows those orgs were not transferred and
            # would be lost if the source user is later deleted.
            if is_ee():
                target_member_org_ids = await _ee_get_member_org_ids(target_id, org_ids)
                skipped = [oid for oid in org_ids if oid not in target_member_org_ids]
                for oid in skipped:
                    errors.append(
                        AdminStructuredError(
                            code="target_not_member",
                            message=(
                                f"Organization '{oid}' was not transferred: target "
                                "user has no membership in this organization. "
                                "Deleting the source user will cascade-delete it."
                            ),
                            details={
                                "organization_id": str(oid),
                                "target_user_id": str(target_id),
                            },
                        )
                    )
                org_ids = [oid for oid in org_ids if oid in target_member_org_ids]

        if org_ids:
            # 1. Transfer org ownership
            await _db_transfer_org_ownership_batch(org_ids, target_id)

            # 2. Collect workspace + project IDs within transferred orgs
            all_ws_ids = await _db_get_workspace_ids_for_orgs(org_ids)
            all_proj_ids = await _db_get_project_ids_for_orgs(org_ids)

            # Apply include_workspaces / include_projects filters
            if dto.include_workspaces == "all":
                ws_scope = all_ws_ids
            else:
                ws_filter = {
                    _parse_uuid(wid, "include_workspaces[]")
                    for wid in dto.include_workspaces
                }
                ws_scope = [wid for wid in all_ws_ids if wid in ws_filter]

            if dto.include_projects == "all":
                proj_scope = all_proj_ids
            else:
                proj_filter = {
                    _parse_uuid(pid, "include_projects[]")
                    for pid in dto.include_projects
                }
                proj_scope = [pid for pid in all_proj_ids if pid in proj_filter]

            # 3. Swap EE org/workspace/project membership roles
            if is_ee():
                await _ee_swap_org_memberships(org_ids, source_id, target_id)
                if ws_scope:
                    await _ee_swap_workspace_memberships(ws_scope, source_id, target_id)
                if proj_scope:
                    await _ee_swap_project_memberships(proj_scope, source_id, target_id)

            log.info(
                "[admin] ownership transferred",
                source_id=str(source_id),
                target_id=str(target_id),
                org_count=len(org_ids),
                ws_count=len(ws_scope),
                proj_count=len(proj_scope),
            )
        else:
            log.info(
                "[admin] transfer_ownership: no orgs to transfer",
                source_id=str(source_id),
            )

        return AdminSimpleAccountsOrganizationsTransferOwnershipResponse(
            transferred=[str(oid) for oid in org_ids],
            errors=errors or None,
        )

    # -----------------------------------------------------------------------
    # EE helpers
    # -----------------------------------------------------------------------

    async def _delete_ee_membership(
        self,
        *,
        membership_id: str,
        scope_type: str,
    ) -> AdminDeleteResponse:
        """Delete an EE membership by ID."""
        if not is_ee():
            raise AdminNotImplementedError(f"delete_{scope_type}_membership")

        mid = _parse_uuid(membership_id, "membership_id")

        delete_fn = {
            "organization": _ee_delete_org_membership,
            "workspace": _ee_delete_workspace_membership,
            "project": _ee_delete_project_membership,
        }.get(scope_type)
        if delete_fn is None:
            raise AdminNotImplementedError(f"delete_{scope_type}_membership")

        found = await delete_fn(mid)
        if not found:
            raise AdminMembershipNotFoundError(membership_id)

        deleted = AdminDeletedEntities()
        setattr(
            deleted,
            f"{scope_type}_memberships",
            [AdminDeletedEntity(id=membership_id)],
        )
        return AdminDeleteResponse(dry_run=False, deleted=deleted)


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------


def _parse_uuid(value: str, field: str) -> UUID:
    try:
        return UUID(value)
    except (ValueError, AttributeError):
        raise AdminInvalidReferenceError(field, f"'{value}' is not a valid UUID")


def _default_org_for_user(user: AdminUserCreate) -> AdminOrganizationCreate:
    label = user.name or user.username or user.email.split("@")[0]
    return AdminOrganizationCreate(
        name=f"{label}'s Organization",
        owner_user_ref=EntityRef(ref="user"),
    )


def _default_ws_for_org(org_ref: str) -> AdminWorkspaceCreate:
    return AdminWorkspaceCreate(
        name="Default",
        organization_ref=EntityRef(ref=org_ref),
    )


def _default_proj_for_ws(org_ref: str, ws_ref: str) -> AdminProjectCreate:
    return AdminProjectCreate(
        name="Default",
        organization_ref=EntityRef(ref=org_ref),
        workspace_ref=EntityRef(ref=ws_ref),
        is_default=True,
    )

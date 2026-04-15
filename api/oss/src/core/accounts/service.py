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
from oss.src.utils.env import env as _env
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
        admin_transfer_workspace_memberships as _ee_transfer_workspace_memberships,
        admin_transfer_project_memberships as _ee_transfer_project_memberships,
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

from oss.src.core.accounts.dtos import (
    AdminAccountCreateOptionsDTO,
    AdminAccountReadDTO,
    AdminAccountsCreateDTO,
    AdminAccountsDeleteDTO,
    AdminAccountsResponseDTO,
    AdminApiKeyCreateDTO,
    AdminApiKeyResponseDTO,
    AdminDeleteResponseDTO,
    AdminDeletedEntitiesDTO,
    AdminDeletedEntityDTO,
    AdminOrganizationCreateDTO,
    AdminOrganizationMembershipCreateDTO,
    AdminOrganizationMembershipReadDTO,
    AdminOrganizationReadDTO,
    AdminSubscriptionReadDTO,
    AdminProjectCreateDTO,
    AdminProjectMembershipCreateDTO,
    AdminProjectMembershipReadDTO,
    AdminProjectReadDTO,
    AdminSimpleAccountCreateDTO,
    AdminSimpleAccountReadDTO,
    AdminSimpleAccountsApiKeysCreateDTO,
    AdminSimpleAccountsCreateDTO,
    AdminSimpleAccountsResponseDTO,
    AdminSimpleAccountsDeleteDTO,
    AdminSimpleAccountsOrganizationsCreateDTO,
    AdminSimpleAccountsOrganizationsMembershipsCreateDTO,
    AdminSimpleAccountsProjectsCreateDTO,
    AdminSimpleAccountsProjectsMembershipsCreateDTO,
    AdminSimpleAccountsUsersCreateDTO,
    AdminSimpleAccountsUsersIdentitiesCreateDTO,
    AdminSimpleAccountsWorkspacesCreateDTO,
    AdminSimpleAccountsWorkspacesMembershipsCreateDTO,
    AdminSimpleAccountsUsersResetPasswordDTO,
    AdminSimpleAccountsOrganizationsTransferOwnershipDTO,
    AdminSimpleAccountsOrganizationsTransferOwnershipResponseDTO,
    AdminStructuredErrorDTO,
    AdminUserCreateDTO,
    AdminUserIdentityReadDTO,
    AdminUserReadDTO,
    AdminWorkspaceCreateDTO,
    AdminWorkspaceMembershipCreateDTO,
    AdminWorkspaceMembershipReadDTO,
    AdminWorkspaceReadDTO,
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


def _user_db_to_read_dto(user: UserDB) -> AdminUserReadDTO:
    return AdminUserReadDTO(
        id=str(user.id),
        uid=str(user.uid),
        email=user.email,
        username=user.username,
        name=user.username,  # same field, username serves as name
        created_at=user.created_at.isoformat() if user.created_at else None,
        updated_at=user.updated_at.isoformat() if user.updated_at else None,
    )


def _org_db_to_read_dto(org: OrganizationDB) -> AdminOrganizationReadDTO:
    return AdminOrganizationReadDTO(
        id=str(org.id),
        name=org.name or "",
        slug=org.slug,
        owner_user_id=str(org.owner_id) if org.owner_id else None,
        created_at=org.created_at.isoformat() if org.created_at else None,
        updated_at=org.updated_at.isoformat() if org.updated_at else None,
    )


def _ws_db_to_read_dto(ws: WorkspaceDB) -> AdminWorkspaceReadDTO:
    return AdminWorkspaceReadDTO(
        id=str(ws.id),
        name=ws.name or "",
        organization_id=str(ws.organization_id),
        created_at=ws.created_at.isoformat() if ws.created_at else None,
        updated_at=ws.updated_at.isoformat() if ws.updated_at else None,
    )


def _proj_db_to_read_dto(proj: ProjectDB) -> AdminProjectReadDTO:
    return AdminProjectReadDTO(
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
) -> AdminApiKeyResponseDTO:
    return AdminApiKeyResponseDTO(
        id=str(key.id),
        prefix=key.prefix,
        project_id=str(key.project_id),
        user_id=str(key.created_by_id) if key.created_by_id else "",
        created_at=key.created_at.isoformat() if key.created_at else None,
        value=raw_value,
        returned_once=True if raw_value else None,
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
        dto: AdminAccountsCreateDTO,
    ) -> AdminAccountsResponseDTO:
        options = dto.options or AdminAccountCreateOptionsDTO()
        tracker = _Tracker()
        account = AdminAccountReadDTO()
        errors: List[AdminStructuredErrorDTO] = []

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
                if identity_create.method != "email:password":
                    errors.append(
                        AdminStructuredErrorDTO(
                            code="not_implemented",
                            message=(
                                f"Identity provisioning for method "
                                f"'{identity_create.method}' is not yet implemented "
                                f"(ref: {identity_ref})."
                            ),
                            details={
                                "ref": identity_ref,
                                "method": identity_create.method,
                            },
                        )
                    )
                    continue

                email = identity_create.email or identity_create.subject
                password = identity_create.password
                if not email or not password:
                    errors.append(
                        AdminStructuredErrorDTO(
                            code="invalid_identity",
                            message=(
                                f"email:password identity requires both 'email' (or "
                                f"'subject') and 'password' (ref: {identity_ref})."
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

                st_result = await _ep.sign_up(
                    tenant_id=tenant_id,
                    email=email,
                    password=password,
                )

                if isinstance(st_result, _EpEmailAlreadyExistsError):
                    errors.append(
                        AdminStructuredErrorDTO(
                            code="identity_already_exists",
                            message=f"An email:password identity for '{email}' already exists in SuperTokens (ref: {identity_ref}).",
                            details={"ref": identity_ref, "email": email},
                        )
                    )
                    continue

                if not isinstance(st_result, _EpSignUpOkResult):
                    errors.append(
                        AdminStructuredErrorDTO(
                            code="identity_creation_failed",
                            message=f"SuperTokens sign_up returned an unexpected result (ref: {identity_ref}).",
                            details={"ref": identity_ref},
                        )
                    )
                    continue

                account.user_identities[identity_ref] = AdminUserIdentityReadDTO(
                    id=st_result.recipe_user_id.get_as_string(),
                    user_id=user_id_str or "",
                    method="email:password",
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
                    account.subscriptions[org_ref] = AdminSubscriptionReadDTO(
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
                        AdminStructuredErrorDTO(
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
                key_dto = AdminApiKeyResponseDTO(
                    id=str(key_db.id) if key_db else None,
                    prefix=prefix,
                    project_id=str(proj_id_for_key),
                    user_id=str(user_id_for_key),
                    value=raw_key if options.return_api_keys else None,
                )
                account.api_keys = account.api_keys or {}
                account.api_keys[key_ref] = key_dto
                tracker.api_keys[key_ref] = key_db.id if key_db else _uuid_mod.uuid4()

        return AdminAccountsResponseDTO(
            accounts=[account],
            errors=errors or None,
        )

    async def _create_memberships_ee(
        self,
        dto: AdminAccountsCreateDTO,
        tracker: _Tracker,
        account: AdminAccountReadDTO,
        options: AdminAccountCreateOptionsDTO,
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
            account.organization_memberships[mem_ref] = (
                AdminOrganizationMembershipReadDTO(
                    id=str(ref.id),
                    organization_id=str(org_id),
                    user_id=str(user_id),
                    role=mem_create.role,
                )
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
            account.workspace_memberships[mem_ref] = AdminWorkspaceMembershipReadDTO(
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
            account.project_memberships[mem_ref] = AdminProjectMembershipReadDTO(
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
        dto: AdminAccountsDeleteDTO,
    ) -> AdminDeleteResponseDTO:
        """Delete account graphs by selector.

        Default behavior when only user selectors are given:
        delete their owned organizations first (which cascades to
        workspaces, projects, memberships, and API keys), then
        delete the user records.
        """
        dry_run = bool(dto.dry_run)
        deleted = AdminDeletedEntitiesDTO()

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
                    if org.id not in org_ids:
                        org_ids.append(org.id)

        # Collect workspace and project IDs
        workspace_ids: List[UUID] = [UUID(wid) for wid in (target.workspace_ids or [])]
        project_ids: List[UUID] = [UUID(pid) for pid in (target.project_ids or [])]

        if dry_run:
            # Report what would be deleted without writing
            deleted.organizations = [
                AdminDeletedEntityDTO(id=str(oid)) for oid in org_ids
            ]
            deleted.workspaces = [
                AdminDeletedEntityDTO(id=str(wid)) for wid in workspace_ids
            ]
            deleted.projects = [
                AdminDeletedEntityDTO(id=str(pid)) for pid in project_ids
            ]
            deleted.users = [AdminDeletedEntityDTO(id=str(uid)) for uid in user_ids]
            return AdminDeleteResponseDTO(dry_run=True, deleted=deleted)

        await _db_delete_accounts_batch(
            org_ids=org_ids,
            workspace_ids=workspace_ids,
            project_ids=project_ids,
            user_ids=user_ids,
        )

        deleted.projects = [
            AdminDeletedEntityDTO(id=str(pid)) for pid in project_ids
        ] or None
        deleted.workspaces = [
            AdminDeletedEntityDTO(id=str(wid)) for wid in workspace_ids
        ] or None
        deleted.organizations = [
            AdminDeletedEntityDTO(id=str(oid)) for oid in org_ids
        ] or None
        deleted.users = [AdminDeletedEntityDTO(id=str(uid)) for uid in user_ids] or None

        return AdminDeleteResponseDTO(dry_run=False, deleted=deleted)

    # -----------------------------------------------------------------------
    # Simple Account Create / Delete
    # -----------------------------------------------------------------------

    async def create_simple_accounts(
        self,
        *,
        dto: AdminSimpleAccountsCreateDTO,
    ) -> AdminAccountsResponseDTO:
        """Create one or more accounts from a keyed batch.

        The response ``accounts`` dict is keyed by the same refs used in
        the request, with each entry in the singular shape of the request:
        user/organization/workspace/project/api_key (no plural maps).
        """
        global_options = dto.options or AdminAccountCreateOptionsDTO()
        result = AdminSimpleAccountsResponseDTO()

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
                result.accounts[account_ref] = AdminSimpleAccountReadDTO(
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
        entry: "AdminSimpleAccountCreateDTO",
        global_options: AdminAccountCreateOptionsDTO,
    ) -> AdminAccountsResponseDTO:
        """Build a graph DTO for one simple-account entry and delegate.

        Simple-account defaults (applied when the caller leaves a field as None):
        - create_api_keys   → True
        - return_api_keys   → True
        - create_identities → inferred from whether user_identities is provided
        - seed_defaults     → True  (already the DTO default)
        """
        raw = entry.options or global_options

        effective_options = AdminAccountCreateOptionsDTO(
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

        org_create = entry.organization or _default_org_for_user(entry.user)
        ws_create = entry.workspace or _default_ws_for_org("org")
        proj_create = entry.project or _default_proj_for_ws("org", "wrk")

        ws_create.organization_ref = EntityRef(ref="org")
        proj_create.organization_ref = EntityRef(ref="org")
        proj_create.workspace_ref = EntityRef(ref="wrk")
        proj_create.is_default = True

        graph_dto = AdminAccountsCreateDTO(
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
                    "org_owner": AdminOrganizationMembershipCreateDTO(
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
                    "wrk_owner": AdminWorkspaceMembershipCreateDTO(
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
                    "prj_owner": AdminProjectMembershipCreateDTO(
                        project_ref=EntityRef(ref="prj"),
                        user_ref=EntityRef(ref="user"),
                        role="owner",
                    )
                }

        if entry.subscription:
            graph_dto.subscriptions = {"org": entry.subscription}

        if effective_options.create_api_keys:
            graph_dto.api_keys = {
                "key": AdminApiKeyCreateDTO(
                    user_ref=EntityRef(ref="user"),
                    project_ref=EntityRef(ref="prj"),
                )
            }

        return await self.create_accounts(dto=graph_dto)

    async def delete_simple_accounts(
        self,
        *,
        dto: AdminSimpleAccountsDeleteDTO,
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
        dto: AdminSimpleAccountsUsersCreateDTO,
    ) -> AdminAccountsResponseDTO:
        options = dto.options or AdminAccountCreateOptionsDTO()
        graph_dto = AdminAccountsCreateDTO(
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
                    "org_owner": AdminOrganizationMembershipCreateDTO(
                        organization_ref=EntityRef(ref="org"),
                        user_ref=EntityRef(ref="user"),
                        role="owner",
                    )
                }
                graph_dto.workspace_memberships = {
                    "wrk_owner": AdminWorkspaceMembershipCreateDTO(
                        workspace_ref=EntityRef(ref="wrk"),
                        user_ref=EntityRef(ref="user"),
                        role="owner",
                    )
                }
                graph_dto.project_memberships = {
                    "prj_owner": AdminProjectMembershipCreateDTO(
                        project_ref=EntityRef(ref="prj"),
                        user_ref=EntityRef(ref="user"),
                        role="owner",
                    )
                }
            if options.create_api_keys:
                graph_dto.api_keys = {
                    "key": AdminApiKeyCreateDTO(
                        user_ref=EntityRef(ref="user"),
                        project_ref=EntityRef(ref="prj"),
                    )
                }
        return await self.create_accounts(dto=graph_dto)

    async def create_user_identity(
        self,
        *,
        dto: AdminSimpleAccountsUsersIdentitiesCreateDTO,
    ) -> AdminAccountsResponseDTO:
        """Create a SuperTokens identity for an existing user."""
        identity = dto.user_identity
        if identity.method != "email:password":
            raise AdminNotImplementedError(
                f"create_user_identity for method '{identity.method}'"
            )

        email = identity.email or identity.subject
        password = identity.password
        if not email or not password:
            raise AdminValidationError(
                "email:password identity requires 'email' (or 'subject') and 'password'."
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

        st_result = await _ep.sign_up(
            tenant_id="public",
            email=email,
            password=password,
        )

        if isinstance(st_result, _EpEmailAlreadyExistsError):
            raise AdminValidationError(
                f"An email:password identity for '{email}' already exists in SuperTokens."
            )
        if not isinstance(st_result, _EpSignUpOkResult):
            raise AdminValidationError(
                "SuperTokens sign_up returned an unexpected result."
            )

        identity_dto = AdminUserIdentityReadDTO(
            id=st_result.recipe_user_id.get_as_string(),
            user_id=user_id_str or "",
            method="email:password",
            subject=email,
            email=email,
            verified=identity.verified or False,
            status="created",
        )
        account = AdminAccountReadDTO()
        account.user_identities["identity_0"] = identity_dto
        return AdminAccountsResponseDTO(accounts=[account])

    async def create_organization(
        self,
        *,
        dto: AdminSimpleAccountsOrganizationsCreateDTO,
    ) -> AdminAccountsResponseDTO:
        options = dto.options or AdminAccountCreateOptionsDTO()
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

        org_create = AdminOrganizationCreateDTO(
            name=dto.organization.name,
            slug=dto.organization.slug,
            owner_user_ref=owner_ref,
        )
        ws_create = _default_ws_for_org("org")
        proj_create = _default_proj_for_ws("org", "wrk")

        graph_dto = AdminAccountsCreateDTO(
            options=options,
            users=users or None,
            organizations={"org": org_create},
            workspaces={"wrk": ws_create},
            projects={"prj": proj_create},
        )
        if is_ee() and dto.owner:
            graph_dto.organization_memberships = {
                "org_owner": AdminOrganizationMembershipCreateDTO(
                    organization_ref=EntityRef(ref="org"),
                    user_ref=EntityRef(ref="owner"),
                    role="owner",
                )
            }
            graph_dto.workspace_memberships = {
                "wrk_owner": AdminWorkspaceMembershipCreateDTO(
                    workspace_ref=EntityRef(ref="wrk"),
                    user_ref=EntityRef(ref="owner"),
                    role="owner",
                )
            }
            graph_dto.project_memberships = {
                "prj_owner": AdminProjectMembershipCreateDTO(
                    project_ref=EntityRef(ref="prj"),
                    user_ref=EntityRef(ref="owner"),
                    role="owner",
                )
            }
        return await self.create_accounts(dto=graph_dto)

    async def create_organization_membership(
        self,
        *,
        dto: AdminSimpleAccountsOrganizationsMembershipsCreateDTO,
    ) -> AdminAccountsResponseDTO:
        if not is_ee():
            raise AdminNotImplementedError("organization_memberships")
        options = dto.options or AdminAccountCreateOptionsDTO()
        graph_dto = AdminAccountsCreateDTO(
            options=options,
            organization_memberships={"mem": dto.membership},
        )
        return await self.create_accounts(dto=graph_dto)

    async def create_workspace(
        self,
        *,
        dto: AdminSimpleAccountsWorkspacesCreateDTO,
    ) -> AdminAccountsResponseDTO:
        options = dto.options or AdminAccountCreateOptionsDTO()
        ws_create = dto.workspace
        # The workspace's organization must be specified by id/slug
        # We create a minimal graph: workspace + default project
        proj_create = AdminProjectCreateDTO(
            name="Default",
            organization_ref=ws_create.organization_ref,
            workspace_ref=EntityRef(ref="wrk"),
            is_default=True,
        )
        graph_dto = AdminAccountsCreateDTO(
            options=options,
            workspaces={"wrk": ws_create},
            projects={"prj": proj_create},
        )
        return await self.create_accounts(dto=graph_dto)

    async def create_workspace_membership(
        self,
        *,
        dto: AdminSimpleAccountsWorkspacesMembershipsCreateDTO,
    ) -> AdminAccountsResponseDTO:
        if not is_ee():
            raise AdminNotImplementedError("workspace_memberships")
        options = dto.options or AdminAccountCreateOptionsDTO()
        graph_dto = AdminAccountsCreateDTO(
            options=options,
            workspace_memberships={"mem": dto.membership},
        )
        return await self.create_accounts(dto=graph_dto)

    async def create_project(
        self,
        *,
        dto: AdminSimpleAccountsProjectsCreateDTO,
    ) -> AdminAccountsResponseDTO:
        options = dto.options or AdminAccountCreateOptionsDTO()
        graph_dto = AdminAccountsCreateDTO(
            options=options,
            projects={"prj": dto.project},
        )
        return await self.create_accounts(dto=graph_dto)

    async def create_project_membership(
        self,
        *,
        dto: AdminSimpleAccountsProjectsMembershipsCreateDTO,
    ) -> AdminAccountsResponseDTO:
        if not is_ee():
            raise AdminNotImplementedError("project_memberships")
        options = dto.options or AdminAccountCreateOptionsDTO()
        graph_dto = AdminAccountsCreateDTO(
            options=options,
            project_memberships={"mem": dto.membership},
        )
        return await self.create_accounts(dto=graph_dto)

    async def create_api_key(
        self,
        *,
        dto: AdminSimpleAccountsApiKeysCreateDTO,
    ) -> AdminAccountsResponseDTO:
        options = AdminAccountCreateOptionsDTO(
            create_api_keys=True,
            return_api_keys=(dto.options.return_api_keys if dto.options else False),
        )
        graph_dto = AdminAccountsCreateDTO(
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
    ) -> AdminDeleteResponseDTO:
        uid = _parse_uuid(user_id, "user_id")
        user = await _db_get_user_by_id(uid)
        if not user:
            raise AdminUserNotFoundError(user_id)

        # Remove EE membership records before deleting the user to avoid FK violations
        if is_ee():
            await _ee_delete_user_memberships(uid)

        deleted_org_ids = await _db_delete_user_with_cascade(uid)
        deleted = AdminDeletedEntitiesDTO(
            organizations=[
                AdminDeletedEntityDTO(id=str(oid)) for oid in deleted_org_ids
            ]
            or None,
            users=[AdminDeletedEntityDTO(id=user_id)],
        )
        return AdminDeleteResponseDTO(dry_run=False, deleted=deleted)

    async def delete_user_identity(
        self,
        *,
        user_id: str,
        identity_id: str,
    ) -> AdminDeleteResponseDTO:
        """Delete a SuperTokens recipe identity (recipe user) by its ID."""
        from supertokens_python.asyncio import get_user as _st_get_user, delete_user as _st_delete_user

        st_user = await _st_get_user(identity_id)
        if st_user is None:
            raise AdminUserNotFoundError(identity_id)

        await _st_delete_user(user_id=identity_id, remove_all_linked_accounts=False)
        deleted = AdminDeletedEntitiesDTO(
            user_identities=[AdminDeletedEntityDTO(id=identity_id)]
        )
        return AdminDeleteResponseDTO(dry_run=False, deleted=deleted)

    async def delete_organization(
        self,
        *,
        organization_id: str,
    ) -> AdminDeleteResponseDTO:
        oid = _parse_uuid(organization_id, "organization_id")
        org = await _db_get_org_by_id(oid)
        if not org:
            raise AdminOrganizationNotFoundError(organization_id)

        await _db_delete_organization(oid)
        deleted = AdminDeletedEntitiesDTO(
            organizations=[AdminDeletedEntityDTO(id=organization_id)]
        )
        return AdminDeleteResponseDTO(dry_run=False, deleted=deleted)

    async def delete_organization_membership(
        self,
        *,
        organization_id: str,
        membership_id: str,
    ) -> AdminDeleteResponseDTO:
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
    ) -> AdminDeleteResponseDTO:
        wid = _parse_uuid(workspace_id, "workspace_id")
        ws = await _db_get_workspace_by_id(wid)
        if not ws:
            raise AdminWorkspaceNotFoundError(workspace_id)

        await _db_delete_workspace(wid)
        deleted = AdminDeletedEntitiesDTO(
            workspaces=[AdminDeletedEntityDTO(id=workspace_id)]
        )
        return AdminDeleteResponseDTO(dry_run=False, deleted=deleted)

    async def delete_workspace_membership(
        self,
        *,
        workspace_id: str,
        membership_id: str,
    ) -> AdminDeleteResponseDTO:
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
    ) -> AdminDeleteResponseDTO:
        pid = _parse_uuid(project_id, "project_id")
        proj = await _db_get_project_by_id(pid)
        if not proj:
            raise AdminProjectNotFoundError(project_id)

        await _db_delete_project(pid)
        deleted = AdminDeletedEntitiesDTO(
            projects=[AdminDeletedEntityDTO(id=project_id)]
        )
        return AdminDeleteResponseDTO(dry_run=False, deleted=deleted)

    async def delete_project_membership(
        self,
        *,
        project_id: str,
        membership_id: str,
    ) -> AdminDeleteResponseDTO:
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
    ) -> AdminDeleteResponseDTO:
        kid = _parse_uuid(api_key_id, "api_key_id")
        key = await _db_get_api_key_by_id(kid)
        if not key:
            raise AdminApiKeyNotFoundError(api_key_id)

        await _db_delete_api_key(kid)
        deleted = AdminDeletedEntitiesDTO(
            api_keys=[AdminDeletedEntityDTO(id=api_key_id)]
        )
        return AdminDeleteResponseDTO(dry_run=False, deleted=deleted)

    # -----------------------------------------------------------------------
    # Actions
    # -----------------------------------------------------------------------

    async def reset_password(
        self,
        *,
        dto: AdminSimpleAccountsUsersResetPasswordDTO,
    ) -> None:
        """Update the password on one or more existing email:password identities.

        For each identity in ``dto.user_identities``:
        1. Look up the SuperTokens user by email (or subject).
        2. Find the ``emailpassword`` login method on that user.
        3. Call ``update_email_or_password`` with the new password.
        """
        tenant_id = "public"

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

            # Look up the ST user by email.
            st_users = await _st_list_users_by_account_info(
                tenant_id=tenant_id,
                account_info=_StAccountInfoInput(email=email),
            )

            recipe_user_id: Optional[str] = None
            for st_user in st_users:
                for lm in st_user.login_methods:
                    if lm.recipe_id == "emailpassword":
                        recipe_user_id = lm.recipe_user_id
                        break
                if recipe_user_id:
                    break

            if not recipe_user_id:
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
        dto: AdminSimpleAccountsOrganizationsTransferOwnershipDTO,
    ) -> AdminSimpleAccountsOrganizationsTransferOwnershipResponseDTO:
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

        errors: List[AdminStructuredErrorDTO] = []

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
                            AdminStructuredErrorDTO(
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
                        AdminStructuredErrorDTO(
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

            # 3. Transfer EE workspace + project memberships
            if is_ee() and (ws_scope or proj_scope):
                if ws_scope:
                    await _ee_transfer_workspace_memberships(
                        ws_scope, source_id, target_id
                    )
                if proj_scope:
                    await _ee_transfer_project_memberships(
                        proj_scope, source_id, target_id
                    )

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

        return AdminSimpleAccountsOrganizationsTransferOwnershipResponseDTO(
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
    ) -> AdminDeleteResponseDTO:
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

        deleted = AdminDeletedEntitiesDTO()
        setattr(
            deleted,
            f"{scope_type}_memberships",
            [AdminDeletedEntityDTO(id=membership_id)],
        )
        return AdminDeleteResponseDTO(dry_run=False, deleted=deleted)


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------


def _parse_uuid(value: str, field: str) -> UUID:
    try:
        return UUID(value)
    except (ValueError, AttributeError):
        raise AdminInvalidReferenceError(field, f"'{value}' is not a valid UUID")


def _default_org_for_user(user: AdminUserCreateDTO) -> AdminOrganizationCreateDTO:
    label = user.name or user.username or user.email.split("@")[0]
    return AdminOrganizationCreateDTO(
        name=f"{label}'s Organization",
        owner_user_ref=EntityRef(ref="user"),
    )


def _default_ws_for_org(org_ref: str) -> AdminWorkspaceCreateDTO:
    return AdminWorkspaceCreateDTO(
        name="Default",
        organization_ref=EntityRef(ref=org_ref),
    )


def _default_proj_for_ws(org_ref: str, ws_ref: str) -> AdminProjectCreateDTO:
    return AdminProjectCreateDTO(
        name="Default",
        organization_ref=EntityRef(ref=org_ref),
        workspace_ref=EntityRef(ref=ws_ref),
        is_default=True,
    )

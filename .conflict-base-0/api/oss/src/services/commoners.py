from os import getenv
from json import loads
from typing import List, Optional
from traceback import format_exc
from uuid import UUID

from pydantic import BaseModel

from oss.src.utils.logging import get_module_logger
from oss.src.utils.locking import acquire_lock, release_lock
from oss.src.utils.common import env, is_ee

from oss.src.middlewares import analytics
from oss.src.services import db_manager
from oss.src.services.db_manager import (
    add_user_to_organization,
    add_user_to_workspace,
    add_user_to_project,
)
from oss.src.services.user_service import create_new_user, delete_user
from oss.src.models.db_models import (
    OrganizationDB,
    OrganizationMemberDB,
    ProjectDB,
    ProjectMemberDB,
    UserDB,
    WorkspaceDB,
    WorkspaceMemberDB,
)
from oss.src.core.organizations.exceptions import OrganizationCreationNotAllowedError

log = get_module_logger(__name__)

DEMOS = "AGENTA_DEMOS"
DEMO_ROLE = "viewer"


class Demo(BaseModel):
    organization_id: str
    workspace_id: str
    project_id: str


async def list_all_demos() -> List[Demo]:
    demos = []

    try:
        demo_project_ids = loads(getenv(DEMOS) or "[]")

        for project_id in demo_project_ids:
            project = await db_manager.get_project_by_id(project_id)

            if project is None:
                continue

            try:
                demos.append(
                    Demo(
                        organization_id=str(project.organization_id),
                        workspace_id=str(project.workspace_id),
                        project_id=str(project.id),
                    )
                )

            except Exception:
                log.error(format_exc())

    except Exception:
        log.error(format_exc())

    return demos


async def add_user_to_demos(user_id: str) -> None:
    demos = await list_all_demos()

    for organization_id in {demo.organization_id for demo in demos}:
        await add_user_to_organization(organization_id, user_id)

    for workspace_id in {demo.workspace_id for demo in demos}:
        await add_user_to_workspace(workspace_id, user_id, DEMO_ROLE)

    for project_id in {demo.project_id for demo in demos}:
        await add_user_to_project(project_id, user_id, DEMO_ROLE, is_demo=True)


def can_create_organization(email: str) -> bool:
    """Check if a user is allowed to create organizations.

    When AGENTA_ACCESS_ALLOWED_OWNER_EMAILS is set, only listed emails can create orgs.
    When not set (None), anyone can create orgs (default behavior).
    """

    allowlist = env.agenta.access.allowed_owner_emails

    if allowlist is None:
        return True

    return email.strip().lower() in allowlist


async def create_organization(
    *,
    user: UserDB,
    name: Optional[str] = None,
    description: Optional[str] = None,
) -> OrganizationDB:
    """Create an organization with its owner membership, default workspace,
    default project, and seeded defaults.

    This is the shared creation core: OSS uses it directly; EE wraps it with
    subscription/entitlement setup.
    """

    from oss.src.dbs.postgres.shared.engine import get_transactions_engine

    engine = get_transactions_engine()

    async with engine.session() as session:
        organization_db = OrganizationDB(
            name=name,
            description=description,
            flags={
                "is_demo": False,
                "allow_email": env.auth.email_enabled,
                "allow_social": env.auth.oidc_enabled,
                "allow_sso": False,
                "allow_root": False,
                "domains_only": False,
                "auto_join": False,
            },
            owner_id=user.id,
            created_by_id=user.id,
        )
        session.add(organization_db)
        await session.commit()

        log.info(
            "[scopes] organization created",
            organization_id=organization_db.id,
        )

        organization_member = OrganizationMemberDB(
            user_id=user.id,
            organization_id=organization_db.id,
            role="owner",
        )
        session.add(organization_member)
        await session.commit()

        log.info(
            "[scopes] organization membership created",
            organization_id=organization_db.id,
            user_id=user.id,
            role="owner",
            membership_id=organization_member.id,
        )

        workspace_db = WorkspaceDB(
            name="Default",
            type="default",
            description="",
            organization_id=organization_db.id,
        )
        session.add(workspace_db)
        await session.commit()

        log.info(
            "[scopes] workspace created",
            organization_id=organization_db.id,
            workspace_id=workspace_db.id,
        )

        workspace_member = WorkspaceMemberDB(
            user_id=user.id,
            workspace_id=workspace_db.id,
            role="owner",
        )
        session.add(workspace_member)
        await session.commit()

        project_db = ProjectDB(
            project_name="Default",
            is_default=True,
            organization_id=organization_db.id,
            workspace_id=workspace_db.id,
        )
        session.add(project_db)
        await session.commit()

        log.info(
            "[scopes] project created",
            organization_id=organization_db.id,
            workspace_id=workspace_db.id,
            project_id=project_db.id,
        )

        project_member = ProjectMemberDB(
            user_id=user.id,
            project_id=project_db.id,
            role="owner",
        )
        session.add(project_member)
        await session.commit()

    await db_manager.add_default_simple_testsets(
        project_id=str(project_db.id),
        user_id=str(user.id),
    )

    from oss.src.core.environments.defaults import create_default_environments
    from oss.src.core.evaluators.defaults import create_default_evaluators

    await create_default_evaluators(
        project_id=project_db.id,
        user_id=user.id,
    )
    await create_default_environments(
        project_id=project_db.id,
        user_id=user.id,
    )

    return organization_db


async def create_organization_for_signup(
    user_id: UUID,
    organization_email: str,
    organization_name: Optional[str] = None,
    organization_description: Optional[str] = None,
) -> OrganizationDB:
    """Create an organization for a newly signed-up user.

    EE provisions the signup subscription + seeds the user gauge; OSS captures
    a deployment-created analytics event for the first org.
    """

    user = await db_manager.get_user(str(user_id))
    if not user:
        raise ValueError(f"User {user_id} not found")

    is_first_organization = not await db_manager.get_organizations()

    organization = await create_organization(
        user=user,
        name=organization_name,
        description=organization_description,
    )

    log.info("[scopes] Organization [%s] created", organization.id)

    if is_ee():
        from ee.src.core.organizations.service import (  # noqa: PLC0415
            provision_signup_subscription,
        )

        await provision_signup_subscription(
            organization,
            organization_email=organization_email,
        )
    elif is_first_organization:
        analytics.capture_oss_deployment_created(
            user_email=organization_email,
            organization_id=str(organization.id),
        )

    return organization


async def create_organization_for_user(
    user_id: UUID,
    organization_name: Optional[str] = None,
    organization_description: Optional[str] = None,
) -> OrganizationDB:
    """Create an organization for an existing user (POST /organizations/).

    EE starts the default plan + seeds the user gauge.
    """

    user = await db_manager.get_user(str(user_id))
    if not user:
        raise ValueError(f"User {user_id} not found")

    if not can_create_organization(user.email):
        raise OrganizationCreationNotAllowedError(email=user.email)

    organization = await create_organization(
        user=user,
        name=organization_name,
        description=organization_description,
    )

    log.info("[scopes] Organization [%s] created", organization.id)

    if is_ee():
        from ee.src.core.organizations.service import (  # noqa: PLC0415
            provision_user_subscription,
        )

        await provision_user_subscription(organization)

    return organization


async def create_accounts(
    payload: dict,
    organization_name: Optional[str] = None,
) -> UserDB:
    """Create a user account and, when allowed, a personal organization.

    Demo seeding runs in both editions. Subscription-backed org creation and
    the Loops marketing contact layer on (EE) via `is_ee()` seams inside the
    org-creation flow / below.
    """

    user_dict = {
        "uid": payload["uid"],
        "email": payload["email"],
        "username": payload["email"].split("@")[0],
    }

    email = user_dict["email"]

    lock_owner = await acquire_lock(
        namespace="account-creation",
        key=email,
    )

    if not lock_owner:
        log.info("[scopes] account creation lock already taken")
        user = await db_manager.get_user_with_email(email=email)
        return user

    log.info("[scopes] account creation lock acquired")

    try:
        user = await db_manager.get_user_with_email(email=email)
        user_is_new = user is None

        if user is None:
            user = await create_new_user(user_dict)
            log.info("[scopes] User [%s] created", user.id)

        user_organizations = await db_manager.get_user_organizations(str(user.id))
        user_has_organization = len(user_organizations) > 0

        if user_is_new and not user_has_organization:
            # If setup fails, delete the user to avoid orphaned records.
            try:
                await add_user_to_demos(str(user.id))

                if can_create_organization(email):
                    resolved_org_name = organization_name or user_dict["username"]
                    await create_organization_for_signup(
                        user_id=UUID(str(user.id)),
                        organization_email=email,
                        organization_name=resolved_org_name,
                        organization_description="Default Organization",
                    )
                else:
                    log.info(
                        "[scopes] User [%s] not in org creation allowlist, skipping org creation",
                        user.id,
                    )
            except Exception:
                log.error(
                    "[scopes] setup failed for user [%s], deleting user",
                    user.id,
                    exc_info=True,
                )
                try:
                    await delete_user(str(user.id))
                except Exception as delete_error:
                    log.error(
                        "[scopes] failed to delete user [%s]: %s",
                        user.id,
                        str(delete_error),
                    )
                raise
        elif user_has_organization:
            log.info(
                "[scopes] User [%s] already has organization, skipping setup",
                user.id,
            )

        log.info("[scopes] User [%s] authenticated", user.id)

        from oss.src.core.auth.service import AuthService

        try:
            await AuthService().enforce_domain_policies(
                email=email,
                user_id=user.id,
            )
        except Exception:
            log.error(
                "Error enforcing domain policies after signup",
                exc_info=True,
            )

        if is_ee():
            try:
                # Adds the contact to Loops for marketing emails.
                from oss.src.utils import emailing  # noqa: PLC0415

                emailing.add_contact(email)
            except ConnectionError as ex:
                log.warn("error adding contact to loops %s", ex)

        return user

    finally:
        released = await release_lock(
            namespace="account-creation",
            key=email,
            owner=lock_owner,
        )
        if released:
            log.info("[scopes] account creation lock released")
        else:
            log.warn("[scopes] account creation lock already expired")

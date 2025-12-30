from os import getenv
from json import loads
from typing import List, Optional
from traceback import format_exc
from uuid import UUID

from pydantic import BaseModel

from oss.src.utils.logging import get_module_logger
from oss.src.services import db_manager
from oss.src.utils.common import is_ee
from ee.src.services import workspace_manager
from ee.src.services.db_manager_ee import (
    create_organization,
    add_user_to_organization,
    add_user_to_workspace,
    add_user_to_project,
)
from ee.src.services.selectors import (
    user_exists,
)
from ee.src.models.api.organization_models import CreateOrganization
from oss.src.services.user_service import (
    create_new_user,
    check_user_exists,
    delete_user,
)
from oss.src.models.db_models import UserDB, OrganizationDB
from ee.src.services.email_helper import (
    add_contact_to_loops,
)

log = get_module_logger(__name__)

from ee.src.dbs.postgres.subscriptions.dao import SubscriptionsDAO
from ee.src.core.subscriptions.service import SubscriptionsService
from ee.src.dbs.postgres.meters.dao import MetersDAO
from ee.src.core.meters.service import MetersService

subscription_service = SubscriptionsService(
    subscriptions_dao=SubscriptionsDAO(),
    meters_service=MetersService(
        meters_dao=MetersDAO(),
    ),
)

from ee.src.utils.entitlements import check_entitlements, Gauge

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

            try:
                demos.append(
                    Demo(
                        organization_id=str(project.organization_id),
                        workspace_id=str(project.workspace_id),
                        project_id=str(project.id),
                    )
                )

            except:  # pylint: disable=bare-except
                log.error(format_exc())

    except:  # pylint: disable=bare-except
        log.error(format_exc())

    return demos


async def add_user_to_demos(user_id: str) -> None:
    try:
        demos = await list_all_demos()

        for organization_id in {demo.organization_id for demo in demos}:
            await add_user_to_organization(
                organization_id,
                user_id,
                # is_demo=True,
            )

        for workspace_id in {demo.workspace_id for demo in demos}:
            await add_user_to_workspace(
                workspace_id,
                user_id,
                DEMO_ROLE,
                # is_demo=True,
            )

        for project_id in {demo.project_id for demo in demos}:
            await add_user_to_project(
                project_id,
                user_id,
                DEMO_ROLE,
                is_demo=True,
            )

    except Exception as exc:
        raise exc  # TODO: handle exceptions


async def create_accounts(
    payload: dict,
    organization_name: str = "Personal",
    is_personal: bool = True,
    use_reverse_trial: bool = True,
):
    """Creates a user account and an associated organization based on the
    provided payload.

    Arguments:
        payload (dict): The required payload. It consists of; user_id and user_email
        organization_name (str): Name for the organization. Default: "Personal"
        is_personal (bool): Whether this is a personal org. Default: True
        use_reverse_trial (bool): Use reverse trial (True) or hobby plan (False). Default: True
    """

    # Only keep fields expected by UserDB to avoid TypeErrors (e.g., organization_id)
    user_dict = {
        "uid": payload["uid"],
        "email": payload["email"],
        "username": payload["email"].split("@")[0],
    }

    user = await db_manager.get_user_with_email(email=user_dict["email"])
    if user is None:
        # Check if user exists before attempting creation
        user_existed_before = await check_user_exists(user_dict["email"])

        # Create user (idempotent - returns existing if found)
        user = await create_new_user(user_dict)

        # Check if user exists after creation
        user_existed_after = await check_user_exists(user_dict["email"])

        # If user didn't exist before but exists after, we created it
        if not user_existed_before and user_existed_after:
            # We successfully created the user, proceed with setup
            # If setup fails, delete the user to avoid orphaned records
            try:
                log.info("[scopes] User [%s] created", user.id)

                # Add the user to demos
                await add_user_to_demos(str(user.id))

                # Create organization with workspace and subscription
                await create_organization_with_subscription(
                    user_id=UUID(str(user.id)),
                    organization_email=user_dict["email"],
                    organization_name=organization_name,
                    organization_description=None,
                    is_personal=is_personal,
                    use_reverse_trial=use_reverse_trial,
                )
            except Exception as e:
                # Setup failed - delete the user to avoid orphaned state
                log.error(
                    "[scopes] Setup failed for user [%s], deleting user: %s",
                    user.id,
                    str(e),
                )
                try:
                    await delete_user(str(user.id))
                except Exception as delete_error:
                    log.error(
                        "[scopes] Failed to delete user [%s]: %s",
                        user.id,
                        str(delete_error),
                    )
                # Re-raise the original error
                raise
        else:
            # User already existed (race condition) - skip all setup
            log.info("[scopes] User [%s] already exists, skipping setup", user.id)

    log.info("[scopes] User [%s] authenticated", user.id)

    if is_ee():
        try:
            # Adds contact to loops for marketing emails. TODO: Add opt-in checkbox to supertokens
            add_contact_to_loops(user_dict["email"])  # type: ignore
        except ConnectionError as ex:
            log.warn("Error adding contact to loops %s", ex)

    return user


async def create_organization_with_subscription(
    user_id: UUID,
    organization_email: str,
    organization_name: str,
    organization_description: Optional[str] = None,
    is_personal: bool = False,
    use_reverse_trial: bool = False,
) -> OrganizationDB:
    """Create an organization with workspace and subscription for an existing user.

    Args:
        user_id: The user's UUID
        organization_email: The user's email for subscription
        organization_name: Name for the organization
        organization_description: Optional description
        is_personal: Whether this is a personal org (default: False for collaborative)
        use_reverse_trial: Use reverse trial (True) or hobby plan (False)

    Returns:
        OrganizationDB: The created organization
    """
    # Get user object
    user = await db_manager.get_user(str(user_id))
    if not user:
        raise ValueError(f"User {user_id} not found")

    # Prepare payload to create organization
    create_org_payload = CreateOrganization(
        name=organization_name,
        description=organization_description,
        is_demo=False,
        is_personal=is_personal,
        owner_id=user_id,
    )

    # Create organization and workspace
    organization = await create_organization(
        payload=create_org_payload,
        user=user,
    )

    log.info("[scopes] Organization [%s] created", organization.id)

    # Start subscription based on type
    try:
        if use_reverse_trial:
            await subscription_service.start_reverse_trial(
                organization_id=str(organization.id),
                organization_name=organization.name,
                organization_email=organization_email,
            )
        else:
            # Start hobby/free plan
            await subscription_service.start_free_plan(
                organization_id=str(organization.id),
            )
    except Exception as exc:
        log.error(
            "[scopes] Failed to create subscription for organization [%s]: %s",
            organization.id,
            exc,
        )
        raise exc

    # Check entitlements
    await check_entitlements(
        organization_id=str(organization.id),
        key=Gauge.USERS,
        delta=1,
    )

    return organization

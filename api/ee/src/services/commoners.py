from os import getenv
from json import loads
from typing import List
from traceback import format_exc

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
from oss.src.services.user_service import create_new_user
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


async def create_accounts(payload: dict):
    """Creates a user account and an associated organization based on the
    provided payload.

    Arguments:
        payload (dict): The required payload. It consists of; user_id and user_email
    """

    # Only keep fields expected by UserDB to avoid TypeErrors (e.g., organization_id)
    user_dict = {
        "uid": payload["uid"],
        "email": payload["email"],
        "username": payload["email"].split("@")[0],
    }

    user = await db_manager.get_user_with_email(email=user_dict["email"])
    if user is None:
        log.info("[scopes] Yey! A new user is signing up!")

        # Create user first
        user = await create_new_user(user_dict)

        log.info("[scopes] User [%s] created", user.id)

        # Prepare payload to create organization
        create_org_payload = CreateOrganization(
            name=user_dict["username"],
            description="Default Organization",
            owner=str(user.id),
            type="default",
        )

        # Create the user's default organization and workspace
        organization = await create_organization(
            payload=create_org_payload,
            user=user,
        )

        log.info("[scopes] Organization [%s] created", organization.id)

        # Add the user to demos
        await add_user_to_demos(str(user.id))

        # Start reverse trial
        try:
            await subscription_service.start_reverse_trial(
                organization_id=str(organization.id),
                organization_name=organization.name,
                organization_email=user_dict["email"],
            )

        except Exception as exc:
            raise exc  # TODO: handle exceptions
            # await subscription_service.start_free_plan(
            #     organization_id=str(organization.id),
            # )

        await check_entitlements(
            organization_id=str(organization.id),
            key=Gauge.USERS,
            delta=1,
        )

    log.info("[scopes] User [%s] authenticated", user.id)

    if is_ee():
        try:
            # Adds contact to loops for marketing emails. TODO: Add opt-in checkbox to supertokens
            add_contact_to_loops(user_dict["email"])  # type: ignore
        except ConnectionError as ex:
            log.warn("Error adding contact to loops %s", ex)

from typing import Union
from agenta_backend.models.api.user_models import User
from agenta_backend.services.selectors import user_exists
from agenta_backend.models.api.organization_models import Organization
from agenta_backend.services.user_service import create_new_user
from agenta_backend.services.organization_service import (
    create_new_organization,
)


async def create_accounts(payload: dict) -> Union[str, str]:
    """Creates a user account and an associated organization based on the
    provided payload.

    Arguments:
        payload (dict): The required payload. It consists of; user_id and user_email

    Returns:
        a tuple containing the user_id and org_id as strings.
    """

    user_dict = {
        "id": payload["user_id"],
        "email": payload["user_email"],
        "username": payload["user_email"].split("@")[0],
    }

    does_user_exist = await user_exists(user_dict["email"])
    if not does_user_exist:
        print("================ SIGNUP ====================")
        organization = Organization(**{"name": user_dict["username"]})
        org = await create_new_organization(organization)

        if org is not None:
            user_dict["organization_id"] = str(org.inserted_id)
            user = User(**user_dict)
            await create_new_user(user)

    print("================ LOGIN ====================")

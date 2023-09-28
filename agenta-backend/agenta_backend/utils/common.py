from bson import ObjectId
from odmantic import query
from fastapi.responses import JSONResponse
from typing import Dict, List, Union, Optional
from agenta_backend.models.db_engine import DBEngine
from agenta_backend.models.db_models import (
    UserDB,
    AppVariantDB,
    OrganizationDB,
    AppDB,
)
import logging

engine = DBEngine().engine()
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


async def get_organization(org_id: str) -> OrganizationDB:
    org = await engine.find_one(OrganizationDB, OrganizationDB.id == ObjectId(org_id))
    if org is not None:
        return org
    else:
        return None


async def get_app_instance(
    app_id: str, variant_name: str = None, show_deleted: bool = False
) -> AppVariantDB:
    if variant_name is not None:
        query_expression = (
            query.eq(AppVariantDB.is_deleted, show_deleted)
            & query.eq(AppVariantDB.app_id, ObjectId(app_id))
            & query.eq(AppVariantDB.variant_name, variant_name)
        )
    else:
        query_expression = query.eq(AppVariantDB.is_deleted, show_deleted) & query.eq(
            AppVariantDB.app_name, ObjectId(app_id)
        )

    print("query_expression: " + str(query_expression))

    app_instance = await engine.find_one(AppVariantDB, query_expression)

    print("app_instance: " + str(app_instance))
    return app_instance


async def check_user_org_access(
    kwargs: dict, organization_id: str, owner=False
) -> bool:
    if owner:  # Check that the user is the owner of the organization
        user = await engine.find_one(UserDB, UserDB.uid == kwargs["uid"])
        organization = await get_organization(organization_id)
        if not organization:
            logger.error("Organization not found")
            raise Exception("Organization not found")
        return organization.owner == str(user.id)
    else:
        user_organizations: List = kwargs["organization_ids"]
        object_organization_id = ObjectId(organization_id)
        logger.debug(
            f"object_organization_id: {object_organization_id}, user_organizations: {user_organizations}"
        )
        return object_organization_id in user_organizations


async def check_access_to_app(
    user_org_data: Dict[str, Union[str, list]],
    app: Optional[AppDB] = None,
    app_id: Optional[ObjectId] = None,
    check_owner: bool = False,
) -> bool:
    """
    Check if a user has access to a specific application.

    Args:
        user_org_data (Dict[str, Union[str, list]]): User-specific information.
        app (Optional[AppDB]): An instance of the AppDB model representing the application.
        app_id (Optional[ObjectId]): The ID of the application.
        check_owner (bool): Whether to check if the user is the owner of the application.

    Returns:
        bool: True if the user has access, False otherwise.

    Raises:
        Exception: If neither or both `app` and `app_id` are provided.

    """
    if (app is None) == (app_id is None):
        raise Exception("Provide either app or app_id, not both or neither")

    # Fetch the app if only app_id is provided.
    if app is None:
        app = await engine.find_one(AppDB, AppDB.id == app_id)
        if app is None:
            logger.error("App not found")
            return False

    # Check user's access to the organization linked to the app.
    organization_id = app.organization_id.id
    return await check_user_org_access(user_org_data, str(organization_id), check_owner)


async def check_access_to_variant(
    kwargs: Dict[str, Union[str, list]],
    variant_id: str,
    check_owner: bool = False,
) -> bool:
    if variant_id is None:
        raise Exception("No variant_id provided")
    variant = await engine.find_one(
        AppVariantDB, AppVariantDB.id == ObjectId(variant_id)
    )
    if variant is None:
        logger.error("Variant not found")
        return False
    organization_id = variant.organization_id.id
    return await check_user_org_access(kwargs, str(organization_id), check_owner)

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

engine = DBEngine(mode="default").engine()
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


async def get_organization(org_id: str) -> OrganizationDB:
    org = await engine.find_one(OrganizationDB, OrganizationDB.id == ObjectId(org_id))
    if org is not None:
        return org
    else:
        return None


async def get_app_instance(
    app_name: str, variant_name: str = None, show_deleted: bool = False
) -> AppVariantDB:
    print("app_name: " + str(app_name))
    print("variant_name: " + str(variant_name))

    if variant_name is not None:
        query_expression = (
            query.eq(AppVariantDB.is_deleted, show_deleted)
            & query.eq(AppVariantDB.app_name, app_name)
            & query.eq(AppVariantDB.variant_name, variant_name)
        )
    else:
        query_expression = query.eq(AppVariantDB.is_deleted, show_deleted) & query.eq(
            AppVariantDB.app_name, app_name
        )

    print("query_expression: " + str(query_expression))

    app_instance = await engine.find_one(AppVariantDB, query_expression)

    print("app_instance: " + str(app_instance))
    return app_instance


async def check_user_org_access(
    kwargs: dict, organization_id: str, owner=False
) -> bool:
    if not owner:
        user_organizations: List = kwargs["organization_ids"]
        object_organization_id = ObjectId(organization_id)
        return object_organization_id in user_organizations
    elif owner:
        user = await engine.find_one(UserDB, UserDB.uid == kwargs["uid"])
        organization = await get_organization(organization_id)
        if not organization:
            logger.error("Organization not found")
            raise Exception("Organization not found")
        return organization.owner == str(user.id)


async def check_access_to_app(
    kwargs: Dict[str, Union[str, list]],
    app: Optional[AppDB] = None,
    app_id: Optional[str] = None,
    check_owner: bool = False,
) -> bool:
    if app_id is None and app is None:
        raise Exception("No app or app_id provided")
    if app_id is not None and app is not None:
        raise Exception("Provide either app or app_id, not both")
    if app is None and app_id is not None:
        app = await engine.find_one(AppDB, AppDB.id == ObjectId(app_id))
        if app is None:
            logger.error("App not found")
            return False
    organization_id = app.organization_id.id
    return await check_user_org_access(kwargs, str(organization_id), check_owner)


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

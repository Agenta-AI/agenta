from bson import ObjectId
from odmantic import query
from fastapi.responses import JSONResponse
from typing import Dict, List, Union, Optional
from agenta_backend.models.db_engine import DBEngine
from agenta_backend.models.db_models import (
    UserDB,
    AppVariantDB,
    OrganizationDB,
)

engine = DBEngine(mode="default").engine()

async def get_organization(org_id: str) -> OrganizationDB:
    org = await engine.find_one(OrganizationDB, OrganizationDB.id == ObjectId(org_id))
    if org is not None:
        return org
    else:
        return None


async def get_app_instance(
    app_name: str,
    variant_name: str = None,
    show_deleted: bool = False
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
        query_expression = (
            query.eq(AppVariantDB.is_deleted, show_deleted)
            & query.eq(AppVariantDB.app_name, app_name)
        )
        
    print("query_expression: " + str(query_expression))

    app_instance =  await engine.find_one(
        AppVariantDB, query_expression
    )
    
    print("app_instance: " + str(app_instance))
    return app_instance

async def check_user_org_access(kwargs: dict, organization_id: str, owner=False) -> bool:
    if owner == False:
        user_organizations: List = kwargs["organization_ids"]
        object_organization_id = ObjectId(
            organization_id
        )  # Parse the provided organization_id

        if object_organization_id in user_organizations:
            return True
        else:
            return False
    elif owner == True:
        user = await engine.find_one(UserDB, UserDB.uid == kwargs["uid"])
        organization = await get_organization(organization_id)
        if organization is not None:
            if organization.owner != str(user.id):
                return False
            else:
                return True
        else:
            return JSONResponse(
                    {"detail": "This organization doesn't exist"},
                    status_code=400,
                )

async def check_access_to_app(
    kwargs: Dict[str, Union[str, list]],
    app_variant: Optional[AppVariantDB] = None,
    app_name: Optional[str] = None,
    check_owner: bool = False
) -> bool:
    if app_variant is None and app_name is None:
        return JSONResponse(
                {"detail": "Check for app access failed, provide AppVaraint"},
                status_code=500,
            )

    if app_variant is None:
        app_variant = await engine.find_one(AppVariantDB, AppVariantDB.app_name == app_name)


    organization_id = app_variant.organization_id
    return await check_user_org_access(kwargs, str(organization_id), check_owner)

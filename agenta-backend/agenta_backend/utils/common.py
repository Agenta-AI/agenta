import logging
from typing import Dict, List, Union, Optional, Any, Callable

from fastapi.types import DecoratedCallable
from fastapi import APIRouter as FastAPIRouter

from agenta_backend.models.db_models import (
    UserDB,
    AppVariantDB,
    OrganizationDB,
    AppDB,
    VariantBaseDB,
    WorkspaceDB,
    Permission,
    WorkspaceRole,
)

from beanie import PydanticObjectId as ObjectId


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


class APIRouter(FastAPIRouter):
    """
    Extends the FastAPIRouter class to provide support for alternate paths ending with a forward slash.

    Methods:
    - api_route: Adds a route to the router with both the original path and an alternate path ending with a forward slash.
    """

    def api_route(
        self, path: str, *, include_in_schema: bool = True, **kwargs: Any
    ) -> Callable[[DecoratedCallable], DecoratedCallable]:
        """
        Decorator method that adds a route to the router with both the original path and an alternate path ending with a forward slash.

        Parameters:
        - path (str): The original path for the route.
        - include_in_schema (bool): Whether to include the route in the generated OpenAPI schema. Default is True.
        - **kwargs (Any): Additional keyword arguments to pass to the underlying api_route method.

        Returns:
        - decorator (Callable[[DecoratedCallable], DecoratedCallable]): A decorator function that can be used to decorate a route function.
        """
        if path.endswith("/"):
            path = path[:-1]

        add_path = super().api_route(
            path, include_in_schema=include_in_schema, **kwargs
        )

        alternate_path = path + "/"
        add_alternate_path = super().api_route(
            alternate_path, include_in_schema=False, **kwargs
        )

        def decorator(func: DecoratedCallable) -> DecoratedCallable:
            add_alternate_path(func)
            return add_path(func)

        return decorator


async def get_organization(org_id: str) -> OrganizationDB:
    org = await OrganizationDB.find_one(OrganizationDB.id == ObjectId(org_id))
    if org is not None:
        return org
    else:
        return None


async def get_app_instance(
    app_id: str, variant_name: str = None, show_deleted: bool = False
) -> AppVariantDB:
    queries = (AppVariantDB.is_deleted == show_deleted, AppVariantDB.app == app_id)
    if variant_name is not None:
        queries += AppVariantDB.variant_name == variant_name

    app_instance = await AppVariantDB.find_one(*queries)
    return app_instance


async def check_user_org_access(
    kwargs: dict, organization_id: str, check_owner=False
) -> bool:
    if check_owner:  # Check that the user is the owner of the organization
        user = await UserDB.find_one(UserDB.uid == kwargs["uid"])
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
        user_exists_in_organizations = object_organization_id in user_organizations
        return user_exists_in_organizations


async def check_access_to_app(
    user_org_data: Dict[str, Union[str, list]],
    app: Optional[AppDB] = None,
    app_id: Optional[str] = None,
    check_owner: bool = False,
) -> bool:
    """
    Check if a user has access to a specific application.

    Args:
        user_org_data (Dict[str, Union[str, list]]): User-specific information.
        app (Optional[AppDB]): An instance of the AppDB model representing the application.
        app_id (Optional[str]): The ID of the application.
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
        app = await AppDB.find_one(AppDB.id == ObjectId(app_id), fetch_links=True)
        if app is None:
            logger.error("App not found")
            return False

    # Check user's access to the organization linked to the app.
    organization_id = app.organization.id
    return await check_user_org_access(user_org_data, str(organization_id), check_owner)


async def check_access_to_variant(
    user_org_data: Dict[str, Union[str, list]],
    variant_id: str,
    check_owner: bool = False,
) -> bool:
    if variant_id is None:
        raise Exception("No variant_id provided")
    variant = await AppVariantDB.find_one(
        AppVariantDB.id == ObjectId(variant_id), fetch_links=True
    )
    if variant is None:
        logger.error("Variant not found")
        return False
    organization_id = variant.organization.id
    return await check_user_org_access(user_org_data, str(organization_id), check_owner)


async def check_access_to_base(
    user_org_data: Dict[str, Union[str, list]],
    base_id: str,
    check_owner: bool = False,
) -> bool:
    if base_id is None:
        raise Exception("No base_id provided")
    base = await VariantBaseDB.find_one(VariantBaseDB.id == base_id, fetch_links=True)
    if base is None:
        logger.error("Base not found")
        return False
    organization_id = base.organization.id
    return await check_user_org_access(user_org_data, str(organization_id), check_owner)

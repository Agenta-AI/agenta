import os
import logging
from bson import ObjectId
from fastapi.responses import JSONResponse
from typing import Dict, List, Any, Union, Optional

from fastapi import HTTPException

from agenta_backend.models.api.api_models import (
    App,
    AppVariant,
    Environment,
    Image,
    ImageExtended,
    Template,
)
from agenta_backend.models.converters import (
    app_variant_db_to_pydantic,
    image_db_to_pydantic,
    templates_db_to_pydantic,
)
from agenta_backend.models.db_models import (
    AppDB,
    AppVariantDB,
    EnvironmentDB,
    ImageDB,
    TemplateDB,
    UserDB,
    OrganizationDB,
    BaseDB,
    ConfigDB,
)
from agenta_backend.services import helpers
from agenta_backend.utills.common import engine, check_user_org_access, get_organization
from agenta_backend.services.selectors import get_user_own_org

from odmantic import query

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


async def add_variant_based_on_image(
    app_id: str,
    variant_name: str,
    docker_id: str,
    tags: str,
    organization_id: str,
    base_name: str = None,
    config_name: str = "default",
    **kwargs: dict
) -> AppVariantDB:
    """
    Adds an app variant based on an image.
    Used both when createa an app variant from template and from CLI

    Arguments:
        app_id {str} -- [description]
        variant_name {str} -- [description]
        docker_id {str} -- [description]
        tags {str} -- [description]
        organization_id {str} -- [description]
    Raises:
        ValueError: if variant exists or missing inputs
    """
    try:
        logger.debug("Creating app variant based on image")
        await clean_soft_deleted_variants()
        if (
            app_id in [None, ""]
            or variant_name in [None, ""]
            or organization_id in [None, ""]
            or docker_id in [None, ""]
            or tags in [None, ""]
            or organization_id in [None, ""]
        ):
            raise ValueError("App variant or image is None")

        soft_deleted_variants = await list_app_variants(
            show_soft_deleted=True, **kwargs
        )
        already_exists = any(
            [
                av
                for av in soft_deleted_variants
                if av.app_id == app_id
                and av.variant_name == variant_name
            ]
        )
        if already_exists:
            raise ValueError("App variant with the same name already exists")

        user_instance = await get_user_object(kwargs["uid"])
        db_image = await get_orga_image_instance(
            organization_id=organization_id,
            docker_id=docker_id
        )
        if db_image is None:
            db_image = ImageDB(
                docker_id=docker_id,
                tags=tags,
                user_id=user_instance,
                organization_id=organization_id,
            )
            await engine.save(db_image)

        db_config = ConfigDB(config_name=config_name,  # the first variant always has default config
                             parameters={})
        await engine.save(db_config)

        if not base_name:
            base_name = variant_name.split(".")[0]  # TODO: Change this in SDK2 to directly use base_name
        db_base = BaseDB(base_name=base_name,  # the first variant always has default base
                         image_id=db_image)
        await engine.save(db_base)

        db_app_variant = AppVariantDB(
            app_id=app_id,
            variant_name=variant_name,
            image_id=db_image,
            user_id=user_instance,
            organization_id=organization_id,
            parameters={},
            base_name=base_name,
            config_name=config_name,
            base_id=db_base,
            config_id=db_config
        )
        await engine.save(db_app_variant)
        logger.debug("Created db_app_variant: %s", db_app_variant)
        return db_app_variant
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def fetch_app_by_name_and_organization(app_name: str, organization_id: str, **kwargs) -> Optional[AppDB]:
    """
    Fetches an app by its name and organization ID.

    Args:
        app_name (str): The name of the app to fetch.
        organization_id (str): The ID of the organization that the app belongs to.

    Returns:
        AppDB: AppDB, or None if no app was found.
    """
    query_expression = (
        (AppDB.app_name == app_name)
        & (AppDB.organization_id == ObjectId(organization_id))
    )
    app = await engine.find_one(AppDB, query_expression)
    return app


async def create_app(app_name: str, organization_id: str, **kwargs) -> AppDB:
    """
    Create a new app with the given name and organization ID.

    Args:
        app_name (str): The name of the app to create.
        organization_id (str): The ID of the organization that the app belongs to.
        **kwargs: Additional keyword arguments.

    Returns:
        AppDB: The created app.

    Raises:
        ValueError: If an app with the same name already exists.
    """
    user_instance = await get_user_object(kwargs["uid"])
    app = await fetch_app_by_name_and_organization(app_name, organization_id, **kwargs)
    if app is not None:
        raise ValueError("App with the same name already exists")
    organization_db = await get_organization_object(organization_id)
    app = AppDB(app_name=app_name, organization_id=organization_db, user_id=user_instance)
    await engine.save(app)
    return app


async def get_organization_object(organization_id: str) -> OrganizationDB:
    """
    Fetches an organization by its ID.

    Args:
        organization_id (str): The ID of the organization to fetch.

    Returns:
        OrganizationDB: The fetched organization.
    """
    organization = await engine.find_one(
        OrganizationDB, OrganizationDB.id == ObjectId(organization_id)
    )
    return organization


async def list_app_variants(
    app_id: str = None, show_soft_deleted=False, **kwargs: dict
) -> List[AppVariant]:
    """
    Lists all the app variants from the db
    Args:
        app_name: if specified, only returns the variants for the app name
        show_soft_deleted: if true, returns soft deleted variants as well
    Returns:
        List[AppVariant]: List of AppVariant objects
    """

    # Get user object
    user = await get_user_object(kwargs["uid"])

    # Construct query expressions
    query_filters = None

    if app_id is not None:
        app_variant = await engine.find_one(
            AppVariantDB, AppVariantDB.app_id == ObjectId(app_id)
        )
        obj_query = query.eq(AppVariantDB.organization_id, app_variant.organization_id)
    else:
        obj_query = query.eq(AppVariantDB.user_id, user.id)

    if not show_soft_deleted:
        query_filters = query.eq(AppVariantDB.is_deleted, False) & obj_query

    if show_soft_deleted:
        query_filters = query.eq(AppVariantDB.is_deleted, True) & obj_query

    if app_id is not None:
        query_filters = (AppVariantDB.app_id == ObjectId(app_id)) & obj_query

    if not show_soft_deleted and app_name is not None:
        query_filters = (
            query.eq(AppVariantDB.is_deleted, False)
            & query.eq(AppVariantDB.app_name, app_name)
            & obj_query
        )

    app_variants_db: List[AppVariantDB] = await engine.find(
        AppVariantDB,
        query_filters,
        sort=(AppVariantDB.app_name, AppVariantDB.variant_name),
    )

    # Include previous variant name
    app_variants: List[AppVariant] = [
        app_variant_db_to_pydantic(av) for av in app_variants_db
    ]
    return app_variants

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
    app_db_to_pydantic,
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
import logging

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


async def add_variant_based_on_image(
    app_id: AppDB,
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

        soft_deleted_variants = await list_app_variants_for_app_id(app_id=str(app_id.id),
                                                                   show_soft_deleted=True, **kwargs
                                                                   )
        already_exists = any(
            [
                av
                for av in soft_deleted_variants
                if av.variant_name == variant_name
            ]
        )
        if already_exists:
            raise ValueError("App variant with the same name already exists")

        user_instance = await get_user_object(kwargs["uid"])
        db_image = await get_orga_image_instance(
            organization_id=organization_id,
            docker_id=docker_id
        )
        organization_db = await get_organization_object(organization_id)
        if db_image is None:
            logger.debug("Creating new image")
            db_image = ImageDB(
                docker_id=docker_id,
                tags=tags,
                user_id=user_instance,
                organization_id=organization_db,
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
            organization_id=organization_db,
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


async def fetch_app_variant_by_id(app_variant_id: str) -> Optional[AppVariantDB]:
    """
    Fetches an app variant by its ID.

    Args:
        app_variant_id (str): The ID of the app variant to fetch.

    Returns:
        AppVariantDB: The fetched app variant, or None if no app variant was found.
    """
    assert app_variant_id is not None, "app_variant_id cannot be None"
    app_variant = await engine.find_one(
        AppVariantDB, AppVariantDB.id == ObjectId(app_variant_id)
    )
    return app_variant


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


async def list_app_variants_for_app_id(
    app_id: str, show_soft_deleted=False, **kwargs: dict
) -> List[AppVariantDB]:
    """
    Lists all the app variants from the db
    Args:
        app_name: if specified, only returns the variants for the app name
        show_soft_deleted: if true, returns soft deleted variants as well
    Returns:
        List[AppVariant]: List of AppVariant objects
    """
    assert app_id is not None, "app_id cannot be None"
    if not show_soft_deleted:
        query_expression = (
            (AppVariantDB.app_id == ObjectId(app_id))
            & (AppVariantDB.is_deleted == False)
        )
    else:
        query_expression = (AppVariantDB.app_id == ObjectId(app_id))
    app_variants_db: List[AppVariantDB] = await engine.find(
        AppVariantDB,
        query_expression,
        sort=(AppVariantDB.variant_name),
    )

    return app_variants_db


async def get_user_object(user_uid: str) -> UserDB:
    """Get the user object from the database.

    Arguments:
        user_id (str): The user unique identifier

    Returns:
        UserDB: instance of user
    """

    user = await engine.find_one(UserDB, UserDB.uid == user_uid)
    if user is None:
        if os.environ["FEATURE_FLAG"] not in ["cloud", "ee", "demo"]:
            create_user = UserDB(uid="0")
            await engine.save(create_user)

            org = OrganizationDB(type="default", owner=str(create_user.id))
            await engine.save(org)

            create_user.organizations.append(org.id)
            await engine.save(create_user)
            await engine.save(org)

            return create_user
        else:
            raise Exception("Please login or signup")
    else:
        return user


async def clean_soft_deleted_variants():
    """Remove soft-deleted app variants if their image is not used by any existing variant."""

    # Get all soft-deleted app variants
    soft_deleted_variants: List[AppVariantDB] = await engine.find(
        AppVariantDB, AppVariantDB.is_deleted == True
    )

    for variant in soft_deleted_variants:
        # Build the query expression for the two conditions
        query_expression = query.eq(
            AppVariantDB.image_id, variant.image_id.id
        ) & query.eq(AppVariantDB.is_deleted, False)

        # Get non-deleted variants that use the same image
        image_used = await engine.find_one(AppVariantDB, query_expression)

        # If the image is not used by any non-deleted variant, delete the variant
        if image_used is None:
            await engine.delete(variant)


async def get_orga_image_instance(organization_id: str, docker_id: str) -> ImageDB:
    """Get the image object from the database with the provided id.

    Arguments:
        organization_id (str): Ther orga unique identifier
        docker_id (str): The image id

    Returns:
        ImageDB: instance of image object
    """

    query_expression = (ImageDB.organization_id == ObjectId(organization_id)) & query.eq(
        ImageDB.docker_id, docker_id
    )
    image = await engine.find_one(ImageDB, query_expression)
    return image


async def get_app_instance_by_id(app_id: str) -> AppDB:
    """Get the app object from the database with the provided id.

    Arguments:
        app_id (str): The app unique identifier

    Returns:
        AppDB: instance of app object
    """

    app = await engine.find_one(AppDB, AppDB.id == ObjectId(app_id))
    return app


async def add_variant_based_on_previous(
    previous_app_variant: AppVariantDB,
    new_variant_name: str,
    parameters: Dict[str, Any],
    new_config_name: str = None,
    **kwargs: dict,
):
    """Adds a new variant from a previous/template one by changing the parameters.

    Arguments:
        app_variant -- contains the name of the app and variant

    Keyword Arguments:
        parameters -- the new parameters.

    Raises:
        ValueError: _description_
    """

    await clean_soft_deleted_variants()
    if (
        previous_app_variant is None
        or previous_app_variant.app_id in [None, ""]
        or previous_app_variant.variant_name in [None, ""]
    ):
        raise ValueError("App variant is None")
    elif previous_app_variant.organization_id in [None, ""]:
        raise ValueError("App organization_id is None")
    if parameters is None:
        raise ValueError("Parameters is None")

    elif previous_app_variant.previous_variant_name is not None:
        raise ValueError(
            "Template app variant is not a template, it is a forked variant itself"
        )

    soft_deleted_app_variants = await list_app_variants_for_app_id(app_id=str(previous_app_variant.app_id.id),
                                                                   show_soft_deleted=True, **kwargs
                                                                   )

    logger.debug("soft_deleted_app_variants: %s", soft_deleted_app_variants)
    already_exists = any(
        [
            av
            for av in soft_deleted_app_variants
            if av.variant_name == new_variant_name
        ]
    )
    if already_exists:
        raise ValueError("App variant with the same name already exists")

    user_instance = await get_user_object(kwargs["uid"])
    if new_config_name is None:
        new_config_name = new_variant_name.split(".")[1]
    config_instance = ConfigDB(config_name=new_config_name, parameters=parameters)
    db_app_variant = AppVariantDB(
        app_id=previous_app_variant.app_id,
        variant_name=new_variant_name,
        image_id=previous_app_variant.image_id,
        user_id=user_instance,
        organization_id=previous_app_variant.organization_id,
        parameters=parameters,
        previous_variant_name=previous_app_variant.variant_name,
        base_name=previous_app_variant.base_name,
        base_id=previous_app_variant.base_id,
        config_name=new_config_name,
        config_id=config_instance,
        is_deleted=False)
    await engine.save(db_app_variant)
    return db_app_variant


async def list_apps(org_id: str = None, **kwargs: dict) -> List[App]:
    """
    Lists all the unique app names and their IDs from the database

    Errors:
        JSONResponse: You do not have permission to access this organization; status_code: 403

    Returns:
        List[App]
    """
    await clean_soft_deleted_variants()

    # Get user object
    user = await get_user_object(kwargs["uid"])
    assert user is not None, "User is None"

    if org_id is not None:
        organization_access = await check_user_org_access(kwargs, org_id)
        if organization_access:
            apps: List[AppDB] = await engine.find(AppDB, AppDB.organization_id == ObjectId(org_id))
            return [app_db_to_pydantic(app) for app in apps]

        else:
            return JSONResponse(
                {"error": "You do not have permission to access this organization"},
                status_code=403,
            )

    else:
        apps: List[AppVariantDB] = await engine.find(AppDB, AppDB.user_id == user.id)
        return [app_db_to_pydantic(app) for app in apps]


async def list_app_variants(
    app_id: str = None, show_soft_deleted=False, **kwargs: dict
) -> List[AppVariantDB]:
    """
    Lists all the app variants from the db
    Args:
        app_name: if specified, only returns the variants for the app name
        show_soft_deleted: if true, returns soft deleted variants as well
    Returns:
        List[AppVariant]: List of AppVariant objects
    """

    # Construct query expressions
    logger.debug("app_id: %s", app_id)
    query_filters = query.QueryExpression()
    if app_id is not None:
        query_filters = query_filters & (AppVariantDB.app_id == ObjectId(app_id))
    if not show_soft_deleted:
        query_filters = query_filters & query.eq(AppVariantDB.is_deleted, False)
    logger.debug("query_filters: %s", query_filters)
    app_variants_db: List[AppVariantDB] = await engine.find(
        AppVariantDB,
        query_filters
    )

    # Include previous variant name
    return app_variants_db

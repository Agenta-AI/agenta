import os
from typing import Dict, List, Optional, Any

from agenta_backend.models.api.api_models import (
    App,
    AppVariant,
    Image,
    Template,
)
from agenta_backend.models.converters import (
    app_variant_db_to_pydantic,
    image_db_to_pydantic,
    templates_db_to_pydantic,
)
from agenta_backend.models.db_models import (
    AppVariantDB,
    ImageDB,
    TemplateDB,
    UserDB,
    OrganizationDB,
)
from agenta_backend.services import helpers

from odmantic import AIOEngine, query
from motor.motor_asyncio import AsyncIOMotorClient

import logging

# SQLite database connection
DATABASE_URL = os.environ["MONGODB_URI"]

client = AsyncIOMotorClient(DATABASE_URL)
engine = AIOEngine(client=client, database="agenta")

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


async def get_templates() -> List[Template]:
    templates = await engine.find(TemplateDB)
    return templates_db_to_pydantic(templates)


async def add_template(**kwargs: dict):
    existing_template = await engine.find_one(
        TemplateDB, TemplateDB.template_id == kwargs["template_id"]
    )
    if existing_template is None:
        db_template = TemplateDB(**kwargs)
        await engine.save(db_template)


async def add_variant_based_on_image(
    app_variant: AppVariant, image: Image, **kwargs: dict
):
    """Adds an app variant based on an image. This the functionality called by the cli.
    Currently we are not using the parameters field, but it is there for future use.

    Arguments:
        app_variant -- contains the app name and variant name and optionally the parameters
        image -- contains the docker id and the tags

    Raises:
        ValueError: if variant exists or missing inputs
    """

    await clean_soft_deleted_variants()
    if (
        app_variant is None
        or image is None
        or app_variant.app_name in [None, ""]
        or app_variant.variant_name in [None, ""]
        or image.docker_id in [None, ""]
        or image.tags in [None, ""]
    ):
        raise ValueError("App variant or image is None")
    if app_variant.parameters is not None:
        raise ValueError(
            "Parameters are not supported when adding based on image"
        )

    soft_deleted_variants = await list_app_variants(
        show_soft_deleted=True, **kwargs
    )
    already_exists = any(
        [
            av
            for av in soft_deleted_variants
            if av.app_name == app_variant.app_name
            and av.variant_name == app_variant.variant_name
        ]
    )
    if already_exists:
        raise ValueError("App variant with the same name already exists")

    # Get user instance
    user_instance = await get_user_object(kwargs["uid"])
    user_db_image = await get_user_image_instance(
        user_instance.uid, image.docker_id
    )

    # Add image
    if user_db_image is None:
        db_image = ImageDB(
            docker_id=image.docker_id,
            tags=image.tags,
            user_id=user_instance,
        )
        await engine.save(db_image)

    user_db_image = db_image

    # Add app variant and link it to the app variant
    parameters = (
        {} if app_variant.parameters is None else app_variant.parameters
    )

    db_app_variant = AppVariantDB(
        image_id=user_db_image,
        app_name=app_variant.app_name,
        variant_name=app_variant.variant_name,
        user_id=user_instance,
        parameters=parameters,
        previous_variant_name=app_variant.previous_variant_name,
    )
    await engine.save(db_app_variant)


async def add_variant_based_on_previous(
    previous_app_variant: AppVariant,
    new_variant_name: str,
    parameters: Dict[str, Any],
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
        or previous_app_variant.app_name in [None, ""]
        or previous_app_variant.variant_name in [None, ""]
    ):
        raise ValueError("App variant is None")
    if parameters is None:
        raise ValueError("Parameters is None")

    # Build the query expression for the two conditions
    query_expression = query.eq(
        AppVariantDB.app_name, previous_app_variant.app_name
    ) & query.eq(AppVariantDB.variant_name, previous_app_variant.variant_name)

    # get the template variant to base the new one on
    template_variant: AppVariantDB = await engine.find_one(
        AppVariantDB, query_expression
    )

    if template_variant is None:
        await print_all()
        raise ValueError("Template app variant not found")
    elif template_variant.previous_variant_name is not None:
        raise ValueError(
            "Template app variant is not a template, it is a forked variant itself"
        )

    soft_deleted_app_variants = await list_app_variants(
        show_soft_deleted=True, **kwargs
    )
    already_exists = any(
        [
            av
            for av in soft_deleted_app_variants
            if av.app_name == previous_app_variant.app_name
            and av.variant_name == new_variant_name
        ]
    )
    if already_exists:
        raise ValueError("App variant with the same name already exists")

    user_instance = await get_user_object(kwargs["uid"])
    db_app_variant = AppVariantDB(
        app_name=template_variant.app_name,
        variant_name=new_variant_name,
        image_id=template_variant.image_id,
        parameters=parameters,
        previous_variant_name=template_variant.variant_name,
        user_id=user_instance,
    )
    await engine.save(db_app_variant)


async def list_app_variants(
    app_name: str = None, show_soft_deleted=False, **kwargs: dict
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
    users_query = query.eq(AppVariantDB.user_id, user.id)
    if not show_soft_deleted:
        query_filters = query.eq(AppVariantDB.is_deleted, False) & users_query

    if show_soft_deleted:
        query_filters = query.eq(AppVariantDB.is_deleted, True) & users_query

    if app_name is not None:
        query_filters = query.eq(AppVariantDB.app_name, app_name) & users_query

    if not show_soft_deleted and app_name is not None:
        query_filters = (
            query.eq(AppVariantDB.is_deleted, False)
            & query.eq(AppVariantDB.app_name, app_name)
            & users_query
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


async def list_apps(**kwargs) -> List[App]:
    """
    Lists all the unique app names from the database
    """
    await clean_soft_deleted_variants()

    # Get user object
    user = await get_user_object(kwargs["uid"])
    if user is None:
        return []

    query_expression = query.eq(AppVariantDB.user_id, user.id)
    apps: List[AppVariantDB] = await engine.find(
        AppVariantDB, query_expression
    )
    apps_names = [app.app_name for app in apps]
    sorted_names = sorted(set(apps_names))
    return [App(app_name=app_name) for app_name in sorted_names]


async def get_image(app_variant: AppVariant, **kwargs: dict) -> Image:
    """Returns the image associated with the app variant

    Arguments:
        app_variant -- AppVariant to fetch the image for

    Returns:
        Image -- The Image associated with the app variant
    """

    # Get user object
    user = await get_user_object(kwargs["uid"])

    # Build the query expression for the two conditions
    query_expression = (
        query.eq(AppVariantDB.app_name, app_variant.app_name)
        & query.eq(AppVariantDB.variant_name, app_variant.variant_name)
        & query.eq(AppVariantDB.user_id, user.id)
    )

    db_app_variant: AppVariantDB = await engine.find_one(
        AppVariantDB, query_expression
    )
    if db_app_variant:
        image_db: ImageDB = await engine.find_one(
            ImageDB, ImageDB.id == db_app_variant.image_id.id
        )
        return image_db_to_pydantic(image_db)
    else:
        raise Exception("App variant not found")


async def remove_app_variant(app_variant: AppVariant, **kwargs: dict):
    """Remove an app variant from the db
    the logic for removing the image is in app_manager.py

    Arguments:
        app_variant -- AppVariant to remove
    """

    # Get user object
    user = await get_user_object(kwargs["uid"])

    if (
        app_variant is None
        or app_variant.app_name in [None, ""]
        or app_variant.variant_name in [None, ""]
    ):
        raise ValueError("App variant is None")

    # Build the query expression for the two conditions
    query_expression = (
        query.eq(AppVariantDB.app_name, app_variant.app_name)
        & query.eq(AppVariantDB.variant_name, app_variant.variant_name)
        & query.eq(AppVariantDB.user_id, user.id)
    )

    # Get app variant
    app_variant_db = await engine.find_one(AppVariantDB, query_expression)
    is_last_variant = await check_is_last_variant(app_variant_db)
    if app_variant_db is None:
        raise ValueError("App variant not found")

    if app_variant_db.previous_variant_name is not None:  # forked variant
        print("SNUCBUEI")
        await engine.delete(app_variant_db)

    elif is_last_variant:  # last variant using the image, okay to delete
        print("SNIEYNCE")
        await engine.delete(app_variant_db)

    else:
        print("><<ODMOMDOD")
        app_variant_db.is_deleted = True  # soft deletion
        await engine.save(app_variant_db)


async def remove_image(image: Image, **kwargs: dict):
    """Remove image from db based on pydantic class

    Arguments:
        image -- Image to remove
    """
    if (
        image is None
        or image.docker_id in [None, ""]
        or image.tags in [None, ""]
    ):
        raise ValueError("Image is None")

    # Get user object
    user = await get_user_object(kwargs["uid"])

    # Build the query expression for the two conditions
    query_expression = (
        query.eq(ImageDB.tags, image.tags)
        & query.eq(ImageDB.tags, image.tags)
        & query.eq(ImageDB.user_id, user.id)
    )
    image_db = await engine.find_one(ImageDB, query_expression)
    if image_db is None:
        raise ValueError("Image not found")

    await engine.delete(image_db)


async def check_is_last_variant(db_app_variant: AppVariantDB) -> bool:
    """Checks whether the input variant is the sole variant that uses its linked image
    This is a helpful function to determine whether to delete the image when removing a variant
    Usually many variants will use the same image (these variants would have been created using the UI)
    We only delete the image and shutdown the container if the variant is the last one using the image

    Arguments:
        app_variant -- AppVariant to check
    Returns:
        true if it's the last variant, false otherwise
    """

    # If it's the only variant left that uses the image, delete the image
    count_variants = await engine.count(
        AppVariantDB, AppVariantDB.image_id == db_app_variant.image_id.id
    )
    if count_variants == 1:
        return True
    return False


async def get_variant_from_db(
    app_variant: AppVariant, **kwargs: dict
) -> AppVariantDB:
    """Checks whether the app variant exists in our db
    and returns the AppVariantDB object if it does

    Arguments:
        app_variant -- AppVariant to check

    Returns:
        AppVariantDB -- The AppVariantDB object if it exists, None otherwise
    """

    # Get user object
    user = await get_user_object(kwargs["uid"])

    # Build the query expression for the two conditions
    query_expression = (
        query.eq(AppVariantDB.app_name, app_variant.app_name)
        & query.eq(AppVariantDB.variant_name, app_variant.variant_name)
        & query.eq(AppVariantDB.user_id, user.id)
    )

    # Find app_variant in the database
    db_app_variant: AppVariantDB = await engine.find_one(
        AppVariantDB, query_expression
    )
    logger.info(f"Found app variant: {db_app_variant}")
    if db_app_variant:
        return db_app_variant
    return None


async def print_all():
    """Prints all the tables in the database"""

    variants = await engine.find(AppVariantDB)
    images = await engine.find(ImageDB)
    for app_variant in variants:
        helpers.print_app_variant(app_variant)
    for image in images:
        helpers.print_image(image)


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


async def update_variant_parameters(
    app_variant: AppVariant, parameters: Dict[str, Any], **kwargs: dict
):
    """Updates the parameters of a specific variant

    Arguments:
        app_variant -- contains the name of the app and variant
        parameters -- the new parameters.

    Raises:
        ValueError: If the variant doesn't exist or parameters is None.
    """
    if (
        app_variant is None
        or app_variant.app_name in [None, ""]
        or app_variant.variant_name in [None, ""]
    ):
        raise ValueError("App variant is None")
    if parameters is None:
        raise ValueError("Parameters is None")

    # Get user object
    user = await get_user_object(kwargs["uid"])

    # Build the query expression for the two conditions
    query_expression = (
        query.eq(AppVariantDB.app_name, app_variant.app_name)
        & query.eq(AppVariantDB.variant_name, app_variant.variant_name)
        & query.eq(AppVariantDB.user_id, user.id)
    )

    db_app_variant: AppVariantDB = await engine.find_one(
        AppVariantDB, query_expression
    )

    if db_app_variant is None:
        raise ValueError("App variant not found")

    if (
        db_app_variant.parameters == {}
        or db_app_variant.parameters is not None
        and set(db_app_variant.parameters.keys()) == set(parameters.keys())
    ):
        db_app_variant.parameters = parameters
        await engine.save(db_app_variant)

    elif db_app_variant.parameters is not None and set(
        db_app_variant.parameters.keys()
    ) != set(parameters.keys()):
        logger.error(
            f"Parameters keys don't match: {db_app_variant.parameters.keys()} vs {parameters.keys()}"
        )
        raise ValueError("Parameters keys don't match")


async def remove_old_template_from_db(template_ids: list) -> None:
    """Deletes old templates that are no longer in docker hub.

    Arguments:
        template_ids -- list of template IDs you want to keep
    """

    templates_to_delete = []
    templates = await engine.find(TemplateDB)
    for temp in templates:
        if temp.template_id not in template_ids:
            templates_to_delete.append(temp)

    for template in templates_to_delete:
        await engine.delete(template)


async def get_user_object(user_id: str) -> UserDB:
    """Get the user object from the database.

    Arguments:
        user_id (str): The user unique identifier

    Returns:
        UserDB: instance of user
    """

    user = await engine.find_one(UserDB, UserDB.uid == user_id)
    if user is None:
        org = OrganizationDB()
        return UserDB(uid="0", organization_id=org)
    return user


async def get_user_organization(user_id: str) -> OrganizationDB:
    """Get the user organization object from the database.

    Arguments:
        user_id (str): The user unique identifier

    Returns:
        OrganizationDB: instance of user organization
    """

    user = await get_user_object(user_id)
    organization = await engine.find_one(
        OrganizationDB, OrganizationDB.id == user.organization_id
    )
    return organization


async def get_user_image_instance(user_id: str, docker_id: str) -> ImageDB:
    """Get the image object from the database with the provided id.

    Arguments:
        user_id (str): Ther user unique identifier
        docker_id (str): The image id

    Returns:
        ImageDB: instance of image object
    """

    query_expression = query.eq(ImageDB.user_id, user_id) & query.eq(
        ImageDB.docker_id, docker_id
    )
    image = await engine.find_one(ImageDB, query_expression)
    return image

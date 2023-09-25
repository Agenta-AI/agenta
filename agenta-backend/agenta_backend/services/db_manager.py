import os
import logging
from bson import ObjectId
from fastapi.responses import JSONResponse
from typing import Dict, List, Any, Union

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
    AppVariantDB,
    EnvironmentDB,
    ImageDB,
    TemplateDB,
    UserDB,
    OrganizationDB,
)
from agenta_backend.services import helpers
from agenta_backend.utills.common import engine, check_user_org_access, get_organization
from agenta_backend.services.selectors import get_user_own_org

from odmantic import query

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
    try:
        await clean_soft_deleted_variants()
        if (
            app_variant is None
            or image is None
            or app_variant.app_name in [None, ""]
            or app_variant.variant_name in [None, ""]
            or app_variant.organization_id in [None, ""]
            or image.docker_id in [None, ""]
            or image.tags in [None, ""]
            or image.organization_id in [None, ""]
        ):
            raise ValueError("App variant or image is None")
        if app_variant.parameters is not None:
            raise ValueError("Parameters are not supported when adding based on image")

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
                organization_id=app_variant.organization_id,
            )
            await engine.save(db_image)

        user_db_image = db_image

        # Add app variant and link it to the app variant
        parameters = {} if app_variant.parameters is None else app_variant.parameters

        db_app_variant = AppVariantDB(
            image_id=user_db_image,
            app_name=app_variant.app_name,
            variant_name=app_variant.variant_name,
            user_id=user_instance,
            parameters=parameters,
            previous_variant_name=app_variant.previous_variant_name,
            organization_id=app_variant.organization_id,
        )
        await engine.save(db_app_variant)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
    elif previous_app_variant.organization_id in [None, ""]:
        raise ValueError("App organization_id is None")
    if parameters is None:
        raise ValueError("Parameters is None")

    # Build the query expression for the three conditions
    query_expression = (
        query.eq(AppVariantDB.app_name, previous_app_variant.app_name)
        & query.eq(AppVariantDB.variant_name, previous_app_variant.variant_name)
        & query.eq(AppVariantDB.organization_id, previous_app_variant.organization_id)
    )

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
    if previous_app_variant.organization_id is None:
        organization = await get_user_own_org(kwargs["uid"])
    else:
        organization = await get_organization(previous_app_variant.organization_id)

    db_app_variant = AppVariantDB(
        app_name=template_variant.app_name,
        variant_name=new_variant_name,
        image_id=template_variant.image_id,
        parameters=parameters,
        previous_variant_name=template_variant.variant_name,
        user_id=user_instance,
        organization_id=str(template_variant.organization_id),
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

    if app_name is not None:
        app_variant = await engine.find_one(
            AppVariantDB, AppVariantDB.app_name == app_name
        )
        obj_query = query.eq(AppVariantDB.organization_id, app_variant.organization_id)
    else:
        obj_query = query.eq(AppVariantDB.user_id, user.id)

    if not show_soft_deleted:
        query_filters = query.eq(AppVariantDB.is_deleted, False) & obj_query

    if show_soft_deleted:
        query_filters = query.eq(AppVariantDB.is_deleted, True) & obj_query

    if app_name is not None:
        query_filters = query.eq(AppVariantDB.app_name, app_name) & obj_query

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


async def get_app_variant_by_app_name_and_variant_name(
    app_name: str, variant_name: str, show_soft_deleted: bool = False, **kwargs: dict
) -> AppVariant:
    """Fetches an app variant based on app_name and variant_name.

    Args:
        app_name (str): Name of the app.
        variant_name (str): Name of the variant.
        show_soft_deleted: if true, returns soft deleted variants as well
        **kwargs (dict): Additional keyword arguments.

    Returns:
        AppVariant: The fetched app variant.
    """

    # Get the user object using the user ID
    user = await get_user_object(kwargs["uid"])

    app_instance = await engine.find_one(
        AppVariantDB, AppVariantDB.app_name == app_name
    )

    # Construct the base query for the user
    users_query = query.eq(AppVariantDB.user_id, user.id)

    # Construct the query for soft-deleted items
    soft_delete_query = query.eq(AppVariantDB.is_deleted, show_soft_deleted)

    # Construct the final query filters
    query_filters = (
        query.eq(AppVariantDB.app_name, app_name)
        & query.eq(AppVariantDB.variant_name, variant_name)
        & users_query
        & soft_delete_query
    )

    # Perform the database query
    app_variants_db = await engine.find(
        AppVariantDB,
        query_filters,
        sort=(AppVariantDB.app_name, AppVariantDB.variant_name),
    )

    # Convert the database object to AppVariant and return it
    # Assuming that find will return a list, take the first element if it exists
    app_variant: AppVariant = (
        app_variant_db_to_pydantic(app_variants_db[0]) if app_variants_db else None
    )

    return app_variant


async def get_app_variant_by_app_name_and_environment(
    app_name: str, environment: str, **kwargs: dict
) -> AppVariant:
    # Get the user object using the user ID
    user = await get_user_object(kwargs["uid"])

    # Construct the base query for the user
    users_query = query.eq(EnvironmentDB.user_id, user.id)

    # Construct query filters for finding the environment in the database
    query_filters_for_environment = (
        query.eq(EnvironmentDB.name, environment)
        & query.eq(EnvironmentDB.app_name, app_name)
        & users_query
    )

    # Perform the database query to find the environment
    environment_db = await engine.find(
        EnvironmentDB,
        query_filters_for_environment,
        sort=(EnvironmentDB.app_name, EnvironmentDB.name),
    )

    if not environment_db:
        return None

    # Construct query filters for finding the app variant in the database
    query_filters_for_app_variant = (
        query.eq(AppVariantDB.app_name, app_name)
        & query.eq(AppVariantDB.variant_name, environment_db[0].deployed_app_variant)
        & users_query
    )

    # Perform the database query to find the app variant
    app_variants_db = await engine.find(
        AppVariantDB,
        query_filters_for_app_variant,
        sort=(AppVariantDB.app_name, AppVariantDB.variant_name),
    )

    # Convert the first matching database object to AppVariant and return it
    app_variant = (
        app_variant_db_to_pydantic(app_variants_db[0]) if app_variants_db else None
    )

    return app_variant


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
    if user is None:
        return []

    if org_id is not None:
        organization_access = await check_user_org_access(kwargs, org_id)
        if organization_access:
            query_expression = query.eq(
                AppVariantDB.organization_id, org_id
            ) & query.eq(AppVariantDB.is_deleted, False)
            apps: List[AppVariantDB] = await engine.find(AppVariantDB, query_expression)
            app_info = [App(app_name=app.app_name, app_id=app.id) for app in apps]
            sorted_info = sorted(app_info, key=lambda x: x.app_name)
            return sorted_info

        else:
            return JSONResponse(
                {"error": "You do not have permission to access this organization"},
                status_code=403,
            )

    else:
        query_expression = query.eq(AppVariantDB.user_id, user.id) & query.eq(
            AppVariantDB.is_deleted, False
        )
        apps: List[AppVariantDB] = await engine.find(AppVariantDB, query_expression)
        app_info = [App(app_name=app.app_name, app_id=app.id) for app in apps]
        sorted_info = sorted(app_info, key=lambda x: x.app_name)
        return sorted_info


async def count_apps(**kwargs: dict) -> int:
    """
    Counts all the unique app names from the database
    """
    await clean_soft_deleted_variants()

    # Get user object
    user = await get_user_object(kwargs["uid"])
    if user is None:
        return 0

    no_of_apps = await engine.count(AppVariantDB, AppVariantDB.user_id == user.id)
    return no_of_apps


async def get_image(app_variant: AppVariant, **kwargs: dict) -> ImageExtended:
    """Returns the image associated with the app variant

    Arguments:
        app_variant -- AppVariant to fetch the image for

    Returns:
        Image -- The Image associated with the app variant
    """

    # Build the query expression for the two conditions
    query_expression = (
        query.eq(AppVariantDB.app_name, app_variant.app_name)
        & query.eq(AppVariantDB.variant_name, app_variant.variant_name)
        & query.eq(AppVariantDB.organization_id, app_variant.organization_id)
    )

    db_app_variant: AppVariantDB = await engine.find_one(AppVariantDB, query_expression)
    if db_app_variant:
        image_db: ImageDB = await engine.find_one(
            ImageDB, ImageDB.id == ObjectId(db_app_variant.image_id.id)
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
        & query.eq(AppVariantDB.organization_id, app_variant.organization_id)
    )

    # Build the query expression to delete variants with is_deleted flag
    delete_var_query_expression = (
        query.eq(AppVariantDB.app_name, app_variant.app_name)
        & query.eq(AppVariantDB.organization_id, app_variant.organization_id)
        & query.eq(AppVariantDB.is_deleted, True)
    )

    # Get app variant
    app_variant_db = await engine.find_one(AppVariantDB, query_expression)

    # Get variant with is_deleted flag
    pending_variant_to_delete = await engine.find_one(
        AppVariantDB, delete_var_query_expression
    )
    is_last_variant_for_image = await check_is_last_variant_for_image(app_variant_db)
    if app_variant_db is None:
        raise ValueError("App variant not found")

    # Remove the variant from the associated environments
    environments = await list_environments_by_variant(
        app_variant.app_name,
        app_variant.variant_name,
        app_variant.organization_id,
        **kwargs,
    )
    for environment in environments:
        environment.deployed_app_variant = None
        await engine.save(environment)

    if app_variant_db.previous_variant_name is not None:  # forked variant
        await engine.delete(app_variant_db)
        if pending_variant_to_delete is not None:
            await engine.delete(pending_variant_to_delete)

    elif is_last_variant_for_image:  # last variant using the image, okay to delete
        await engine.delete(app_variant_db)
        if pending_variant_to_delete is not None:
            await engine.delete(pending_variant_to_delete)

    else:
        app_variant_db.is_deleted = True  # soft deletion
        await engine.save(app_variant_db)


async def remove_image(image: ImageExtended, **kwargs: dict):
    """Remove image from db based on pydantic class

    Arguments:
        image -- Image to remove
    """
    if image is None or image.docker_id in [None, ""] or image.tags in [None, ""]:
        raise ValueError("Image is None")

    # Get user object
    user = await get_user_object(kwargs["uid"])

    # Build the query expression for the two conditions
    query_expression = (
        query.eq(ImageDB.tags, image.tags)
        & query.eq(ImageDB.docker_id, image.docker_id)
        & query.eq(ImageDB.user_id, user.id)
        & query.eq(ImageDB.id, ObjectId(image.id))
    )
    image_db = await engine.find_one(ImageDB, query_expression)
    if image_db is None:
        raise ValueError("Image not found")

    await engine.delete(image_db)


async def check_is_last_variant_for_image(db_app_variant: AppVariantDB) -> bool:
    """Checks whether the input variant is the sole variant that uses its linked image
    This is a helpful function to determine whether to delete the image when removing a variant
    Usually many variants will use the same image (these variants would have been created using the UI)
    We only delete the image and shutdown the container if the variant is the last one using the image

    Arguments:
        app_variant -- AppVariant to check
    Returns:
        true if it's the last variant, false otherwise
    """

    # Build the query expression for the two conditions
    query_expression = (
        query.eq(AppVariantDB.user_id, db_app_variant.user_id.id)
        & query.eq(AppVariantDB.image_id, db_app_variant.image_id.id)
        & query.eq(AppVariantDB.is_deleted, False)
    )

    # Count the number of variants that match the query expression
    count_variants = await engine.count(AppVariantDB, query_expression)

    # If it's the only variant left that uses the image, delete the image
    if count_variants == 1:
        return True
    else:
        return False


async def get_variant_from_db(app_variant: AppVariant, **kwargs: dict) -> AppVariantDB:
    """Checks whether the app variant exists in our db
    and returns the AppVariantDB object if it does

    Arguments:
        app_variant -- AppVariant to check

    Returns:
        AppVariantDB -- The AppVariantDB object if it exists, None otherwise
    """

    # Build the query expression
    query_expression = (
        query.eq(AppVariantDB.app_name, app_variant.app_name)
        & query.eq(AppVariantDB.variant_name, app_variant.variant_name)
        & query.eq(AppVariantDB.organization_id, app_variant.organization_id)
    )

    # Find app_variant in the database
    db_app_variant: AppVariantDB = await engine.find_one(AppVariantDB, query_expression)
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

    # Get organization_id
    if app_variant.organization_id is not None:
        organization_id = app_variant.organization_id
    else:
        app_instance = await engine.find_one(
            AppVariantDB, AppVariantDB.app_name == app_variant.app_name
        )
        organization_id = app_instance.organization_id

    # Build the query expression for the two conditions
    query_expression = (
        query.eq(AppVariantDB.app_name, app_variant.app_name)
        & query.eq(AppVariantDB.variant_name, app_variant.variant_name)
        & query.eq(AppVariantDB.organization_id, organization_id)
    )

    db_app_variant: AppVariantDB = await engine.find_one(AppVariantDB, query_expression)

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


async def create_environment(name: str, app_name: str, organization_id, **kwargs: dict):
    """
    Creates a new environment for the given app with the given name.
    """
    user = await get_user_object(kwargs["uid"])

    environment_db = EnvironmentDB(
        name=name,
        app_name=app_name,
        user_id=user,
        organization_id=organization_id,
    )
    await engine.save(environment_db)


async def list_environments(app_name: str, **kwargs: dict) -> List[Environment]:
    """
    Lists all the environments for the given app name from the DB
    """

    app_instance = await engine.find_one(
        AppVariantDB, AppVariantDB.app_name == app_name
    )

    async def fetch_environments() -> List[EnvironmentDB]:
        query_filters = query.eq(EnvironmentDB.app_name, app_name) & query.eq(
            EnvironmentDB.organization_id, app_instance.organization_id
        )
        return await engine.find(EnvironmentDB, query_filters)

    # Fetch the environments for the given app name and organization
    environments_db: List[EnvironmentDB] = await fetch_environments()

    if environments_db:
        return environments_db

    await initialize_environments(app_name, str(app_instance.organization_id), **kwargs)
    environments_db: List[EnvironmentDB] = await fetch_environments()

    return environments_db


async def list_environments_by_variant(
    app_name: str, variant_name: str, organization_id: str, **kwargs: dict
) -> List[Environment]:
    """
    Lists all the environments for the given app name and variant from the DB
    """
    user = await get_user_object(kwargs["uid"])

    # Find the environments for the given app name and organization
    query_filters = (
        query.eq(EnvironmentDB.app_name, app_name)
        & query.eq(EnvironmentDB.organization_id, organization_id)
        & query.eq(EnvironmentDB.deployed_app_variant, variant_name)
    )
    environments_db: List[EnvironmentDB] = await engine.find(
        EnvironmentDB, query_filters
    )

    return environments_db


async def remove_environment(environment_name: str, app_name: str, **kwargs: dict):
    """
    Removes the given environment for the given app.
    """
    user = await get_user_object(kwargs["uid"])

    query_filters = (
        query.eq(EnvironmentDB.app_name, app_name)
        & query.eq(EnvironmentDB.user_id, user.id)
        & query.eq(EnvironmentDB.name, environment_name)
    )
    environment_db: EnvironmentDB = await engine.find_one(EnvironmentDB, query_filters)
    if environment_db is None:
        raise ValueError("Environment not found")

    print(
        f"Deleting environment: {environment_db.name} for app: {environment_db.app_name}"
    )
    print(environment_db)

    await engine.delete(environment_db)


async def deploy_to_environment(
    app_name: str, environment_name: str, variant_name: str, **kwargs: dict
):
    """
    Deploys a variant to a given environment.
    """
    user = await get_user_object(kwargs["uid"])

    # Check whether the app variant exists first
    app_variant = await get_app_variant_by_app_name_and_variant_name(
        app_name, variant_name, **kwargs
    )
    if app_variant is None:
        raise ValueError("App variant not found")

    # Find the environment for the given app name and user
    query_filters = (
        query.eq(EnvironmentDB.app_name, app_name)
        & query.eq(EnvironmentDB.user_id, user.id)
        & query.eq(EnvironmentDB.name, environment_name)
    )
    environment_db: EnvironmentDB = await engine.find_one(EnvironmentDB, query_filters)
    if environment_db is None:
        raise ValueError(f"Environment {environment_name} not found")
    if environment_db.deployed_app_variant == variant_name:
        raise ValueError(
            f"Variant {app_name}/{variant_name} is already deployed to the environment {environment_name}"
        )

    # Update the environment with the new variant name
    environment_db.deployed_app_variant = variant_name
    await engine.save(environment_db)


async def initialize_environments(app_name: str, organization_id: str, **kwargs: dict):
    await create_environment("development", app_name, organization_id, **kwargs)
    await create_environment("staging", app_name, organization_id, **kwargs)
    await create_environment("production", app_name, organization_id, **kwargs)


# # Is this not in use?
# # To call this function, make sure to pass the organization_id of the app
# async def does_app_exist(app_name: str, organization_id: str, **kwargs: dict) -> bool:
#     """
#     Checks if a specific app exists in the database
#     """
#     user = await get_user_object(kwargs["uid"])

#     query_expression = (
#         query.eq(AppVariantDB.organization_id, organization_id)
#         & query.eq(AppVariantDB.is_deleted, False)
#         & query.eq(AppVariantDB.app_name, app_name)
#     )

#     app: AppVariantDB = await engine.find_one(AppVariantDB, query_expression)

#     return app is not None

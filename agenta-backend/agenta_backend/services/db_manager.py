import os
import logging
from pathlib import Path
from bson import ObjectId
from datetime import datetime
from typing import Any, Dict, List, Optional

from agenta_backend.models.api.api_models import (
    App,
    AppVariant,
    ImageExtended,
    Template,
)
from agenta_backend.models.converters import (
    app_db_to_pydantic,
    image_db_to_pydantic,
    templates_db_to_pydantic,
)
from agenta_backend.services.json_importer_helper import get_json
from agenta_backend.models.db_models import (
    AppDB,
    AppVariantDB,
    VariantBaseDB,
    ConfigDB,
    ConfigVersionDB,
    AppEnvironmentDB,
    EvaluationDB,
    EvaluationScenarioDB,
    ImageDB,
    OrganizationDB,
    TemplateDB,
    TestSetDB,
    UserDB,
)

from agenta_backend.utils.common import check_user_org_access, engine

from agenta_backend.models.db_models import DeploymentDB

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from odmantic import query
from odmantic.exceptions import DocumentParsingError


# Define logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Define parent directory
PARENT_DIRECTORY = Path(os.path.dirname(__file__)).parent


async def add_testset_to_app_variant(
    app_id: str, org_id: str, template_name: str, app_name: str, **kwargs: dict
):
    """Add testset to app variant.
    Args:
        app_id (str): The id of the app
        org_id (str): The id of the organization
        template_name (str): The name of the app template image
        app_name (str): The name of the app
        **kwargs (dict): Additional keyword arguments
    """

    app_db = await get_app_instance_by_id(app_id)
    org_db = await get_organization_object(org_id)
    user_db = await get_user(user_uid=kwargs["uid"])

    if template_name == "single_prompt":
        json_path = (
            f"{PARENT_DIRECTORY}/resources/default_testsets/single_prompt_testsets.json"
        )
        csvdata = get_json(json_path)
        testset = {
            "name": f"{app_name}_testset",
            "app_name": app_name,
            "created_at": datetime.now().isoformat(),
            "csvdata": csvdata,
        }
        testset = TestSetDB(**testset, app=app_db, user=user_db, organization=org_db)
        await engine.save(testset)


async def get_image(app_variant: AppVariant, **kwargs: dict) -> ImageExtended:
    """Returns the image associated with the app variant

    Arguments:
        app_variant -- AppVariant to fetch the image for

    Returns:
        Image -- The Image associated with the app variant
    """

    # Build the query expression for the two conditions
    query_expression = (
        query.eq(AppVariantDB.app, ObjectId(app_variant.app_id))
        & query.eq(AppVariantDB.variant_name, app_variant.variant_name)
        & query.eq(AppVariantDB.organization, ObjectId(app_variant.organization))
    )

    db_app_variant: AppVariantDB = await engine.find_one(AppVariantDB, query_expression)
    if db_app_variant:
        image_db: ImageDB = await engine.find_one(
            ImageDB, ImageDB.id == ObjectId(db_app_variant.image.id)
        )
        return image_db_to_pydantic(image_db)
    else:
        raise Exception("App variant not found")


async def fetch_app_by_id(app_id: str, **kwargs: dict) -> AppDB:
    """Fetches an app by its ID.

    Args:
        app_id: _description_
    """
    assert app_id is not None, "app_id cannot be None"
    app = await engine.find_one(AppDB, AppDB.id == ObjectId(app_id))
    return app


async def fetch_app_by_name(
    app_name: str, organization_id: Optional[str] = None, **user_org_data: dict
) -> Optional[AppDB]:
    """Fetches an app by its name.

    Args:
        app_name (str): The name of the app to fetch.

    Returns:
        AppDB: the instance of the app
    """
    if not organization_id:
        user = await get_user(user_uid=user_org_data["uid"])
        query_expression = (AppDB.app_name == app_name) & (AppDB.user == user.id)
        app = await engine.find_one(AppDB, query_expression)
    else:
        query_expression = (AppDB.app_name == app_name) & (
            AppDB.organization == ObjectId(organization_id)
        )
        app = await engine.find_one(AppDB, query_expression)
    return app


async def fetch_app_variant_by_id(
    app_variant_id: str,
) -> Optional[AppVariantDB]:
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


async def fetch_base_by_id(
    base_id: str,
    user_org_data: dict,
) -> Optional[VariantBaseDB]:
    """
    Fetches a base by its ID.
    Args:
        base_id (str): The ID of the base to fetch.
    Returns:
        VariantBaseDB: The fetched base, or None if no base was found.
    """
    if base_id is None:
        raise Exception("No base_id provided")
    base = await engine.find_one(VariantBaseDB, VariantBaseDB.id == ObjectId(base_id))
    if base is None:
        logger.error("Base not found")
        return False
    organization_id = base.organization.id
    access = await check_user_org_access(
        user_org_data, str(organization_id), check_owner=False
    )
    if not access:
        logger.error("User does not have access to this base")
        return False
    return base


async def fetch_app_variant_by_name_and_appid(
    variant_name: str, app_id: str
) -> AppVariantDB:
    """Fetch an app variant by it's name and app id.

    Args:
        variant_name (str): The name of the variant
        app_id (str): The ID of the variant app

    Returns:
        AppVariantDB: the instance of the app variant
    """

    query_expression = (AppVariantDB.variant_name == variant_name) & (
        AppVariantDB.app == ObjectId(app_id)
    )
    app_variant_db = await engine.find_one(AppVariantDB, query_expression)
    return app_variant_db


async def create_new_variant_base(
    app: AppDB,
    organization: OrganizationDB,
    user: UserDB,
    base_name: str,
    image: ImageDB,
) -> VariantBaseDB:
    """Create a new base.
    Args:
        base_name (str): The name of the base.
        image (ImageDB): The image of the base.
    Returns:
        VariantBaseDB: The created base.
    """
    logger.debug(f"Creating new base: {base_name} with image: {image} for app: {app}")
    base = VariantBaseDB(
        app=app,
        organization=organization,
        user=user,
        base_name=base_name,
        image=image,
    )
    await engine.save(base)
    return base


async def create_new_config(
    config_name: str,
    parameters: Dict,
) -> ConfigDB:
    """Create a new config.
    Args:
        config_name (str): The name of the config.
        parameters (Dict): The parameters of the config.
    Returns:
        ConfigDB: The created config.
    """
    config_db = ConfigDB(
        config_name=config_name,
        parameters=parameters,
        current_version=1,
        version_history=[
            ConfigVersionDB(
                version=1, parameters=parameters, created_at=datetime.utcnow()
            )
        ],
    )
    await engine.save(config_db)
    return config_db


async def create_new_app_variant(
    app: AppDB,
    organization: OrganizationDB,
    user: UserDB,
    variant_name: str,
    image: ImageDB,
    base: VariantBaseDB,
    config: ConfigDB,
    base_name: str,
    config_name: str,
    parameters: Dict,
) -> AppVariantDB:
    """Create a new variant.
    Args:
        variant_name (str): The name of the variant.
        image (ImageDB): The image of the variant.
        base (VariantBaseDB): The base of the variant.
        config (ConfigDB): The config of the variant.
    Returns:
        AppVariantDB: The created variant.
    """
    variant = AppVariantDB(
        app=app,
        organization=organization,
        user=user,
        variant_name=variant_name,
        image=image,
        base=base,
        config=config,
        base_name=base_name,
        config_name=config_name,
        parameters=parameters,
    )
    await engine.save(variant)
    return variant


async def create_image(
    image_type: str,
    user: UserDB,
    deletable: bool,
    organization: OrganizationDB,
    template_uri: str = None,
    docker_id: str = None,
    tags: str = None,
) -> ImageDB:
    """Create a new image.
    Args:
        docker_id (str): The ID of the image.
        tags (str): The tags of the image.
        user (UserDB): The user that the image belongs to.
        deletable (bool): Whether the image can be deleted.
        organization (OrganizationDB): The organization that the image belongs to.
    Returns:
        ImageDB: The created image.
    """
    
    # Validate image type
    valid_image_types = ["image", "zip"]
    if image_type not in valid_image_types:
        raise Exception("Invalid image type")

    # Validate either docker_id or template_uri, but not both
    if (docker_id is None) == (template_uri is None):
        raise Exception("Provide either docker_id or template_uri, but not both")

    # Validate docker_id or template_uri based on image_type
    if image_type == "image" and docker_id is None:
        raise Exception("Docker id must be provided for type image")
    elif image_type == "zip" and template_uri is None:
        raise Exception("template_uri must be provided for type zip")  

    if os.environ["FEATURE_FLAG"] in ["cloud"]:
        image = ImageDB(
            type="zip",
            template_uri=template_uri,
            deletable=deletable,
            user=user,
            organization=organization,
        )
    else:
        image = ImageDB(
            type="image",
            docker_id=docker_id,
            tags=tags,
            deletable=deletable,
            user=user,
            organization=organization,
        )
    await engine.save(image)
    return image

async def create_deployment(
    app: AppVariantDB,
    organization: OrganizationDB,
    user: UserDB,
    container_name: str,
    container_id: str,
    uri: str,
    status: str,
) -> DeploymentDB:
    """Create a new deployment.
    Args:
        app (AppVariantDB): The app variant to create the deployment for.
        organization (OrganizationDB): The organization that the deployment belongs to.
        user (UserDB): The user that the deployment belongs to.
        container_name (str): The name of the container.
        container_id (str): The ID of the container.
        uri (str): The URI of the container.
        status (str): The status of the container.
    Returns:
        DeploymentDB: The created deployment.
    """
    deployment = DeploymentDB(
        app=app,
        organization=organization,
        user=user,
        container_name=container_name,
        container_id=container_id,
        uri=uri,
        status=status,
    )
    await engine.save(deployment)
    return deployment


async def create_app_and_envs(
    app_name: str, organization_id: str, **user_org_data
) -> AppDB:
    """
    Create a new app with the given name and organization ID.

    Args:
        app_name (str): The name of the app to create.
        organization_id (str): The ID of the organization that the app belongs to.
        **user_org_data: Additional keyword arguments.

    Returns:
        AppDB: The created app.

    Raises:
        ValueError: If an app with the same name already exists.
    """

    user_instance = await get_user(user_uid=user_org_data["uid"])
    app = await fetch_app_by_name(app_name, organization_id, **user_org_data)
    if app is not None:
        raise ValueError("App with the same name already exists")

    organization_db = await get_organization_object(organization_id)
    app = AppDB(
        app_name=app_name,
        organization=organization_db,
        user=user_instance,
    )
    await engine.save(app)
    await initialize_environments(app, **user_org_data)
    return app


async def create_user_organization(user_uid: str) -> OrganizationDB:
    """Create a default organization for a user.

    Args:
        user_uid (str): The uid of the user

    Returns:
        OrganizationDB: Instance of OrganizationDB
    """

    user = await engine.find_one(UserDB, UserDB.uid == user_uid)
    org_db = OrganizationDB(owner=str(user.id), type="default")
    await engine.save(org_db)
    return org_db


async def get_deployment_by_objectid(
    deployment_id: ObjectId,
) -> DeploymentDB:
    """Get the deployment object from the database with the provided id.

    Arguments:
        deployment_id (ObjectId): The deployment id

    Returns:
        DeploymentDB: instance of deployment object
    """

    deployment = await engine.find_one(DeploymentDB, DeploymentDB.id == deployment_id)
    logger.debug(f"deployment: {deployment}")
    return deployment


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


async def get_organizations_by_list_ids(organization_ids: List) -> List:
    """
    Retrieve organizations from the database by their IDs.

    Args:
        organization_ids (List): A list of organization IDs to retrieve.

    Returns:
        List: A list of dictionaries representing the retrieved organizations.
    """

    organizations_db: List[OrganizationDB] = await engine.find(
        OrganizationDB, OrganizationDB.id.in_(organization_ids)
    )

    return organizations_db


async def list_app_variants_for_app_id(
    app_id: str, **kwargs: dict
) -> List[AppVariantDB]:
    """
    Lists all the app variants from the db
    Args:
        app_name: if specified, only returns the variants for the app name
    Returns:
        List[AppVariant]: List of AppVariant objects
    """
    assert app_id is not None, "app_id cannot be None"
    query_expression = AppVariantDB.app == ObjectId(app_id)
    app_variants_db: List[AppVariantDB] = await engine.find(
        AppVariantDB,
        query_expression,
        sort=(AppVariantDB.variant_name),
    )

    return app_variants_db


async def list_bases_for_app_id(
    app_id: str, base_name: Optional[str] = None, **kwargs: dict
) -> List[VariantBaseDB]:
    assert app_id is not None, "app_id cannot be None"
    query_expression = VariantBaseDB.app == ObjectId(app_id)
    if base_name:
        query_expression = query_expression & query.eq(
            VariantBaseDB.base_name, base_name
        )
    bases_db: List[VariantBaseDB] = await engine.find(
        VariantBaseDB,
        query_expression,
        sort=(VariantBaseDB.base_name),
    )
    return bases_db


async def list_variants_for_base(
    base: VariantBaseDB, **kwargs: dict
) -> List[AppVariantDB]:
    """
    Lists all the app variants from the db for a base
    Args:
        base: if specified, only returns the variants for the base
    Returns:
        List[AppVariant]: List of AppVariant objects
    """
    assert base is not None, "base cannot be None"
    query_expression = AppVariantDB.base == ObjectId(base.id)
    app_variants_db: List[AppVariantDB] = await engine.find(
        AppVariantDB,
        query_expression,
        sort=(AppVariantDB.variant_name),
    )

    return app_variants_db


async def get_user(user_uid: str) -> UserDB:
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


async def get_user_with_id(user_id: ObjectId):
    """
    Retrieves a user from a database based on their ID.

    Args:
        user_id (ObjectId): The ID of the user to retrieve from the database.

    Returns:
        user: The user object retrieved from the database.

    Raises:
        Exception: If an error occurs while getting the user from the database.
    """
    try:
        user = await engine.find_one(UserDB, UserDB.id == user_id)
        return user
    except Exception as e:
        logger.error(f"Failed to get user with id: {e}")
        raise Exception(f"Error while getting user: {e}")


async def get_user_with_email(email: str):
    """
    Retrieves a user from the database based on their email address.

    Args:
        email (str): The email address of the user to retrieve.

    Returns:
        UserDB: The user object retrieved from the database.

    Raises:
        Exception: If a valid email address is not provided.
        Exception: If an error occurs while retrieving the user.

    Example Usage:
        user = await get_user_with_email('example@example.com')
    """
    if "@" not in email:
        raise Exception("Please provide a valid email address")

    try:
        user = await engine.find_one(UserDB, UserDB.email == email)
        return user
    except Exception as e:
        logger.error(f"Failed to get user with email address: {e}")
        raise Exception(f"Error while getting user: {e}")


async def get_users_by_ids(user_ids: List) -> List:
    """
    Retrieve users from the database by their IDs.

    Args:
        user_ids (List): A list of user IDs to retrieve.

    Returns:
        List: A list of dictionaries representing the retrieved users.
    """

    users_db: List[UserDB] = await engine.find(UserDB, UserDB.id.in_(user_ids))

    return users_db


async def get_orga_image_instance(organization_id: str, docker_id: str) -> ImageDB:
    """Get the image object from the database with the provided id.

    Arguments:
        organization_id (str): The orga unique identifier
        docker_id (str): The image id

    Returns:
        ImageDB: instance of image object
    """

    query_expression = (ImageDB.organization == ObjectId(organization_id)) & query.eq(
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


async def add_variant_from_base_and_config(
    base_db: VariantBaseDB,
    new_config_name: str,
    parameters: Dict[str, Any],
    **user_org_data: dict,
):
    """
    Add a new variant to the database based on an existing base and a new configuration.

    Args:
        base_db (VariantBaseDB): The existing base to use as a template for the new variant.
        new_config_name (str): The name of the new configuration to use for the new variant.
        parameters (Dict[str, Any]): The parameters to use for the new configuration.
        **user_org_data (dict): Additional user and organization data.

    Returns:
        AppVariantDB: The newly created app variant.
    """
    new_variant_name = f"{base_db.base_name}.{new_config_name}"
    previous_app_variant_db = await find_previous_variant_from_base_id(str(base_db.id))
    if previous_app_variant_db is None:
        logger.error("Failed to find the previous app variant in the database.")
        raise HTTPException(status_code=500, detail="Previous app variant not found")
    logger.debug(f"Located previous variant: {previous_app_variant_db}")
    app_variant_for_base = await list_variants_for_base(base_db)

    already_exists = any(
        [av for av in app_variant_for_base if av.config_name == new_config_name]
    )
    if already_exists:
        raise ValueError("App variant with the same name already exists")
    user_db = await get_user(user_uid=user_org_data["uid"])
    config_db = ConfigDB(
        config_name=new_config_name,
        parameters=parameters,
        current_version=1,
        version_history=[
            ConfigVersionDB(
                version=1, parameters=parameters, created_at=datetime.utcnow()
            )
        ],
    )
    await engine.save(config_db)
    db_app_variant = AppVariantDB(
        app=previous_app_variant_db.app,
        variant_name=new_variant_name,
        image=base_db.image,
        user=user_db,
        organization=previous_app_variant_db.organization,
        parameters=parameters,
        previous_variant_name=previous_app_variant_db.variant_name,  # TODO: Remove in future
        base_name=base_db.base_name,
        base=base_db,
        config_name=new_config_name,
        config=config_db,
        is_deleted=False,
    )
    await engine.save(db_app_variant)
    return db_app_variant


async def list_apps(
    app_name: str = None, org_id: str = None, **user_org_data: dict
) -> List[App]:
    """
    Lists all the unique app names and their IDs from the database

    Errors:
        JSONResponse: You do not have permission to access this organization; status_code: 403

    Returns:
        List[App]
    """

    user = await get_user(user_uid=user_org_data["uid"])
    assert user is not None, "User is None"

    if app_name is not None:
        app_db = await fetch_app_by_name(app_name, org_id, **user_org_data)
        return [app_db_to_pydantic(app_db)]
    elif org_id is not None:
        organization_access = await check_user_org_access(user_org_data, org_id)
        if organization_access:
            apps: List[AppDB] = await engine.find(
                AppDB, AppDB.organization == ObjectId(org_id)
            )
            return [app_db_to_pydantic(app) for app in apps]

        else:
            return JSONResponse(
                {"error": "You do not have permission to access this organization"},
                status_code=403,
            )

    else:
        apps: List[AppVariantDB] = await engine.find(AppDB, AppDB.user == user.id)
        return [app_db_to_pydantic(app) for app in apps]


async def list_app_variants(app_id: str = None, **kwargs: dict) -> List[AppVariantDB]:
    """
    Lists all the app variants from the db
    Args:
        app_name: if specified, only returns the variants for the app name
    Returns:
        List[AppVariant]: List of AppVariant objects
    """

    # Construct query expressions
    logger.debug("app_id: %s", app_id)
    query_filters = query.QueryExpression()
    if app_id is not None:
        query_filters = query_filters & (AppVariantDB.app == ObjectId(app_id))
    logger.debug("query_filters: %s", query_filters)
    app_variants_db: List[AppVariantDB] = await engine.find(AppVariantDB, query_filters)

    # Include previous variant name
    return app_variants_db


async def check_is_last_variant_for_image(
    db_app_variant: AppVariantDB,
) -> bool:
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
    logger.debug("db_app_variant: %s", db_app_variant)
    query_expression = (
        AppVariantDB.organization == ObjectId(db_app_variant.organization.id)
    ) & (AppVariantDB.base == ObjectId(db_app_variant.base.id))
    # Count the number of variants that match the query expression
    count_variants = await engine.count(AppVariantDB, query_expression)

    # If it's the only variant left that uses the image, delete the image
    return bool(count_variants == 1)


async def remove_deployment(deployment_db: DeploymentDB, **kwargs: dict):
    """Remove a deployment from the db

    Arguments:
        deployment -- Deployment to remove
    """
    logger.debug("Removing deployment")
    assert deployment_db is not None, "deployment_db is missing"

    await engine.delete(deployment_db)


async def remove_app_variant_from_db(app_variant_db: AppVariantDB, **kwargs: dict):
    """Remove an app variant from the db
    the logic for removing the image is in app_manager.py

    Arguments:
        app_variant -- AppVariant to remove
    """
    logger.debug("Removing app variant")
    assert app_variant_db is not None, "app_variant_db is missing"

    # Remove the variant from the associated environments
    logger.debug("list_environments_by_variant")
    environments = await list_environments_by_variant(
        app_variant_db,
        **kwargs,
    )
    for environment in environments:
        environment.deployed_app_variant = None
        await engine.save(environment)
    # removing the config
    config = app_variant_db.config
    await engine.delete(config)

    await engine.delete(app_variant_db)


async def deploy_to_environment(environment_name: str, variant_id: str, **kwargs: dict):
    """
    Deploys an app variant to a specified environment.

    Args:
        environment_name (str): The name of the environment to deploy the app variant to.
        variant_id (str): The ID of the app variant to deploy.
        **kwargs (dict): Additional keyword arguments.

    Raises:
        ValueError: If the app variant is not found or if the environment is not found or if the app variant is already
                    deployed to the environment.

    Returns:
        None
    """
    app_variant_db = await fetch_app_variant_by_id(variant_id)
    if app_variant_db is None:
        raise ValueError("App variant not found")

    # Find the environment for the given app name and user
    query_filters = (
        AppEnvironmentDB.app == ObjectId(app_variant_db.app.id)
    ) & query.eq(AppEnvironmentDB.name, environment_name)
    environment_db: AppEnvironmentDB = await engine.find_one(
        AppEnvironmentDB, query_filters
    )
    if environment_db is None:
        raise ValueError(f"Environment {environment_name} not found")
    if environment_db.deployed_app_variant == app_variant_db:
        raise ValueError(
            f"Variant {app_variant_db.app.app_name}/{app_variant_db.variant_name} is already deployed to the environment {environment_name}"
        )

    # Update the environment with the new variant name
    environment_db.deployed_app_variant = app_variant_db.id
    await engine.save(environment_db)


async def list_environments(app_id: str, **kwargs: dict) -> List[AppEnvironmentDB]:
    """
    List all environments for a given app ID.

    Args:
        app_id (str): The ID of the app to list environments for.
        **kwargs (dict): Additional keyword arguments.

    Returns:
        List[AppEnvironmentDB]: A list of AppEnvironmentDB objects representing the environments for the given app ID.
    """
    logging.debug("Listing environments for app %s", app_id)
    app_instance = await fetch_app_by_id(app_id=app_id)
    if app_instance is None:
        logging.error(f"App with id {app_id} not found")
        raise ValueError("App not found")

    environments_db: List[AppEnvironmentDB] = await engine.find(
        AppEnvironmentDB, AppEnvironmentDB.app == ObjectId(app_id)
    )

    return environments_db


async def initialize_environments(
    app_db: AppDB, **kwargs: dict
) -> List[AppEnvironmentDB]:
    """
    Initializes the environments for the app with the given database.

    Args:
        app_db (AppDB): The database for the app.
        **kwargs (dict): Additional keyword arguments.

    Returns:
        List[AppEnvironmentDB]: A list of the initialized environments.
    """
    environments = []
    for env_name in ["development", "staging", "production"]:
        env = await create_environment(name=env_name, app_db=app_db, **kwargs)
        environments.append(env)
    return environments


async def create_environment(
    name: str, app_db: AppDB, **kwargs: dict
) -> AppEnvironmentDB:
    """
    Creates a new environment in the database.

    Args:
        name (str): The name of the environment.
        app_db (AppDB): The AppDB object representing the app that the environment belongs to.
        **kwargs (dict): Additional keyword arguments.

    Returns:
        AppEnvironmentDB: The newly created AppEnvironmentDB object.
    """
    environment_db = AppEnvironmentDB(
        app=app_db,
        name=name,
        user=app_db.user,
        organization=app_db.organization,
    )
    await engine.save(environment_db)
    return environment_db


async def list_environments_by_variant(
    app_variant: AppVariantDB, **kwargs: dict
) -> List[AppEnvironmentDB]:
    """
    Returns a list of environments for a given app variant.

    Args:
        app_variant (AppVariantDB): The app variant to retrieve environments for.
        **kwargs (dict): Additional keyword arguments.

    Returns:
        List[AppEnvironmentDB]: A list of AppEnvironmentDB objects.
    """

    environments_db: List[AppEnvironmentDB] = await engine.find(
        AppEnvironmentDB,
        (AppEnvironmentDB.app == ObjectId(app_variant.app.id)),
    )

    return environments_db


async def remove_image(image: ImageDB, **kwargs: dict):
    """
    Removes an image from the database.

    Args:
        image (ImageDB): The image to remove from the database.
        **kwargs (dict): Additional keyword arguments.

    Raises:
        ValueError: If the image is None.

    Returns:
        None
    """
    if image is None:
        raise ValueError("Image is None")
    await engine.delete(image)


async def remove_environment(environment_db: AppEnvironmentDB, **kwargs: dict):
    """
    Removes an environment from the database.

    Args:
        environment_db (AppEnvironmentDB): The environment to remove from the database.
        **kwargs (dict): Additional keyword arguments.

    Raises:
        AssertionError: If environment_db is None.

    Returns:
        None
    """
    assert environment_db is not None, "environment_db is missing"
    await engine.delete(environment_db)


async def remove_app_testsets(app_id: str, **kwargs):
    """Returns a list of testsets owned by an app.

    Args:
        app_id (str): The name of the app

    Returns:
        int: The number of testsets deleted
    """

    # Get user object
    # Find testsets owned by the app
    deleted_count: int = 0

    # Build query expression
    testsets = await engine.find(TestSetDB, TestSetDB.app == ObjectId(app_id))

    # Perform deletion if there are testsets to delete
    if testsets is not None:
        for testset in testsets:
            await engine.delete(testset)
            deleted_count += 1
            logger.info(f"{deleted_count} testset(s) deleted for app {app_id}")
            return deleted_count

    logger.info(f"No testsets found for app {app_id}")
    return 0


async def remove_base_from_db(base: VariantBaseDB, **kwargs):
    """
    Remove a base from the database.

    Args:
        base (VariantBaseDB): The base to be removed from the database.
        **kwargs: Additional keyword arguments.

    Raises:
        ValueError: If the base is None.

    Returns:
        None
    """
    if base is None:
        raise ValueError("Base is None")
    await engine.delete(base)


async def remove_app_by_id(app_id: str, **kwargs):
    """
    Removes an app instance from the database by its ID.

    Args:
        app_id (str): The ID of the app instance to remove.

    Raises:
        AssertionError: If app_id is None or if the app instance could not be found.

    Returns:
        None
    """
    assert app_id is not None, "app_id cannot be None"
    app_instance = await fetch_app_by_id(app_id=app_id)
    assert app_instance is not None, f"app instance for {app_id} could not be found"
    await engine.delete(app_instance)


async def update_variant_parameters(
    app_variant_db: AppVariantDB, parameters: Dict[str, Any], **kwargs: dict
) -> None:
    """
    Update the parameters of an app variant in the database.

    Args:
        app_variant_db (AppVariantDB): The app variant to update.
        parameters (Dict[str, Any]): The new parameters to set for the app variant.
        **kwargs (dict): Additional keyword arguments.

    Raises:
        ValueError: If there is an issue updating the variant parameters.
    """
    assert app_variant_db is not None, "app_variant is missing"
    assert parameters is not None, "parameters is missing"

    try:
        logging.debug("Updating variant parameters")

        # Update AppVariantDB parameters
        app_variant_db.parameters = parameters

        # Update associated ConfigDB parameters and versioning
        config_db = app_variant_db.config
        new_version = config_db.current_version + 1
        config_db.version_history.append(
            ConfigVersionDB(
                version=new_version,
                parameters=config_db.parameters,
                created_at=datetime.utcnow(),
            )
        )
        config_db.current_version = new_version
        config_db.parameters = parameters
        # Save updated ConfigDB and AppVariantDB
        await engine.save(config_db)
        await engine.save(app_variant_db)

    except Exception as e:
        logging.error(f"Issue updating variant parameters: {e}")
        raise ValueError("Issue updating variant parameters")


async def get_app_variant_by_app_name_and_environment(
    app_id: str, environment: str, **kwargs: dict
) -> Optional[AppVariantDB]:
    """
    Retrieve the deployed app variant for a given app and environment.

    Args:
        app_id (str): The ID of the app to retrieve the variant for.
        environment (str): The name of the environment to retrieve the variant for.
        **kwargs (dict): Additional keyword arguments to pass to the function.

    Returns:
        Optional[AppVariantDB]: The deployed app variant for the given app and environment, or None if not found.
    """
    # Get the environment
    # Construct query filters for finding the environment in the database
    query_filters_for_environment = query.eq(AppEnvironmentDB.name, environment) & (
        AppEnvironmentDB.app == ObjectId(app_id)
    )

    # Perform the database query to find the environment
    environment_db = await engine.find_one(
        AppEnvironmentDB, query_filters_for_environment
    )

    if not environment_db:
        logger.info(f"Environment {environment} not found")
        return None
    if environment_db.deployed_app_variant is None:
        logger.info(f"No variant deployed to environment {environment}")
        return None

    app_variant_db = await get_app_variant_instance_by_id(
        str(environment_db.deployed_app_variant)
    )

    return app_variant_db


async def get_app_variant_instance_by_id(variant_id: str):
    """Get the app variant object from the database with the provided id.

    Arguments:
        variant_id (str): The app variant unique identifier

    Returns:
        AppVariantDB: instance of app variant object
    """

    app_variant_db = await engine.find_one(
        AppVariantDB, AppVariantDB.id == ObjectId(variant_id)
    )
    return app_variant_db


async def fetch_testset_by_id(testset_id: str) -> Optional[TestSetDB]:
    """Fetches a testset by its ID.
    Args:
        testset_id (str): The ID of the testset to fetch.
    Returns:
        TestSetDB: The fetched testset, or None if no testset was found.
    """
    assert testset_id is not None, "testset_id cannot be None"
    testset = await engine.find_one(TestSetDB, TestSetDB.id == ObjectId(testset_id))
    return testset


async def fetch_testsets_by_app_id(app_id: str) -> List[TestSetDB]:
    """Fetches all testsets for a given app.
    Args:
        app_id (str): The ID of the app to fetch testsets for.
    Returns:
        List[TestSetDB]: The fetched testsets.
    """
    assert app_id is not None, "app_id cannot be None"
    testsets = await engine.find(TestSetDB, TestSetDB.app == ObjectId(app_id))
    return testsets


async def fetch_evaluation_by_id(evaluation_id: str) -> Optional[EvaluationDB]:
    """Fetches a evaluation by its ID.
    Args:
        evaluation_id (str): The ID of the evaluation to fetch.
    Returns:
        EvaluationDB: The fetched evaluation, or None if no evaluation was found.
    """
    assert evaluation_id is not None, "evaluation_id cannot be None"
    evaluation = await engine.find_one(
        EvaluationDB, EvaluationDB.id == ObjectId(evaluation_id)
    )
    return evaluation


async def fetch_evaluation_scenario_by_id(
    evaluation_scenario_id: str,
) -> Optional[EvaluationScenarioDB]:
    """Fetches and evaluation scenario by its ID.
    Args:
        evaluation_scenario_id (str): The ID of the evaluation scenario to fetch.
    Returns:
        EvaluationScenarioDB: The fetched evaluation scenario, or None if no evaluation scenario was found.
    """
    assert evaluation_scenario_id is not None, "evaluation_scenario_id cannot be None"
    evaluation_scenario = await engine.find_one(
        EvaluationScenarioDB,
        EvaluationScenarioDB.id == ObjectId(evaluation_scenario_id),
    )
    return evaluation_scenario


async def find_previous_variant_from_base_id(
    base_id: str,
) -> Optional[AppVariantDB]:
    """Find the previous variant from a base id.

    Args:
        base_id (str): The base id to search for.

    Returns:
        Optional[AppVariantDB]: The previous variant, or None if no previous variant was found.
    """
    assert base_id is not None, "base_id cannot be None"
    previous_variants = await engine.find(
        AppVariantDB, AppVariantDB.base == ObjectId(base_id)
    )
    logger.debug("previous_variants: %s", previous_variants)
    if len(list(previous_variants)) == 0:
        return None
    # select the variant for which previous_variant_name is None
    for previous_variant in previous_variants:
        # if previous_variant.previous_variant_name is None:
        #     logger.debug("previous_variant: %s", previous_variant)
        return previous_variant  # we don't care which variant do we return
    assert False, "None of the previous variants has previous_variant_name=None"


async def add_template(**kwargs: dict) -> str:
    """
    Adds a new template to the database.

    Args:
        **kwargs (dict): Keyword arguments containing the template data.

    Returns:
        template_id (Str): The Id of the created template.
    """
    existing_template = await engine.find_one(
        TemplateDB, TemplateDB.tag_id == kwargs["tag_id"]
    )
    if existing_template is None:
        db_template = TemplateDB(**kwargs)
        await engine.save(db_template)
        return str(db_template.id)
    
async def add_zip_template(key, value):
    """
    Adds a new s3 zip template to the database
    
    Args:
        key: key of the json file
        value (dict): dictionary value of a key
        
    Returns:
            template_id (Str): The Id of the created template.
    """
    existing_template = await engine.find_one(
        TemplateDB, TemplateDB.name == key
    )
    if existing_template is None:
        template_name = key
        title = value.get('name')
        description = value.get('description')
        template_uri = value.get('template_uri')

        template_db_instance = TemplateDB(
            type="zip",
            name=template_name,
            title=title,
            description=description,
            template_uri=template_uri
        )
        await engine.save(template_db_instance)
        return str(template_db_instance.id)


async def get_template(template_id: str) -> TemplateDB:
    """
    Fetches a template by its ID.

    Args:
        template_id (str): The ID of the template to fetch.

    Returns:
        TemplateDB: The fetched template.
    """

    assert template_id is not None, "template_id cannot be None"
    template_db = await engine.find_one(
        TemplateDB, TemplateDB.id == ObjectId(template_id)
    )
    return template_db


async def remove_old_template_from_db(tag_ids: list) -> None:
    """Deletes old templates that are no longer in docker hub.

    Arguments:
        tag_ids -- list of template IDs you want to keep
    """

    templates_to_delete = []
    try:
        templates: List[TemplateDB] = await engine.find(TemplateDB)

        for temp in templates:
            if temp.tag_id not in tag_ids:
                templates_to_delete.append(temp)

        for template in templates_to_delete:
            await engine.delete(template)
    except DocumentParsingError as exc:
        remove_document_using_driver(str(exc.primary_value), "templates")


def remove_document_using_driver(document_id: str, collection_name: str) -> None:
    """Deletes document from using pymongo driver"""

    import pymongo

    client = pymongo.MongoClient(os.environ["MONGODB_URI"])
    db = client.get_database("agenta_v2")

    collection = db.get_collection(collection_name)
    deleted = collection.delete_one({"_id": ObjectId(document_id)})
    print(
        f"Deleted documents in {collection_name} collection. Acknowledged: {deleted.acknowledged}"
    )


async def get_templates() -> List[Template]:
    templates = await engine.find(TemplateDB)
    return templates_db_to_pydantic(templates)


async def count_apps(**user_org_data: dict) -> int:
    """
    Counts all the unique app names from the database
    """

    # Get user object
    user = await get_user(user_uid=user_org_data["uid"])
    if user is None:
        return 0

    no_of_apps = await engine.count(AppVariantDB, AppVariantDB.user == user.id)
    return no_of_apps


async def update_base(
    base: VariantBaseDB,
    **kwargs: dict,
) -> VariantBaseDB:
    """Update the base object in the database with the provided id.

    Arguments:
        base (VariantBaseDB): The base object to update.
    """
    for key, value in kwargs.items():
        if key in base.__fields__:
            setattr(base, key, value)
    await engine.save(base)
    return base


async def update_app_variant(
    app_variant: AppVariantDB,
    **kwargs: dict,
) -> AppVariantDB:
    """Update the app variant object in the database with the provided id.

    Arguments:
        app_variant (AppVariantDB): The app variant object to update.
    """
    for key, value in kwargs.items():
        if key in app_variant.__fields__:
            setattr(app_variant, key, value)
    await engine.save(app_variant)
    return app_variant


async def fetch_base_and_check_access(
    base_id: str, user_org_data: dict, check_owner=False
):
    """
    Fetches a base from the database and checks if the user has access to it.

    Args:
        base_id (str): The ID of the base to fetch.
        user_org_data (dict): The user's organization data.
        check_owner (bool, optional): Whether to check if the user is the owner of the base. Defaults to False.

    Raises:
        Exception: If no base_id is provided.
        HTTPException: If the base is not found or the user does not have access to it.

    Returns:
        VariantBaseDB: The fetched base.
    """
    if base_id is None:
        raise Exception("No base_id provided")
    base = await engine.find_one(VariantBaseDB, VariantBaseDB.id == ObjectId(base_id))
    if base is None:
        logger.error("Base not found")
        raise HTTPException(status_code=404, detail="Base not found")
    organization_id = base.organization.id
    access = await check_user_org_access(
        user_org_data, str(organization_id), check_owner
    )
    if not access:
        error_msg = f"You do not have access to this base: {base_id}"
        raise HTTPException(status_code=403, detail=error_msg)
    return base


async def fetch_app_and_check_access(
    app_id: str, user_org_data: dict, check_owner=False
):
    """
    Fetches an app from the database and checks if the user has access to it.

    Args:
        app_id (str): The ID of the app to fetch.
        user_org_data (dict): The user's organization data.
        check_owner (bool, optional): Whether to check if the user is the owner of the app. Defaults to False.

    Returns:
        dict: The fetched app.

    Raises:
        HTTPException: If the app is not found or the user does not have access to it.
    """
    app = await engine.find_one(AppDB, AppDB.id == ObjectId(app_id))
    if app is None:
        logger.error("App not found")
        raise HTTPException

    # Check user's access to the organization linked to the app.
    organization_id = app.organization.id
    access = await check_user_org_access(
        user_org_data, str(organization_id), check_owner
    )
    if not access:
        error_msg = f"You do not have access to this app: {app_id}"
        raise HTTPException(status_code=403, detail=error_msg)
    return app


async def fetch_app_variant_and_check_access(
    app_variant_id: str, user_org_data: dict, check_owner=False
):
    """
    Fetches an app variant from the database and checks if the user has access to it.

    Args:
        app_variant_id (str): The ID of the app variant to fetch.
        user_org_data (dict): The user's organization data.
        check_owner (bool, optional): Whether to check if the user is the owner of the app variant. Defaults to False.

    Returns:
        AppVariantDB: The fetched app variant.

    Raises:
        HTTPException: If the app variant is not found or the user does not have access to it.
    """
    app_variant = await engine.find_one(
        AppVariantDB, AppVariantDB.id == ObjectId(app_variant_id)
    )
    if app_variant is None:
        logger.error("App variant not found")
        raise HTTPException

    # Check user's access to the organization linked to the app.
    organization_id = app_variant.organization.id
    access = await check_user_org_access(
        user_org_data, str(organization_id), check_owner
    )
    if not access:
        error_msg = f"You do not have access to this app variant: {app_variant_id}"
        raise HTTPException(status_code=403, detail=error_msg)
    return app_variant


async def fetch_app_by_name_and_organization(
    app_name: str, organization_id: str, **user_org_data: dict
):
    """Fetch an app by it's name and organization id.

    Args:
        app_name (str): The name of the app
        organization_id (str): The ID of the app organization

    Returns:
        AppDB: the instance of the app
    """

    query_expression = (AppDB.app_name == app_name) & (
        AppDB.organization == ObjectId(organization_id)
    )
    app_db = await engine.find_one(AppDB, query_expression)
    return app_db

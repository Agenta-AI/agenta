import os
import logging
from pathlib import Path
from urllib.parse import urlparse
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from fastapi.responses import JSONResponse

from agenta_backend.models import converters
from agenta_backend.utils.common import isCloudEE
from agenta_backend.services.json_importer_helper import get_json

from agenta_backend.models.api.api_models import (
    App,
    Template,
)

if isCloudEE():
    from agenta_backend.commons.services import db_manager_ee
    from agenta_backend.commons.utils.permissions import check_rbac_permission
    from agenta_backend.commons.services.selectors import get_user_org_and_workspace_id

    from agenta_backend.commons.models.db_models import (
        Permission,
        AppDB_ as AppDB,
        UserDB_ as UserDB,
        ImageDB_ as ImageDB,
        TestSetDB_ as TestSetDB,
        AppVariantDB_ as AppVariantDB,
        EvaluationDB_ as EvaluationDB,
        DeploymentDB_ as DeploymentDB,
        VariantBaseDB_ as VariantBaseDB,
        AppEnvironmentDB_ as AppEnvironmentDB,
        AppEnvironmentRevisionDB_ as AppEnvironmentRevisionDB,
        EvaluatorConfigDB_ as EvaluatorConfigDB,
        HumanEvaluationDB_ as HumanEvaluationDB,
        EvaluationScenarioDB_ as EvaluationScenarioDB,
        HumanEvaluationScenarioDB_ as HumanEvaluationScenarioDB,
    )

else:
    from agenta_backend.models.db_models import (
        AppDB,
        UserDB,
        ImageDB,
        TestSetDB,
        AppVariantDB,
        EvaluationDB,
        DeploymentDB,
        VariantBaseDB,
        AppEnvironmentDB,
        AppEnvironmentRevisionDB,
        EvaluatorConfigDB,
        HumanEvaluationDB,
        EvaluationScenarioDB,
        HumanEvaluationScenarioDB,
    )
from agenta_backend.models.db_models import (
    ConfigDB,
    TemplateDB,
    AggregatedResult,
    AppVariantRevisionsDB,
    EvaluationScenarioResult,
    EvaluationScenarioInputDB,
    EvaluationScenarioOutputDB,
)

from beanie.operators import In
from beanie import PydanticObjectId as ObjectId

# Define logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Define parent directory
PARENT_DIRECTORY = Path(os.path.dirname(__file__)).parent


async def add_testset_to_app_variant(
    app_id: str,
    template_name: str,
    app_name: str,
    user_uid: str,
    org_id: str = None,
    workspace_id: str = None,
):
    """Add testset to app variant.
    Args:
        app_id (str): The id of the app
        org_id (str): The id of the organization
        template_name (str): The name of the app template image
        app_name (str): The name of the app
        user_uid (str): The uid of the user
    """

    try:
        app_db = await get_app_instance_by_id(app_id)
        user_db = await get_user(user_uid)

        json_path = os.path.join(
            PARENT_DIRECTORY,
            "resources",
            "default_testsets",
            f"{template_name}_testset.json",
        )

        if os.path.exists(json_path):
            csvdata = get_json(json_path)
            testset = {
                "name": f"{app_name}_testset",
                "app_name": app_name,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "csvdata": csvdata,
            }
            testset_db = TestSetDB(
                **testset,
                app=app_db,
                user=user_db,
            )

            if isCloudEE():
                # assert that if organization is provided, workspace_id is also provided, and vice versa
                assert (
                    org_id is not None and workspace_id is not None
                ), "organization and workspace must be provided together"

                organization_db = await db_manager_ee.get_organization(org_id)
                workspace_db = await db_manager_ee.get_workspace(workspace_id)

                testset_db.organization = organization_db
                testset_db.workspace = workspace_db

            await testset_db.create()

    except Exception as e:
        print(f"An error occurred in adding the default testset: {e}")


async def get_image_by_id(image_id: str) -> ImageDB:
    """Get the image object from the database with the provided id.

    Arguments:
        image_id (str): The image unique identifier

    Returns:
        ImageDB: instance of image object
    """

    image = await ImageDB.find_one(ImageDB.id == ObjectId(image_id))
    return image


async def fetch_app_by_id(app_id: str) -> AppDB:
    """Fetches an app by its ID.

    Args:
        app_id: _description_
    """
    assert app_id is not None, "app_id cannot be None"
    app = await AppDB.find_one(AppDB.id == ObjectId(app_id), fetch_links=True)
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
    app_variant = await AppVariantDB.find_one(
        AppVariantDB.id == ObjectId(app_variant_id), fetch_links=True
    )
    return app_variant


async def fetch_app_variant_by_base_id(base_id: str) -> Optional[AppVariantDB]:
    """
    Fetches an app variant by its base ID and config name.

    Args:
        base_id (str): The ID of the variant base to fetch

    Returns:
        AppVariantDB: The fetched app variant, or None if no app variant was found.
    """
    assert base_id is not None, "base_id cannot be None"
    app_variant = await AppVariantDB.find_one(
        AppVariantDB.base.id == ObjectId(base_id),
        fetch_links=True,
    )
    return app_variant


async def fetch_app_variant_by_base_id_and_config_name(
    base_id: str, config_name: str
) -> Optional[AppVariantDB]:
    """
    Fetches an app variant by its base ID and config name.

    Args:
        base_id (str): The ID of the variant base to fetch
        config_name (str): The name of the config

    Returns:
        AppVariantDB: The fetched app variant, or None if no app variant was found.
    """
    assert base_id is not None, "base_id cannot be None"
    assert config_name is not None, "config_name cannot be None"
    app_variant = await AppVariantDB.find_one(
        AppVariantDB.base.id == ObjectId(base_id),
        AppVariantDB.config_name == config_name,
        fetch_links=True,
    )
    return app_variant


async def fetch_app_variant_revision_by_variant(
    app_variant_id: str, revision: int
) -> AppVariantRevisionsDB:
    """Fetches app variant revision by variant id and revision

    Args:
        app_variant_id: str
        revision: str

    Returns:
        AppVariantRevisionDB
    """
    assert app_variant_id is not None, "app_variant_id cannot be None"
    assert revision is not None, "revision cannot be None"
    app_variant_revision = await AppVariantRevisionsDB.find_one(
        AppVariantRevisionsDB.variant.id == ObjectId(app_variant_id),
        AppVariantRevisionsDB.revision == revision,
    )

    if app_variant_revision is None:
        raise Exception(
            f"app variant revision  for app_variant {app_variant_id} and revision {revision} not found"
        )
    return app_variant_revision


async def fetch_base_by_id(base_id: str) -> Optional[VariantBaseDB]:
    """
    Fetches a base by its ID.
    Args:
        base_id (str): The ID of the base to fetch.
    Returns:
        VariantBaseDB: The fetched base, or None if no base was found.
    """
    if base_id is None:
        raise Exception("No base_id provided")
    base = await VariantBaseDB.find_one(
        VariantBaseDB.id == ObjectId(base_id), fetch_links=True
    )
    if base is None:
        logger.error("Base not found")
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

    query_expressions = (
        AppVariantDB.variant_name == variant_name,
        AppVariantDB.app.id == ObjectId(app_id),
    )
    app_variant_db = await AppVariantDB.find_one(query_expressions)
    return app_variant_db


async def create_new_variant_base(
    app: AppDB,
    user: UserDB,
    base_name: str,
    image: ImageDB,
    organization=None,
    workspace=None,
) -> VariantBaseDB:
    """Create a new base.
    Args:
        base_name (str): The name of the base.
        image (ImageDB): The image of the base.
        user (UserDB): The User Object creating the variant.
        app (AppDB): The associated App Object.
        organization (OrganizationDB): The Organization the variant belongs to.
        workspace (WorkspaceDB): The Workspace the variant belongs to.
    Returns:
        VariantBaseDB: The created base.
    """
    logger.debug(f"Creating new base: {base_name} with image: {image} for app: {app}")
    base = VariantBaseDB(
        app=app,
        user=user,
        base_name=base_name,
        image=image,
    )

    if isCloudEE():
        # assert that if organization is provided, workspace_id is also provided, and vice versa
        assert (
            organization is not None and workspace is not None
        ), "organization and workspace must be provided together"

        base.organization = organization
        base.workspace = workspace

    await base.create()
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
    )
    return config_db


async def create_new_app_variant(
    app: AppDB,
    user: UserDB,
    variant_name: str,
    image: ImageDB,
    base: VariantBaseDB,
    config: ConfigDB,
    base_name: str,
    config_name: str,
    parameters: Dict,
    organization=None,
    workspace=None,
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
    assert (
        parameters == {}
    ), "Parameters should be empty when calling create_new_app_variant (otherwise revision should not be set to 0)"
    variant = AppVariantDB(
        app=app,
        user=user,
        modified_by=user,
        revision=0,
        variant_name=variant_name,
        image=image,
        base=base,
        config=config,
        base_name=base_name,
        config_name=config_name,
        parameters=parameters,
    )

    if isCloudEE():
        # assert that if organization is provided, workspace_id is also provided, and vice versa
        assert (
            organization is not None and workspace is not None
        ), "organization and workspace must be provided together"

        variant.organization = organization
        variant.workspace = workspace

    await variant.create()

    variant_revision = AppVariantRevisionsDB(
        variant=variant,
        revision=0,
        modified_by=user,
        base=base,
        config=config,
        created_at=datetime.now(timezone.utc),
    )
    await variant_revision.create()

    return variant


async def create_image(
    image_type: str,
    user: UserDB,
    deletable: bool,
    organization=None,
    workspace=None,
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
        workspace (WorkspaceDB): The workspace that the image belongs to.
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

    image = ImageDB(
        deletable=deletable,
        user=user,
    )

    if image_type == "zip":
        image.type = "zip"
        image.template_uri = template_uri
    elif image_type == "image":
        image.type = "image"
        image.tags = tags
        image.docker_id = docker_id

    if isCloudEE():
        # assert that if organization is provided, workspace_id is also provided, and vice versa
        assert (
            organization is not None and workspace is not None
        ), "organization and workspace must be provided together"

        image.organization = organization
        image.workspace = workspace

    await image.create()
    return image


async def create_deployment(
    app: AppVariantDB,
    user: UserDB,
    container_name: str,
    container_id: str,
    uri: str,
    status: str,
    organization=None,
    workspace=None,
) -> DeploymentDB:
    """Create a new deployment.
    Args:
        app (AppVariantDB): The app variant to create the deployment for.
        organization (OrganizationDB): The organization that the deployment belongs to.
        workspace (WorkspaceDB): The Workspace that the deployment belongs to.
        user (UserDB): The user that the deployment belongs to.
        container_name (str): The name of the container.
        container_id (str): The ID of the container.
        uri (str): The URI of the container.
        status (str): The status of the container.
    Returns:
        DeploymentDB: The created deployment.
    """
    try:
        deployment = DeploymentDB(
            app=app,
            user=user,
            container_name=container_name,
            container_id=container_id,
            uri=uri,
            status=status,
        )

        if isCloudEE():
            deployment.organization = organization
            deployment.workspace = workspace

        await deployment.create()
        return deployment
    except Exception as e:
        raise Exception(f"Error while creating deployment: {e}")


async def create_app_and_envs(
    app_name: str,
    user_uid: str,
    organization_id: str = None,
    workspace_id: str = None,
) -> AppDB:
    """
    Create a new app with the given name and organization ID.

    Args:
        app_name (str): The name of the app to create.
        user_uid (str): The UID of the user that the app belongs to.
        organization_id (str): The ID of the organization that the app belongs to.
        workspace_id (str): The ID of the workspace that the app belongs to.

    Returns:
        AppDB: The created app.

    Raises:
        ValueError: If an app with the same name already exists.
    """

    user_instance = await get_user(user_uid)
    app = await fetch_app_by_name_and_parameters(
        app_name,
        user_uid,
        organization_id,
        workspace_id,
    )
    if app is not None:
        raise ValueError("App with the same name already exists")

    app = AppDB(app_name=app_name, user=user_instance)

    if isCloudEE():
        # assert that if organization_id is provided, workspace_id is also provided, and vice versa
        assert (
            organization_id is not None and workspace_id is not None
        ), "org_id and workspace_id must be provided together"

        organization_db = await db_manager_ee.get_organization(organization_id)
        workspace_db = await db_manager_ee.get_workspace(workspace_id)

        app.organization = organization_db
        app.workspace = workspace_db

    await app.create()
    await initialize_environments(app)
    return app


async def get_deployment_by_objectid(
    deployment_id: str,
) -> DeploymentDB:
    """Get the deployment object from the database with the provided id.

    Arguments:
        deployment_id (ObjectId): The deployment id

    Returns:
        DeploymentDB: instance of deployment object
    """

    deployment = await DeploymentDB.find_one(
        DeploymentDB.id == ObjectId(deployment_id), fetch_links=True
    )
    logger.debug(f"deployment: {deployment}")
    return deployment


async def get_deployment_by_appid(app_id: str) -> DeploymentDB:
    """Get the deployment object from the database with the provided app id.

    Arguments:
        app_id (str): The app id

    Returns:
        DeploymentDB: instance of deployment object
    """

    deployment = await DeploymentDB.find_one(
        DeploymentDB.app.id == ObjectId(app_id), fetch_links=True
    )
    logger.debug(f"deployment: {deployment}")
    return deployment


async def list_app_variants_for_app_id(
    app_id: str,
) -> List[AppVariantDB]:
    """
    Lists all the app variants from the db
    Args:
        app_name: if specified, only returns the variants for the app name
    Returns:
        List[AppVariant]: List of AppVariant objects
    """
    assert app_id is not None, "app_id cannot be None"
    app_variants_db = await AppVariantDB.find(
        AppVariantDB.app.id == ObjectId(app_id), fetch_links=True
    ).to_list()
    return app_variants_db


async def list_bases_for_app_id(
    app_id: str, base_name: Optional[str] = None
) -> List[VariantBaseDB]:
    """List all the bases for the specified app_id

    Args:
        app_id (str): The ID of the app
        base_name (str): The name of the base

    Returns:
        List[VariantBaseDB]: list of VariantBase objects
    """

    assert app_id is not None, "app_id cannot be None"
    base_query = VariantBaseDB.find(VariantBaseDB.app.id == ObjectId(app_id))
    if base_name:
        base_query = base_query.find(VariantBaseDB.base_name == base_name)
    bases_db = await base_query.sort("base_name").to_list()
    return bases_db


async def list_variants_for_base(base: VariantBaseDB) -> List[AppVariantDB]:
    """
    Lists all the app variants from the db for a base
    Args:
        base: if specified, only returns the variants for the base
    Returns:
        List[AppVariant]: List of AppVariant objects
    """
    assert base is not None, "base cannot be None"
    app_variants_db = (
        await AppVariantDB.find(
            AppVariantDB.base.id == ObjectId(base.id), fetch_links=True
        )
        .sort("variant_name")
        .to_list()
    )
    return app_variants_db


async def get_user(user_uid: str) -> UserDB:
    """Get the user object from the database.

    Arguments:
        user_id (str): The user unique identifier

    Returns:
        UserDB: instance of user
    """

    user = await UserDB.find_one(UserDB.uid == user_uid)
    if user is None:
        if not isCloudEE():
            # create user
            user_db = UserDB(uid="0")
            user = await user_db.create()

            return user
        raise Exception("Please login or signup")
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
        user = await UserDB.find_one(UserDB.id == user_id)
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
        user = await UserDB.find_one(UserDB.email == email)
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

    users_db = await UserDB.find(In(UserDB.id, user_ids)).to_list()
    return users_db


async def get_orga_image_instance_by_docker_id(
    docker_id: str, organization_id: str = None, workspace_id: str = None
) -> ImageDB:
    """Get the image object from the database with the provided id.

    Arguments:
        organization_id (str): The orga unique identifier
        docker_id (str): The image id

    Returns:
        ImageDB: instance of image object
    """

    query_expression = {"docker_id": docker_id}

    if isCloudEE():
        # assert that if organization is provided, workspace_id is also provided, and vice versa
        assert (
            organization_id is not None and workspace_id is not None
        ), "organization and workspace must be provided together"

        query_expression.update(
            {
                "organization.id": ObjectId(organization_id),
                "workspace.id": ObjectId(workspace_id),
            }
        )

    image = await ImageDB.find_one(query_expression)
    return image


async def get_orga_image_instance_by_uri(
    template_uri: str, organization_id: str = None, workspace_id: str = None
) -> ImageDB:
    """Get the image object from the database with the provided id.

    Arguments:
        organization_id (str): The orga unique identifier
        template_uri (url): The image template url

    Returns:
        ImageDB: instance of image object
    """
    parsed_url = urlparse(template_uri)

    if not parsed_url.scheme and not parsed_url.netloc:
        raise ValueError(f"Invalid URL: {template_uri}")

    query_expression = {"template_uri": template_uri}

    if isCloudEE():
        # assert that if organization is provided, workspace_id is also provided, and vice versa
        assert (
            organization_id is not None and workspace_id is not None
        ), "organization and workspace must be provided together"

        query_expression.update(
            {
                "organization.id": ObjectId(organization_id),
                "workspace.id": ObjectId(workspace_id),
            }
        )

    image = await ImageDB.find_one(query_expression)
    return image


async def get_app_instance_by_id(app_id: str) -> AppDB:
    """Get the app object from the database with the provided id.

    Arguments:
        app_id (str): The app unique identifier

    Returns:
        AppDB: instance of app object
    """

    app = await AppDB.find_one(AppDB.id == ObjectId(app_id))
    return app


async def add_variant_from_base_and_config(
    base_db: VariantBaseDB,
    new_config_name: str,
    parameters: Dict[str, Any],
    user_uid: str,
):
    """
    Add a new variant to the database based on an existing base and a new configuration.

    Args:
        base_db (VariantBaseDB): The existing base to use as a template for the new variant.
        new_config_name (str): The name of the new configuration to use for the new variant.
        parameters (Dict[str, Any]): The parameters to use for the new configuration.
        user_uid (str): The UID of the user

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
        av for av in app_variant_for_base if av.config_name == new_config_name
    )
    if already_exists:
        raise ValueError("App variant with the same name already exists")
    user_db = await get_user(user_uid)
    config_db = ConfigDB(
        config_name=new_config_name,
        parameters=parameters,
    )
    db_app_variant = AppVariantDB(
        app=previous_app_variant_db.app,
        variant_name=new_variant_name,
        image=base_db.image,
        user=user_db,
        modified_by=user_db,
        revision=1,
        parameters=parameters,
        previous_variant_name=previous_app_variant_db.variant_name,  # TODO: Remove in future
        base_name=base_db.base_name,
        base=base_db,
        config_name=new_config_name,
        config=config_db,
        is_deleted=False,
    )

    if isCloudEE():
        db_app_variant.organization = previous_app_variant_db.organization
        db_app_variant.workspace = previous_app_variant_db.workspace

    await db_app_variant.create()
    variant_revision = AppVariantRevisionsDB(
        variant=db_app_variant,
        revision=1,
        modified_by=user_db,
        base=base_db,
        config=config_db,
        created_at=datetime.now(timezone.utc),
    )
    await variant_revision.create()

    return db_app_variant


async def list_apps(
    user_uid: str,
    app_name: str = None,
    org_id: str = None,
    workspace_id: str = None,
) -> List[App]:
    """
    Lists all the unique app names and their IDs from the database

    Errors:
        JSONResponse: You do not have permission to access this organization; status_code: 403

    Returns:
        List[App]
    """

    user = await get_user(user_uid)
    assert user is not None, "User is None"

    if app_name is not None:
        app_db = await fetch_app_by_name_and_parameters(
            app_name=app_name,
            user_uid=user_uid,
            organization_id=org_id,
            workspace_id=workspace_id,
        )
        return [converters.app_db_to_pydantic(app_db)]

    elif (org_id is not None) or (workspace_id is not None):
        if not isCloudEE():
            return JSONResponse(
                {
                    "error": "organization and/or workspace is only available in Cloud and EE"
                },
                status_code=400,
            )

        # assert that if org_id is provided, workspace_id is also provided, and vice versa
        assert (
            org_id is not None and workspace_id is not None
        ), "org_id and workspace_id must be provided together"

        user_org_workspace_data = await get_user_org_and_workspace_id(user_uid)
        has_permission = await check_rbac_permission(
            user_org_workspace_data=user_org_workspace_data,
            workspace_id=ObjectId(workspace_id),
            organization_id=ObjectId(org_id),
            permission=Permission.VIEW_APPLICATION,
        )
        logger.debug(f"User has Permission to list apps: {has_permission}")
        if not has_permission:
            error_msg = f"You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

        apps: List[AppDB] = await AppDB.find(
            AppDB.organization.id == ObjectId(org_id),
            AppDB.workspace.id == ObjectId(workspace_id),
        ).to_list()
        return [converters.app_db_to_pydantic(app) for app in apps]

    else:
        apps = await AppDB.find(AppDB.user.id == user.id).to_list()
        return [converters.app_db_to_pydantic(app) for app in apps]


async def list_app_variants(app_id: str) -> List[AppVariantDB]:
    """
    Lists all the app variants from the db
    Args:
        app_name: if specified, only returns the variants for the app name
    Returns:
        List[AppVariant]: List of AppVariant objects
    """

    # Construct query expressions
    app_variants_db = await AppVariantDB.find(
        AppVariantDB.app.id == ObjectId(app_id), fetch_links=True
    ).to_list()
    return app_variants_db


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

    query_expression = {"base.id": db_app_variant.base.id}

    if isCloudEE():
        query_expression.update(
            {
                "organization.id": db_app_variant.organization.id,
                "workspace.id": db_app_variant.workspace.id,
            }
        )

    count_variants = await AppVariantDB.find(query_expression).count()
    return count_variants == 1


async def remove_deployment(deployment_db: DeploymentDB):
    """Remove a deployment from the db

    Arguments:
        deployment -- Deployment to remove
    """
    logger.debug("Removing deployment")
    assert deployment_db is not None, "deployment_db is missing"

    await deployment_db.delete()


async def remove_app_variant_from_db(app_variant_db: AppVariantDB):
    """Remove an app variant from the db
    the logic for removing the image is in app_manager.py

    Arguments:
        app_variant -- AppVariant to remove
    """
    logger.debug("Removing app variant")
    assert app_variant_db is not None, "app_variant_db is missing"

    # Remove the variant from the associated environments
    logger.debug("list_environments_by_variant")
    environments = await list_environments_by_variant(app_variant_db)
    for environment in environments:
        environment.deployed_app_variant = None
        await environment.save()

    app_variant_revisions = await list_app_variant_revisions_by_variant(app_variant_db)
    for app_variant_revision in app_variant_revisions:
        await app_variant_revision.delete()

    await app_variant_db.delete()


async def deploy_to_environment(
    environment_name: str, variant_id: str, **user_org_data: dict
):
    """
    Deploys an app variant to a specified environment.

    Args:
        environment_name (str): The name of the environment to deploy the app variant to.
        variant_id (str): The ID of the app variant to deploy.

    Raises:
        ValueError: If the app variant is not found or if the environment is not found or if the app variant is already
                    deployed to the environment.
    Returns:
        None
    """

    app_variant_db = await fetch_app_variant_by_id(variant_id)
    app_variant_revision_db = await fetch_app_variant_revision_by_variant(
        app_variant_id=variant_id, revision=app_variant_db.revision
    )
    if app_variant_db is None:
        raise ValueError("App variant not found")

    # Find the environment for the given app name and user
    environment_db = await AppEnvironmentDB.find_one(
        AppEnvironmentDB.app.id == app_variant_db.app.id,
        AppEnvironmentDB.name == environment_name,
    )

    if environment_db is None:
        raise ValueError(f"Environment {environment_name} not found")
    # TODO: Modify below to add logic to disable redployment of the same variant revision here and in frontend
    # if environment_db.deployed_app_variant_ == app_variant_db.id:
    #     raise ValueError(
    #         f"Variant {app_variant_db.app.app_name}/{app_variant_db.variant_name} is already deployed to the environment {environment_name}"
    #     )

    # Retrieve app deployment
    deployment = await get_deployment_by_appid(str(app_variant_db.app.id))

    # Update the environment with the new variant name
    environment_db.revision += 1
    environment_db.deployed_app_variant = app_variant_db.id
    environment_db.deployed_app_variant_revision = app_variant_revision_db
    environment_db.deployment = deployment.id

    # Create revision for app environment
    user = await get_user(user_uid=user_org_data["user_uid"])
    await create_environment_revision(
        environment_db,
        user,
        deployed_app_variant_revision=app_variant_revision_db.id,
        deployment=deployment.id,
    )
    await environment_db.save()


async def fetch_app_environment_by_name_and_appid(
    app_id: str, environment_name: str, **kwargs: dict
) -> AppEnvironmentDB:
    """Fetch an app environment using the provided app id and environment name.

    Args:
        app_id (str): The Id of the app
        environment_name (str): The name of the environment

    Returns:
        AppEnvironmentDB: app environment object
    """

    app_environment = await AppEnvironmentDB.find_one(
        AppEnvironmentDB.app.id == ObjectId(app_id),
        AppEnvironmentDB.name == environment_name,
        fetch_links=True,
    )
    return app_environment


async def fetch_app_variant_revision_by_id(
    variant_revision_id: str,
) -> AppVariantRevisionsDB:
    """Fetch an app variant revision using the provided variant revision id.

    Args:
        variant_revision_id (str): The ID of the variant revision

    Returns:
        AppVariantRevisionsDB: app variant revision object
    """

    app_revision = await AppVariantRevisionsDB.find_one(
        AppVariantRevisionsDB.id == ObjectId(variant_revision_id),
    )
    return app_revision


async def fetch_environment_revisions_for_environment(
    environment: AppEnvironmentDB, **kwargs: dict
) -> List[AppEnvironmentRevisionDB]:
    """Returns list of app environment revision for the given environment.

    Args:
        environment (AppEnvironmentDB): The app environment to retrieve environments revisions for.
        **kwargs (dict): Additional keyword arguments.

    Returns:
        List[AppEnvironmentRevisionDB]: A list of AppEnvironmentRevisionDB objects.
    """

    environment_revisions = await AppEnvironmentRevisionDB.find(
        AppEnvironmentRevisionDB.environment.id == environment.id, fetch_links=True
    ).to_list()
    return environment_revisions


async def fetch_app_environment_revision(revision_id: str) -> AppEnvironmentRevisionDB:
    """Fetch an app environment revision using the provided revision_id.

    Args:
        revision_id (str): The ID of the revision
    """

    environment_revision = await AppEnvironmentRevisionDB.find_one(
        AppEnvironmentRevisionDB.id == ObjectId(revision_id), fetch_links=True
    )
    return environment_revision


async def update_app_environment(
    app_environment: AppEnvironmentDB, values_to_update: dict
):
    """Updates an app environment with the provided values to update.

    Args:
        app_environment (AppEnvironmentDB): the app environment object
        values_to_update (dict): the values to update with
    """

    await app_environment.update({"$set": values_to_update})


async def update_app_environment_deployed_variant_revision(
    app_environment: AppEnvironmentDB, deployed_variant_revision: str
):
    """Updates the deployed variant revision for an app environment

    Args:
        app_environment (AppEnvironment): the app environment object
        deployed_variant_revision (str): the ID of the deployed variant revision
    """

    app_variant_revision = await AppVariantRevisionsDB.find_one(
        AppVariantRevisionsDB.id == ObjectId(deployed_variant_revision)
    )
    if app_variant_revision is None:
        raise Exception(f"App variant revision {deployed_variant_revision} not found")

    app_environment.deployed_app_variant_revision = app_variant_revision
    await app_environment.save()


async def list_environments(app_id: str, **kwargs: dict) -> List[AppEnvironmentDB]:
    """
    List all environments for a given app ID.

    Args:
        app_id (str): The ID of the app to list environments for.

    Returns:
        List[AppEnvironmentDB]: A list of AppEnvironmentDB objects representing the environments for the given app ID.
    """
    logging.debug("Listing environments for app %s", app_id)
    app_instance = await fetch_app_by_id(app_id=app_id)
    if app_instance is None:
        logging.error(f"App with id {app_id} not found")
        raise ValueError("App not found")

    environments_db = await AppEnvironmentDB.find(
        AppEnvironmentDB.app.id == ObjectId(app_id), fetch_links=True
    ).to_list()
    return environments_db


async def initialize_environments(app_db: AppDB) -> List[AppEnvironmentDB]:
    """
    Initializes the environments for the app with the given database.

    Args:
        app_db (AppDB): The database for the app.

    Returns:
        List[AppEnvironmentDB]: A list of the initialized environments.
    """
    environments = []
    for env_name in ["development", "staging", "production"]:
        env = await create_environment(name=env_name, app_db=app_db)
        environments.append(env)
    return environments


async def create_environment(name: str, app_db: AppDB) -> AppEnvironmentDB:
    """
    Creates a new environment in the database.

    Args:
        name (str): The name of the environment.
        app_db (AppDB): The AppDB object representing the app that the environment belongs to.

    Returns:
        AppEnvironmentDB: The newly created AppEnvironmentDB object.
    """
    environment_db = AppEnvironmentDB(
        app=app_db, name=name, user=app_db.user, revision=0
    )

    if isCloudEE():
        environment_db.organization = app_db.organization
        environment_db.workspace = app_db.workspace

    await environment_db.create()
    return environment_db


async def create_environment_revision(
    environment: AppEnvironmentDB, user: UserDB, **kwargs: dict
):
    """Creates a new environment revision.

    Args:
        environment (AppEnvironmentDB): The environment to create a revision for.
        user (UserDB): The user that made the deployment.
    """

    assert environment is not None, "environment cannot be None"
    assert user is not None, "user cannot be None"

    environment_revision = AppEnvironmentRevisionDB(
        environment=environment,
        revision=environment.revision,
        modified_by=user,
        created_at=datetime.now(timezone.utc),
    )

    if kwargs:
        deployed_app_variant_revision = kwargs.get("deployed_app_variant_revision")
        if deployed_app_variant_revision is not None:
            environment_revision.deployed_app_variant_revision = (
                deployed_app_variant_revision
            )

        deployment = kwargs.get("deployment")
        if deployment is not None:
            environment_revision.deployment = deployment

    if isCloudEE():
        environment_revision.organization = environment.organization
        environment_revision.workspace = environment.workspace

    await environment_revision.create()


async def list_app_variant_revisions_by_variant(
    app_variant: AppVariantDB,
) -> List[AppVariantRevisionsDB]:
    """Returns list of app variant revision for the given app variant

    Args:
        app_variant (AppVariantDB): The app variant to retrieve environments for.

    Returns:
        List[AppVariantRevisionsDB]: A list of AppVariantRevisionsDB objects.
    """
    app_variant_revision = await AppVariantRevisionsDB.find(
        AppVariantRevisionsDB.variant.id == app_variant.id, fetch_links=True
    ).to_list()
    return app_variant_revision


async def fetch_app_variant_revision(
    app_variant: str, revision_number: int
) -> List[AppVariantRevisionsDB]:
    """Returns list of app variant revision for the given app variant

    Args:
        app_variant (AppVariantDB): The app variant to retrieve environments for.

    Returns:
        List[AppVariantRevisionsDB]: A list of AppVariantRevisionsDB objects.
    """
    app_variant_revision = await AppVariantRevisionsDB.find_one(
        AppVariantRevisionsDB.variant.id == ObjectId(app_variant),
        AppVariantRevisionsDB.revision == revision_number,
        fetch_links=True,
    )
    return app_variant_revision


async def list_environments_by_variant(
    app_variant: AppVariantDB,
) -> List[AppEnvironmentDB]:
    """
    Returns a list of environments for a given app variant.

    Args:
        app_variant (AppVariantDB): The app variant to retrieve environments for.

    Returns:
        List[AppEnvironmentDB]: A list of AppEnvironmentDB objects.
    """

    environments_db = await AppEnvironmentDB.find(
        AppEnvironmentDB.app.id == app_variant.app.id, fetch_links=True
    ).to_list()
    return environments_db


async def remove_image(image: ImageDB):
    """
    Removes an image from the database.

    Args:
        image (ImageDB): The image to remove from the database.

    Raises:
        ValueError: If the image is None.

    Returns:
        None
    """
    if image is None:
        raise ValueError("Image is None")
    await image.delete()


async def remove_environment(environment_db: AppEnvironmentDB):
    """
    Removes an environment from the database.

    Args:
        environment_db (AppEnvironmentDB): The environment to remove from the database.

    Raises:
        AssertionError: If environment_db is None.

    Returns:
        None
    """
    assert environment_db is not None, "environment_db is missing"
    await environment_db.delete()


async def remove_app_testsets(app_id: str):
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
    testsets = await TestSetDB.find(
        TestSetDB.app.id == ObjectId(app_id), fetch_links=True
    ).to_list()

    # Perform deletion if there are testsets to delete
    if testsets is not None:
        for testset in testsets:
            await testset.delete()
            deleted_count += 1
            logger.info(f"{deleted_count} testset(s) deleted for app {app_id}")
            return deleted_count

    logger.info(f"No testsets found for app {app_id}")
    return 0


async def remove_base_from_db(base: VariantBaseDB):
    """
    Remove a base from the database.

    Args:
        base (VariantBaseDB): The base to be removed from the database.

    Raises:
        ValueError: If the base is None.

    Returns:
        None
    """
    if base is None:
        raise ValueError("Base is None")
    await base.delete()


async def remove_app_by_id(app_id: str):
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
    await app_instance.delete()


async def update_variant_parameters(
    app_variant_db: AppVariantDB, parameters: Dict[str, Any], user_uid: str
) -> None:
    """
    Update the parameters of an app variant in the database.

    Args:
        app_variant_db (AppVariantDB): The app variant to update.
        parameters (Dict[str, Any]): The new parameters to set for the app variant.
        user_uid (str): The UID of the user that is updating the app variant.

    Raises:
        ValueError: If there is an issue updating the variant parameters.
    """
    assert app_variant_db is not None, "app_variant is missing"
    assert parameters is not None, "parameters is missing"

    try:
        logging.debug("Updating variant parameters")
        user = await get_user(user_uid)
        # Update associated ConfigDB parameters and versioning
        config_db = app_variant_db.config
        config_db.parameters = parameters
        app_variant_db.revision = app_variant_db.revision + 1
        app_variant_db.modified_by = user

        # Save updated ConfigDB
        await app_variant_db.save()

        variant_revision = AppVariantRevisionsDB(
            variant=app_variant_db,
            revision=app_variant_db.revision,
            modified_by=user,
            base=app_variant_db.base,
            config=config_db,
            created_at=datetime.now(timezone.utc),
        )
        await variant_revision.save()

    except Exception as e:
        logging.error(f"Issue updating variant parameters: {e}")
        raise ValueError("Issue updating variant parameters")


async def get_app_variant_instance_by_id(variant_id: str) -> AppVariantDB:
    """Get the app variant object from the database with the provided id.

    Arguments:
        variant_id (str): The app variant unique identifier

    Returns:
        AppVariantDB: instance of app variant object
    """

    app_variant_db = await AppVariantDB.find_one(
        AppVariantDB.id == ObjectId(variant_id), fetch_links=True
    )
    return app_variant_db


async def get_app_variant_revision_by_id(
    variant_revision_id: str, fetch_links=False
) -> AppVariantRevisionsDB:
    """Get the app variant revision object from the database with the provided id.

    Arguments:
        variant_revision_id (str): The app variant revision unique identifier

    Returns:
        AppVariantDB: instance of app variant object
    """

    variant_revision_db = await AppVariantRevisionsDB.find_one(
        AppVariantRevisionsDB.id == ObjectId(variant_revision_id),
        fetch_links=fetch_links,
    )
    return variant_revision_db


async def fetch_testset_by_id(testset_id: str) -> Optional[TestSetDB]:
    """Fetches a testset by its ID.
    Args:
        testset_id (str): The ID of the testset to fetch.
    Returns:
        TestSetDB: The fetched testset, or None if no testset was found.
    """
    assert testset_id is not None, "testset_id cannot be None"
    testset = await TestSetDB.find_one(
        TestSetDB.id == ObjectId(testset_id), fetch_links=True
    )
    return testset


async def fetch_testsets_by_app_id(app_id: str) -> List[TestSetDB]:
    """Fetches all testsets for a given app.
    Args:
        app_id (str): The ID of the app to fetch testsets for.
    Returns:
        List[TestSetDB]: The fetched testsets.
    """
    assert app_id is not None, "app_id cannot be None"
    testsets = await TestSetDB.find(TestSetDB.app.id == ObjectId(app_id)).to_list()
    return testsets


async def fetch_evaluation_by_id(evaluation_id: str) -> Optional[EvaluationDB]:
    """Fetches a evaluation by its ID.
    Args:
        evaluation_id (str): The ID of the evaluation to fetch.
    Returns:
        EvaluationDB: The fetched evaluation, or None if no evaluation was found.
    """
    assert evaluation_id is not None, "evaluation_id cannot be None"
    evaluation = await EvaluationDB.find_one(
        EvaluationDB.id == ObjectId(evaluation_id), fetch_links=True
    )
    return evaluation


async def fetch_human_evaluation_by_id(
    evaluation_id: str,
) -> Optional[HumanEvaluationDB]:
    """Fetches a evaluation by its ID.
    Args:
        evaluation_id (str): The ID of the evaluation to fetch.
    Returns:
        EvaluationDB: The fetched evaluation, or None if no evaluation was found.
    """
    assert evaluation_id is not None, "evaluation_id cannot be None"
    evaluation = await HumanEvaluationDB.find_one(
        HumanEvaluationDB.id == ObjectId(evaluation_id), fetch_links=True
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
    evaluation_scenario = await EvaluationScenarioDB.find_one(
        EvaluationScenarioDB.id == ObjectId(evaluation_scenario_id, fetch_links=True)
    )
    return evaluation_scenario


async def fetch_human_evaluation_scenario_by_id(
    evaluation_scenario_id: str,
) -> Optional[HumanEvaluationScenarioDB]:
    """Fetches and evaluation scenario by its ID.
    Args:
        evaluation_scenario_id (str): The ID of the evaluation scenario to fetch.
    Returns:
        EvaluationScenarioDB: The fetched evaluation scenario, or None if no evaluation scenario was found.
    """
    assert evaluation_scenario_id is not None, "evaluation_scenario_id cannot be None"
    evaluation_scenario = await HumanEvaluationScenarioDB.find_one(
        HumanEvaluationScenarioDB.id == ObjectId(evaluation_scenario_id),
        fetch_links=True,
    )
    return evaluation_scenario


async def fetch_human_evaluation_scenario_by_evaluation_id(
    evaluation_id: str,
) -> Optional[HumanEvaluationScenarioDB]:
    """Fetches and evaluation scenario by its ID.
    Args:
        evaluation_id (str): The ID of the evaluation object to use in fetching the human evaluation.
    Returns:
        EvaluationScenarioDB: The fetched evaluation scenario, or None if no evaluation scenario was found.
    """
    evaluation = await fetch_human_evaluation_by_id(evaluation_id)
    human_eval_scenario = await HumanEvaluationScenarioDB.find_one(
        HumanEvaluationScenarioDB.evaluation.id == ObjectId(evaluation.id),
        fetch_links=True,
    )
    return human_eval_scenario


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
    previous_variants = await AppVariantDB.find(
        AppVariantDB.base.id == ObjectId(base_id)
    ).to_list()
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
    existing_template = await TemplateDB.find_one(TemplateDB.tag_id == kwargs["tag_id"])
    if existing_template is None:
        db_template = TemplateDB(**kwargs)
        await db_template.create()
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
    existing_template = await TemplateDB.find_one(TemplateDB.name == key)

    if existing_template:
        # Compare existing values with new values
        if (
            existing_template.title == value.get("name")
            and existing_template.description == value.get("description")
            and existing_template.template_uri == value.get("template_uri")
        ):
            # Values are unchanged, return existing template id
            return str(existing_template.id)
        else:
            # Values are changed, delete existing template
            await existing_template.delete()

    # Create a new template
    template_name = key
    title = value.get("name")
    description = value.get("description")
    template_uri = value.get("template_uri")

    template_db_instance = TemplateDB(
        type="zip",
        name=template_name,
        title=title,
        description=description,
        template_uri=template_uri,
    )
    await template_db_instance.create()
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
    template_db = await TemplateDB.find_one(TemplateDB.id == ObjectId(template_id))
    return template_db


async def remove_old_template_from_db(tag_ids: list) -> None:
    """Deletes old templates that are no longer in docker hub.

    Arguments:
        tag_ids -- list of template IDs you want to keep
    """

    templates_to_delete = []
    templates: List[TemplateDB] = await TemplateDB.find().to_list()

    for temp in templates:
        if temp.tag_id not in tag_ids:
            templates_to_delete.append(temp)

    for template in templates_to_delete:
        await template.delete()


async def get_templates() -> List[Template]:
    templates = await TemplateDB.find().to_list()
    return converters.templates_db_to_pydantic(templates)


async def update_base(
    base: VariantBaseDB,
    **kwargs: dict,
) -> VariantBaseDB:
    """Update the base object in the database with the provided id.

    Arguments:
        base (VariantBaseDB): The base object to update.
    """

    for key, value in kwargs.items():
        if hasattr(base, key):
            setattr(base, key, value)

    await base.save()
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
        if hasattr(app_variant, key):
            setattr(app_variant, key, value)

    await app_variant.save()
    return app_variant


async def fetch_app_by_name_and_parameters(
    app_name: str,
    user_uid: str,
    organization_id: str = None,
    workspace_id: str = None,
):
    """Fetch an app by its name, organization id, and workspace id.

    Args:
        app_name (str): The name of the app
        organization_id (str): The ID of the app organization
        workspace_id (str): The ID of the app workspace

    Returns:
        AppDB: the instance of the app
    """

    query_expression = {"app_name": app_name}

    if isCloudEE():
        # assert that if organization is provided, workspace_id is also provided, and vice versa
        assert (
            organization_id is not None and workspace_id is not None
        ), "organization_id and workspace_id must be provided together"

        query_expression.update(
            {
                "organization.id": ObjectId(organization_id),
                "workspace.id": ObjectId(workspace_id),
            }
        )
    else:
        query_expression.update(
            {
                "user.uid": user_uid,
            }
        )

    app_db = await AppDB.find_one(query_expression, fetch_links=True)
    return app_db


async def create_new_evaluation(
    app: AppDB,
    user: UserDB,
    testset: TestSetDB,
    status: str,
    variant: str,
    variant_revision: str,
    evaluators_configs: List[str],
    organization=None,
    workspace=None,
) -> EvaluationDB:
    """Create a new evaluation scenario.
    Returns:
        EvaluationScenarioDB: The created evaluation scenario.
    """
    evaluation = EvaluationDB(
        app=app,
        user=user,
        testset=testset,
        status=status,
        variant=variant,
        variant_revision=variant_revision,
        evaluators_configs=evaluators_configs,
        aggregated_results=[],
        created_at=datetime.now(timezone.utc).isoformat(),
        updated_at=datetime.now(timezone.utc).isoformat(),
    )

    if isCloudEE():
        # assert that if organization is provided, workspace is also provided, and vice versa
        assert (
            organization is not None and workspace is not None
        ), "organization and workspace must be provided together"

        evaluation.organization = organization
        evaluation.workspace = workspace

    await evaluation.create()
    return evaluation


async def create_new_evaluation_scenario(
    user: UserDB,
    evaluation: EvaluationDB,
    variant_id: str,
    inputs: List[EvaluationScenarioInputDB],
    outputs: List[EvaluationScenarioOutputDB],
    correct_answer: Optional[str],
    is_pinned: Optional[bool],
    note: Optional[str],
    evaluators_configs: List[EvaluatorConfigDB],
    results: List[EvaluationScenarioResult],
    organization=None,
    workspace=None,
) -> EvaluationScenarioDB:
    """Create a new evaluation scenario.
    Returns:
        EvaluationScenarioDB: The created evaluation scenario.
    """
    evaluation_scenario = EvaluationScenarioDB(
        user=user,
        evaluation=evaluation,
        variant_id=ObjectId(variant_id),
        inputs=inputs,
        outputs=outputs,
        correct_answer=correct_answer,
        is_pinned=is_pinned,
        note=note,
        evaluators_configs=evaluators_configs,
        results=results,
    )

    if isCloudEE():
        # assert that if organization is provided, workspace is also provided, and vice versa
        assert (
            organization is not None and workspace is not None
        ), "organization and workspace must be provided together"

        evaluation_scenario.organization = organization
        evaluation_scenario.workspace = workspace

    await evaluation_scenario.create()
    return evaluation_scenario


async def update_evaluation_with_aggregated_results(
    evaluation_id: ObjectId, aggregated_results: List[AggregatedResult]
) -> EvaluationDB:
    evaluation = await EvaluationDB.find_one(EvaluationDB.id == ObjectId(evaluation_id))

    if not evaluation:
        raise ValueError("Evaluation not found")

    evaluation.aggregated_results = aggregated_results
    evaluation.updated_at = datetime.now(timezone.utc).isoformat()

    await evaluation.save()
    return evaluation


async def fetch_evaluators_configs(app_id: str):
    """Fetches a list of evaluator configurations from the database.

    Returns:
        List[EvaluatorConfigDB]: A list of evaluator configuration objects.
    """
    assert app_id is not None, "evaluation_id cannot be None"

    try:
        evaluators_configs = await EvaluatorConfigDB.find(
            EvaluatorConfigDB.app.id == ObjectId(app_id)
        ).to_list()
        return evaluators_configs
    except Exception as e:
        raise e


async def fetch_evaluator_config(evaluator_config_id: str):
    """Fetch evaluator configurations from the database.

    Returns:
        EvaluatorConfigDB: the evaluator configuration object.
    """

    try:
        evaluator_config: EvaluatorConfigDB = await EvaluatorConfigDB.find_one(
            EvaluatorConfigDB.id == ObjectId(evaluator_config_id), fetch_links=True
        )
        return evaluator_config
    except Exception as e:
        raise e


async def check_if_ai_critique_exists_in_list_of_evaluators_configs(
    evaluators_configs_ids: List[str],
) -> bool:
    """Fetch evaluator configurations from the database.

    Returns:
        EvaluatorConfigDB: the evaluator configuration object.
    """

    try:
        evaluator_configs_object_ids = [
            ObjectId(evaluator_config_id)
            for evaluator_config_id in evaluators_configs_ids
        ]
        evaluators_configs: List[EvaluatorConfigDB] = await EvaluatorConfigDB.find(
            {
                "_id": {"$in": evaluator_configs_object_ids},
                "evaluator_key": "auto_ai_critique",
            }
        ).to_list()

        return bool(evaluators_configs)
    except Exception as e:
        raise e


async def fetch_evaluator_config_by_appId(
    app_id: str, evaluator_name: str
) -> EvaluatorConfigDB:
    """Fetch the evaluator config from the database using the app Id and evaluator name.

    Args:
        app_id (str): The app Id
        evaluator_name (str): The name of the evaluator

    Returns:
        EvaluatorConfigDB: the evaluator configuration object.
    """

    try:
        evaluator_config = await EvaluatorConfigDB.find_one(
            EvaluatorConfigDB.app.id == ObjectId(app_id),
            EvaluatorConfigDB.evaluator_key == evaluator_name,
        )
        return evaluator_config
    except Exception as e:
        raise e


async def create_evaluator_config(
    app: AppDB,
    user: UserDB,
    name: str,
    evaluator_key: str,
    organization=None,
    workspace=None,
    settings_values: Optional[Dict[str, Any]] = None,
) -> EvaluatorConfigDB:
    """Create a new evaluator configuration in the database."""

    new_evaluator_config = EvaluatorConfigDB(
        app=app,
        user=user,
        name=name,
        evaluator_key=evaluator_key,
        settings_values=settings_values,
    )

    if isCloudEE():
        # assert that if organization is provided, workspace is also provided, and vice versa
        assert (
            organization is not None and workspace is not None
        ), "organization and workspace must be provided together"

        new_evaluator_config.organization = organization
        new_evaluator_config.workspace = workspace

    try:
        await new_evaluator_config.create()
        return new_evaluator_config
    except Exception as e:
        raise e


async def update_evaluator_config(
    evaluator_config_id: str, updates: Dict[str, Any]
) -> EvaluatorConfigDB:
    """
    Update an evaluator configuration in the database with the provided id.

    Arguments:
        evaluator_config_id (str): The ID of the evaluator configuration to be updated.
        updates (Dict[str, Any]): The updates to apply to the evaluator configuration.

    Returns:
        EvaluatorConfigDB: The updated evaluator configuration object.
    """

    evaluator_config = await EvaluatorConfigDB.find_one(
        EvaluatorConfigDB.id == ObjectId(evaluator_config_id)
    )
    updates_dict = updates.dict(exclude_unset=True)

    for key, value in updates_dict.items():
        if hasattr(evaluator_config, key):
            setattr(evaluator_config, key, value)
    await evaluator_config.save()
    return evaluator_config


async def delete_evaluator_config(evaluator_config_id: str) -> bool:
    """Delete an evaluator configuration from the database."""
    assert evaluator_config_id is not None, "Evaluator Config ID cannot be None"

    try:
        evaluator_config = await EvaluatorConfigDB.find_one(
            EvaluatorConfigDB.id == ObjectId(evaluator_config_id)
        )
        delete_result = await evaluator_config.delete()
        return delete_result.acknowledged
    except Exception as e:
        raise e


async def update_evaluation(
    evaluation_id: str, updates: Dict[str, Any]
) -> EvaluationDB:
    """
    Update an evaluator configuration in the database with the provided id.

    Arguments:
        evaluation_id (str): The ID of the evaluator configuration to be updated.
        updates (Dict[str, Any]): The updates to apply to the evaluator configuration.

    Returns:
        EvaluatorConfigDB: The updated evaluator configuration object.
    """
    evaluation = await EvaluationDB.get(ObjectId(evaluation_id))

    for key, value in updates.items():
        if hasattr(evaluation, key):
            setattr(evaluation, key, value)
    await evaluation.save()
    return evaluation


async def check_if_evaluation_contains_failed_evaluation_scenarios(
    evaluation_id: str,
) -> bool:
    query = EvaluationScenarioDB.find(
        EvaluationScenarioDB.evaluation.id == ObjectId(evaluation_id),
        {"results": {"$elemMatch": {"result.type": "error"}}},
    )

    count = await query.count()
    if count > 0:
        return True
    return False

import os
import uuid
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

from sqlalchemy import func
from sqlalchemy.future import select
from sqlalchemy.exc import NoResultFound
from sqlalchemy.ext.asyncio import AsyncSession
from agenta_backend.models.db_engine import db_engine
from sqlalchemy.orm import joinedload, aliased, load_only

from agenta_backend.models.api.api_models import (
    App,
    Template,
)

if isCloudEE():
    from agenta_backend.commons.services import db_manager_ee
    from agenta_backend.commons.utils.permissions import check_rbac_permission
    from agenta_backend.commons.services.selectors import get_user_org_and_workspace_id

    from agenta_backend.commons.models.db_models import (
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
    from agenta_backend.commons.models.shared_models import (
        Permission,
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
    TemplateDB,
    EvaluatorConfigDB,
    AppVariantRevisionsDB,
    HumanEvaluationVariantDB,
    EvaluationScenarioResultDB,
    EvaluationEvaluatorConfigDB,
    EvaluationAggregatedResultDB,
)

from agenta_backend.models.shared_models import (
    HumanEvaluationScenarioInput,
    Result,
    ConfigDB,
    CorrectAnswer,
    AggregatedResult,
    EvaluationScenarioResult,
    EvaluationScenarioInput,
    EvaluationScenarioOutput,
    TemplateType,
)


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
    org_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
):
    """Add testset to app variant.
    Args:
        app_id (str): The id of the app
        org_id (str): The id of the organization
        template_name (str): The name of the app template image
        app_name (str): The name of the app
        user_uid (str): The uid of the user
    """

    async with db_engine.get_session() as session:
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
                    "csvdata": csvdata,
                }
                testset_db = TestSetDB(
                    **testset,
                    app_id=app_db.id,
                    user_id=user_db.id,
                )

                if isCloudEE():
                    # assert that if organization is provided, workspace_id is also provided, and vice versa
                    assert (
                        org_id is not None and workspace_id is not None
                    ), "organization and workspace must be provided together"

                    organization_db = await db_manager_ee.get_organization(org_id)  # type: ignore
                    workspace_db = await db_manager_ee.get_workspace(workspace_id)  # type: ignore

                    testset_db.organization_id = organization_db.id
                    testset_db.workspace_id = workspace_db.id

                session.add(testset_db)
                await session.commit()
                await session.refresh(testset_db)

        except Exception as e:
            print(f"An error occurred in adding the default testset: {e}")


async def get_image_by_id(image_id: str) -> ImageDB:
    """Get the image object from the database with the provided id.

    Arguments:
        image_id (str): The image unique identifier

    Returns:
        ImageDB: instance of image object
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(ImageDB).filter_by(id=uuid.UUID(image_id))
        )
        image = result.scalars().one_or_none()
        return image


async def fetch_app_by_id(app_id: str) -> AppDB:
    """Fetches an app by its ID.

    Args:
        app_id: _description_
    """

    assert app_id is not None, "app_id cannot be None"
    async with db_engine.get_session() as session:
        result = await session.execute(select(AppDB).filter_by(id=uuid.UUID(app_id)))
        app = result.scalars().one_or_none()
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
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .options(
                joinedload(AppVariantDB.base),
                joinedload(AppVariantDB.app),
            )
            .filter_by(id=uuid.UUID(app_variant_id))
        )
        app_variant = result.scalars().one_or_none()
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
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantDB).filter_by(base_id=uuid.UUID(base_id))
        )
        app_variant = result.scalars().one_or_none()
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
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantDB).filter_by(
                base_id=uuid.UUID(base_id), config_name=config_name
            )
        )
        app_variant = result.scalars().one_or_none()
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

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantRevisionsDB).filter_by(
                variant_id=uuid.UUID(app_variant_id), revision=revision
            )
        )
        app_variant_revision = result.scalars().one_or_none()
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

    assert base_id is not None, "no base_id provided"
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(VariantBaseDB)
            .options(
                joinedload(VariantBaseDB.image), joinedload(VariantBaseDB.deployment)
            )
            .filter_by(id=uuid.UUID(base_id))
        )
        base = result.scalars().one_or_none()
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

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantDB).filter_by(
                variant_name=variant_name, app_id=uuid.UUID(app_id)
            )
        )
        app_variant = result.scalars().one_or_none()
        return app_variant


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
    async with db_engine.get_session() as session:
        base = VariantBaseDB(
            app_id=app.id,
            user_id=user.id,
            base_name=base_name,
            image_id=image.id,
        )

        if isCloudEE():
            # assert that if organization is provided, workspace_id is also provided, and vice versa
            assert (
                organization is not None and workspace is not None
            ), "organization and workspace must be provided together"

            base.organization_id = uuid.UUID(organization)
            base.workspace_id = uuid.UUID(workspace)

        session.add(base)
        await session.commit()
        await session.refresh(base)

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

    return ConfigDB(
        config_name=config_name,
        parameters=parameters,
    )


async def create_new_app_variant(
    app: AppDB,
    user: UserDB,
    variant_name: str,
    image: ImageDB,
    base: VariantBaseDB,
    config: ConfigDB,
    base_name: str,
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
        config.parameters == {}
    ), "Parameters should be empty when calling create_new_app_variant (otherwise revision should not be set to 0)"

    async with db_engine.get_session() as session:
        variant = AppVariantDB(
            app_id=app.id,
            user_id=user.id,
            modified_by_id=user.id,
            revision=0,
            variant_name=variant_name,
            image_id=image.id,
            base_id=base.id,
            base_name=base_name,
            config_name=config.config_name,
            config_parameters=config.parameters,
        )

        if isCloudEE():
            # assert that if organization is provided, workspace_id is also provided, and vice versa
            assert (
                organization is not None and workspace is not None
            ), "organization and workspace must be provided together"

            variant.organization_id = uuid.UUID(organization)
            variant.workspace_id = uuid.UUID(workspace)

        session.add(variant)
        await session.commit()
        await session.refresh(
            variant,
            attribute_names=[
                "app",
                "image",
                "user",
                "base",
            ],
        )  # Ensures the app, image, user and base relationship are loaded

        variant_revision = AppVariantRevisionsDB(
            variant_id=variant.id,
            revision=0,
            modified_by_id=user.id,
            base_id=base.id,
            config_name=config.config_name,
            config_parameters=config.parameters,
        )

        session.add(variant_revision)
        await session.commit()
        await session.refresh(variant_revision)

        return variant


async def create_image(
    image_type: str,
    user: UserDB,
    deletable: bool,
    organization=None,
    workspace=None,
    template_uri: Optional[str] = None,
    docker_id: Optional[str] = None,
    tags: Optional[str] = None,
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

    async with db_engine.get_session() as session:
        image = ImageDB(
            deletable=deletable,
            user_id=user.id,
        )

        if image_type == "zip":
            image.type = "zip"  # type: ignore
            image.template_uri = template_uri  # type: ignore
        elif image_type == "image":
            image.type = "image"  # type: ignore
            image.tags = tags  # type: ignore
            image.docker_id = docker_id  # type: ignore

        if isCloudEE():
            # assert that if organization is provided, workspace_id is also provided, and vice versa
            assert (
                organization is not None and workspace is not None
            ), "organization and workspace must be provided together"

            image.organization_id = uuid.UUID(organization)
            image.workspace_id = uuid.UUID(workspace)

        session.add(image)
        await session.commit()
        await session.refresh(image)

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

    async with db_engine.get_session() as session:
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
                deployment.organization_id = uuid.UUID(organization)
                deployment.workspace_id = uuid.UUID(workspace)

            session.add(deployment)
            await session.commit()
            await session.refresh(deployment)

            return deployment
        except Exception as e:
            raise Exception(f"Error while creating deployment: {e}")


async def create_app_and_envs(
    app_name: str,
    user_uid: str,
    organization_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
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

    user = await get_user(user_uid)
    app = await fetch_app_by_name_and_parameters(
        app_name,
        user_uid,
        organization_id,
        workspace_id,
    )
    if app is not None:
        raise ValueError("App with the same name already exists")

    async with db_engine.get_session() as session:
        app = AppDB(app_name=app_name, user_id=user.id)

        if isCloudEE():
            # assert that if organization_id is provided, workspace_id is also provided, and vice versa
            assert (
                organization_id is not None and workspace_id is not None
            ), "org_id and workspace_id must be provided together"

            organization_db = await db_manager_ee.get_organization(organization_id)  # type: ignore
            workspace_db = await db_manager_ee.get_workspace(workspace_id)  # type: ignore

            app.organization_id = organization_db.id
            app.workspace_id = workspace_db.id

        session.add(app)
        await session.commit()
        await session.refresh(app)

        await initialize_environments(session=session, app_db=app)
        return app


async def get_deployment_by_id(
    deployment_id: str,
) -> DeploymentDB:
    """Get the deployment object from the database with the provided id.

    Arguments:
        deployment_id (str): The deployment id

    Returns:
        DeploymentDB: instance of deployment object
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(DeploymentDB).filter_by(id=uuid.UUID(deployment_id))
        )
        deployment = result.scalars().one_or_none()
        return deployment


async def get_deployment_by_appid(app_id: str) -> DeploymentDB:
    """Get the deployment object from the database with the provided app id.

    Arguments:
        app_id (str): The app id

    Returns:
        DeploymentDB: instance of deployment object
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(DeploymentDB).filter_by(app_id=uuid.UUID(app_id))
        )
        deployment = result.scalars().one_or_none()
        logger.debug(f"deployment: {deployment}")
        return deployment


async def list_app_variants_for_app_id(
    app_id: str,
):
    """
    Lists all the app variants from the db
    Args:
        app_name: if specified, only returns the variants for the app name
    Returns:
        List[AppVariant]: List of AppVariant objects
    """

    assert app_id is not None, "app_id cannot be None"
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantDB).filter_by(app_id=uuid.UUID(app_id))
        )
        app_variants = result.scalars().all()
        return app_variants


async def list_bases_for_app_id(app_id: str, base_name: Optional[str] = None):
    """List all the bases for the specified app_id

    Args:
        app_id (str): The ID of the app
        base_name (str): The name of the base

    Returns:
        List[VariantBaseDB]: list of VariantBase objects
    """

    assert app_id is not None, "app_id cannot be None"
    async with db_engine.get_session() as session:
        query = select(VariantBaseDB).filter_by(app_id=uuid.UUID(app_id))
        if base_name:
            query = query.filter_by(base_name=base_name)

        result = await session.execute(query.order_by(VariantBaseDB.base_name.asc()))
        bases = result.scalars().all()
        return bases


async def list_variants_for_base(base: VariantBaseDB):
    """
    Lists all the app variants from the db for a base
    Args:
        base: if specified, only returns the variants for the base
    Returns:
        List[AppVariant]: List of AppVariant objects
    """

    assert base is not None, "base cannot be None"
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .filter_by(base_id=base.id)
            .order_by(AppVariantDB.variant_name.asc())
        )
        app_variants = result.scalars().all()
        return app_variants


async def get_user(user_uid: str) -> UserDB:
    """Get the user object from the database.

    Arguments:
        user_id (str): The user unique identifier

    Returns:
        UserDB: instance of user
    """

    async with db_engine.get_session() as session:
        result = await session.execute(select(UserDB).filter_by(uid=user_uid))
        user = result.scalars().one_or_none()

        if user is None and isCloudEE():
            raise Exception("Please login or signup")

        if user is None and not isCloudEE():
            user_db = UserDB(uid="0")

            session.add(user_db)
            await session.commit()
            await session.refresh(user_db)

            return user_db

        return user


async def get_user_with_id(user_id: str):
    """
    Retrieves a user from a database based on their ID.

    Args:
        user_id (str): The ID of the user to retrieve from the database.

    Returns:
        user: The user object retrieved from the database.

    Raises:
        Exception: If an error occurs while getting the user from the database.
    """

    async with db_engine.get_session() as session:
        result = await session.execute(select(UserDB).filter_by(id=uuid.UUID(user_id)))
        user = result.scalars().one_or_none()
        if user is None:
            logger.error("Failed to get user with id")
            raise Exception("Error while getting user")
        return user


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

    async with db_engine.get_session() as session:
        result = await session.execute(select(UserDB).filter_by(email=email))
        user = result.scalars().one_or_none()
        if user is None:
            logger.error("Failed to get user with email address")
            raise Exception("Error while getting user")
        return user


async def get_users_by_ids(user_ids: List):
    """
    Retrieve users from the database by their IDs.

    Args:
        user_ids (List): A list of user IDs to retrieve.
    """

    async with db_engine.get_session() as session:
        user_uids = [uuid.UUID(user_id) for user_id in user_ids]
        result = await session.execute(select(UserDB).where(UserDB.id.in_(user_uids)))
        users = result.scalars().all()
        return users


async def get_orga_image_instance_by_docker_id(
    docker_id: str,
    organization_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> ImageDB:
    """Get the image object from the database with the provided id.

    Arguments:
        organization_id (str): The organization unique identifier
        docker_id (str): The image id

    Returns:
        ImageDB: instance of image object
    """

    async with db_engine.get_session() as session:
        query = select(ImageDB).filter_by(docker_id=docker_id)

        if isCloudEE():
            # assert that if organization is provided, workspace_id is also provided, and vice versa
            assert (
                organization_id is not None and workspace_id is not None
            ), "organization and workspace must be provided together"

            query = query.filter_by(
                organization_id=uuid.UUID(organization_id),
                workspace_id=uuid.UUID(workspace_id),
            )

        result = await session.execute(query)
        image = result.scalars().one_or_none()
        return image


async def get_orga_image_instance_by_uri(
    template_uri: str,
    organization_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
) -> ImageDB:
    """Get the image object from the database with the provided id.

    Arguments:
        organization_id (str): The organization unique identifier
        template_uri (url): The image template url

    Returns:
        ImageDB: instance of image object
    """

    parsed_url = urlparse(template_uri)
    if not parsed_url.scheme and not parsed_url.netloc:
        raise ValueError(f"Invalid URL: {template_uri}")

    async with db_engine.get_session() as session:
        query = select(ImageDB).filter_by(template_uri=template_uri)

        if isCloudEE():
            # assert that if organization is provided, workspace_id is also provided, and vice versa
            assert (
                organization_id is not None and workspace_id is not None
            ), "organization and workspace must be provided together"

            query = query.filter_by(
                organization_id=uuid.UUID(organization_id),
                workspace_id=uuid.UUID(workspace_id),
            )

        result = await session.execute(query)
        image = result.scalars().one_or_none()
        return image


async def get_app_instance_by_id(app_id: str) -> AppDB:
    """Get the app object from the database with the provided id.

    Arguments:
        app_id (str): The app unique identifier

    Returns:
        AppDB: instance of app object
    """

    async with db_engine.get_session() as session:
        result = await session.execute(select(AppDB).filter_by(id=uuid.UUID(app_id)))
        app = result.scalars().one_or_none()
        return app


async def add_variant_from_base_and_config(
    base_db: VariantBaseDB,
    new_config_name: str,
    parameters: Dict[str, Any],
    user_uid: str,
) -> AppVariantDB:
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
        raise HTTPException(status_code=404, detail="Previous app variant not found")

    logger.debug(f"Located previous variant: {previous_app_variant_db}")
    app_variant_for_base = await list_variants_for_base(base_db)

    already_exists = any(
        av for av in app_variant_for_base if av.config_name == new_config_name  # type: ignore
    )
    if already_exists:
        raise ValueError("App variant with the same name already exists")

    user_db = await get_user(user_uid)
    async with db_engine.get_session() as session:
        db_app_variant = AppVariantDB(
            app_id=previous_app_variant_db.app_id,
            variant_name=new_variant_name,
            image_id=base_db.image_id,
            user_id=user_db.id,
            modified_by_id=user_db.id,
            revision=1,
            base_name=base_db.base_name,
            base_id=base_db.id,
            config_name=new_config_name,
            config_parameters=parameters,
        )

        if isCloudEE():
            db_app_variant.organization_id = previous_app_variant_db.organization_id
            db_app_variant.workspace_id = previous_app_variant_db.workspace_id

        session.add(db_app_variant)
        await session.commit()
        await session.refresh(db_app_variant)

        variant_revision = AppVariantRevisionsDB(
            variant_id=db_app_variant.id,
            revision=1,
            modified_by_id=user_db.id,
            base_id=base_db.id,
            config_name=new_config_name,
            config_parameters=parameters,
        )

        session.add(variant_revision)
        await session.commit()
        await session.refresh(variant_revision)

        return db_app_variant


async def list_apps(
    user_uid: str,
    app_name: Optional[str] = None,
    org_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
):
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

    elif org_id is not None or workspace_id is not None:
        if not isCloudEE():
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "organization and/or workspace is only available in Cloud and EE"
                },
            )

        # assert that if org_id is provided, workspace_id is also provided, and vice versa
        assert (
            org_id is not None and workspace_id is not None
        ), "org_id and workspace_id must be provided together"
        if isCloudEE():
            user_org_workspace_data = await get_user_org_and_workspace_id(user_uid)  # type: ignore
            has_permission = await check_rbac_permission(  # type: ignore
                user_org_workspace_data=user_org_workspace_data,
                workspace_id=uuid.UUID(workspace_id),
                organization_id=uuid.UUID(org_id),
                permission=Permission.VIEW_APPLICATION,  # type: ignore
            )
            logger.debug(f"User has Permission to list apps: {has_permission}")
            if not has_permission:
                raise HTTPException(
                    status_code=403,
                    detail="You do not have access to perform this action. Please contact your organization admin.",
                )

            async with db_engine.get_session() as session:
                result = await session.execute(
                    select(AppDB).filter_by(
                        organization_id=uuid.UUID(org_id),
                        workspace_id=uuid.UUID(workspace_id),
                    )
                )
                apps = result.unique().scalars().all()
                return [converters.app_db_to_pydantic(app) for app in apps]

    else:
        async with db_engine.get_session() as session:
            result = await session.execute(select(AppDB).filter_by(user_id=user.id))
            apps = result.unique().scalars().all()
            return [converters.app_db_to_pydantic(app) for app in apps]


async def list_app_variants(app_id: str):
    """
    Lists all the app variants from the db
    Args:
        app_name: if specified, only returns the variants for the app name
    Returns:
        List[AppVariant]: List of AppVariant objects
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .options(joinedload(AppVariantDB.app), joinedload(AppVariantDB.base))
            .filter_by(app_id=uuid.UUID(app_id))
        )
        app_variants = result.scalars().all()
        return app_variants


async def check_is_last_variant_for_image(db_app_variant: AppVariantDB) -> bool:
    """Checks whether the input variant is the sole variant that uses its linked image.

    NOTE: This is a helpful function to determine whether to delete the image when removing a variant. Usually many variants will use the same image (these variants would have been created using the UI). We only delete the image and shutdown the container if the variant is the last one using the image

    Arguments:
        app_variant -- AppVariant to check

    Returns:
        true if it's the last variant, false otherwise
    """

    async with db_engine.get_session() as session:
        query = select(AppVariantDB).filter_by(base_id=db_app_variant.base_id)

        if isCloudEE():
            query = query.filter(
                AppVariantDB.organization_id == db_app_variant.organization_id,
                AppVariantDB.workspace_id == db_app_variant.workspace_id,
            )

        count_result = await session.execute(
            query.with_only_columns(func.count())  # type: ignore
        )
        count_variants = count_result.scalar()
        return count_variants == 1


async def remove_deployment(deployment_id: str):
    """Remove a deployment from the db

    Arguments:
        deployment -- Deployment to remove
    """

    logger.debug("Removing deployment")
    assert deployment_id is not None, "deployment_id is missing"

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(DeploymentDB).filter_by(id=uuid.UUID(deployment_id))
        )
        deployment = result.scalars().one_or_none()
        if not deployment:
            raise NoResultFound(f"Deployment with {deployment_id} not found")

        await session.delete(deployment)
        await session.commit()


async def list_deployments(app_id: str):
    """Lists all the deployments that belongs to an app.

    Args:
        app_id (str): The ID of the app

    Returns:
        a list/sequence of all the deployments that were retrieved
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(DeploymentDB).filter_by(app_id=uuid.UUID(app_id))
        )
        environments = result.scalars().all()
        return environments


async def remove_app_variant_from_db(app_variant_db: AppVariantDB):
    """Remove an app variant from the db
    the logic for removing the image is in app_manager.py

    Arguments:
        app_variant -- AppVariant to remove
    """

    logger.debug("Removing app variant")
    assert app_variant_db is not None, "app_variant_db is missing"

    logger.debug("list_app_variants_revisions_by_variant")
    app_variant_revisions = await list_app_variant_revisions_by_variant(app_variant_db)

    async with db_engine.get_session() as session:
        logger.debug("list_environments_by_variant")
        environments = await list_environments_by_variant(session, app_variant_db)

        # Remove the variant from the associated environments
        for environment in environments:
            environment.deployed_app_variant = None
            await session.commit()

        # Delete all the revisions associated with the variant
        for app_variant_revision in app_variant_revisions:
            await session.delete(app_variant_revision)

        # Delete app variant and commit action to database
        await session.delete(app_variant_db)
        await session.commit()


async def deploy_to_environment(
    environment_name: str, variant_id: str, **user_org_data
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
        app_variant_id=variant_id, revision=app_variant_db.revision  # type: ignore
    )
    if app_variant_db is None:
        raise ValueError("App variant not found")

    # Retrieve app deployment
    deployment = await get_deployment_by_appid(str(app_variant_db.app_id))

    # Retrieve user
    assert "user_uid" in user_org_data, "User uid is required"
    user = await get_user(user_uid=user_org_data["user_uid"])

    async with db_engine.get_session() as session:
        # Find the environment for the given app name and user
        result = await session.execute(
            select(AppEnvironmentDB).filter_by(
                app_id=app_variant_db.app_id, name=environment_name
            )
        )
        environment_db = result.scalars().one_or_none()
        if environment_db is None:
            raise ValueError(f"Environment {environment_name} not found")

        # TODO: Modify below to add logic to disable redeployment of the same variant revision here and in front-end
        # if environment_db.deployed_app_variant_ == app_variant_db.id:
        #     raise ValueError(
        #         f"Variant {app_variant_db.app.app_name}/{app_variant_db.variant_name} is already deployed to the environment {environment_name}"
        #     )

        # Update the environment with the new variant name
        environment_db.revision += 1  # type: ignore
        environment_db.deployed_app_variant_id = app_variant_db.id
        environment_db.deployed_app_variant_revision_id = app_variant_revision_db.id
        environment_db.deployment_id = deployment.id

        # Create revision for app environment
        await create_environment_revision(
            session,
            environment_db,
            user,
            deployed_app_variant_revision=app_variant_revision_db,
            deployment=deployment,
        )

        await session.commit()


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

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppEnvironmentDB).filter_by(
                app_id=uuid.UUID(app_id), name=environment_name
            )
        )
        app_environment = result.scalars().one_or_none()
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

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantRevisionsDB).filter_by(id=uuid.UUID(variant_revision_id))
        )
        app_revision = result.scalars().one_or_none()
        return app_revision


async def fetch_environment_revisions_for_environment(
    environment: AppEnvironmentDB, **kwargs: dict
):
    """Returns list of app environment revision for the given environment.

    Args:
        environment (AppEnvironmentDB): The app environment to retrieve environments revisions for.
        **kwargs (dict): Additional keyword arguments.

    Returns:
        List[AppEnvironmentRevisionDB]: A list of AppEnvironmentRevisionDB objects.
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppEnvironmentRevisionDB).filter_by(environment_id=environment.id)
        )
        environment_revisions = result.scalars().all()
        return environment_revisions


async def fetch_app_environment_revision(revision_id: str) -> AppEnvironmentRevisionDB:
    """Fetch an app environment revision using the provided revision_id.

    Args:
        revision_id (str): The ID of the revision
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppEnvironmentRevisionDB).filter_by(id=uuid.UUID(revision_id))
        )
        environment_revision = result.scalars().all()
        return environment_revision


async def update_app_environment(
    app_environment: AppEnvironmentDB, values_to_update: dict
):
    """Updates an app environment with the provided values to update.

    Args:
        app_environment (AppEnvironmentDB): the app environment object
        values_to_update (dict): the values to update with
    """

    async with db_engine.get_session() as session:
        for key, value in values_to_update.items():
            if hasattr(app_environment, key):
                setattr(app_environment, key, value)

        await session.commit()
        await session.refresh(app_environment)


async def update_app_environment_deployed_variant_revision(
    app_environment: AppEnvironmentDB, deployed_variant_revision: str
):
    """Updates the deployed variant revision for an app environment

    Args:
        app_environment (AppEnvironment): the app environment object
        deployed_variant_revision (str): the ID of the deployed variant revision
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantRevisionsDB).filter_by(
                id=uuid.UUID(deployed_variant_revision)
            )
        )
        app_variant_revision = result.scalars().one_or_none()
        if app_variant_revision is None:
            raise Exception(
                f"App variant revision {deployed_variant_revision} not found"
            )

        app_environment.deployed_app_variant_revision = app_variant_revision

        await session.commit()
        await session.refresh(app_environment)


async def list_environments(app_id: str, **kwargs: dict):
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

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppEnvironmentDB)
            .options(
                joinedload(AppEnvironmentDB.deployed_app_variant_revision)
                .load_only(
                    AppVariantRevisionsDB.base_id, # type: ignore
                    AppVariantRevisionsDB.revision, # type: ignore
                    AppVariantRevisionsDB.config_name, # type: ignore
                    AppVariantRevisionsDB.config_parameters # type: ignore
                )
            )
            .filter_by(app_id=uuid.UUID(app_id))
        )
        environments_db = result.scalars().all()
        return environments_db


async def initialize_environments(
    session: AsyncSession, app_db: AppDB
) -> List[AppEnvironmentDB]:
    """
    Initializes the environments for the app with the given database.

    Args:
        app_db (AppDB): The database for the app.

    Returns:
        List[AppEnvironmentDB]: A list of the initialized environments.
    """

    environments = []
    for env_name in ["development", "staging", "production"]:
        env = await create_environment(session=session, name=env_name, app_db=app_db)
        environments.append(env)
    return environments


async def create_environment(
    session: AsyncSession, name: str, app_db: AppDB
) -> AppEnvironmentDB:
    """
    Creates a new environment in the database.

    Args:
        name (str): The name of the environment.
        app_db (AppDB): The AppDB object representing the app that the environment belongs to.

    Returns:
        AppEnvironmentDB: The newly created AppEnvironmentDB object.
    """

    environment_db = AppEnvironmentDB(
        app_id=app_db.id, name=name, user_id=app_db.user_id, revision=0
    )

    if isCloudEE():
        environment_db.organization_id = app_db.organization_id
        environment_db.workspace_id = app_db.workspace_id

    session.add(environment_db)
    await session.commit()
    await session.refresh(environment_db)

    return environment_db


async def create_environment_revision(
    session: AsyncSession, environment: AppEnvironmentDB, user: UserDB, **kwargs: dict
):
    """Creates a new environment revision.

    Args:
        environment (AppEnvironmentDB): The environment to create a revision for.
        user (UserDB): The user that made the deployment.
    """

    assert environment is not None, "environment cannot be None"
    assert user is not None, "user cannot be None"

    environment_revision = AppEnvironmentRevisionDB(
        environment_id=environment.id,
        revision=environment.revision,
        modified_by_id=user.id,
    )

    if kwargs:
        assert (
            "deployed_app_variant_revision" in kwargs
        ), "Deployed app variant revision is required"
        assert (
            isinstance(
                kwargs.get("deployed_app_variant_revision"), AppVariantRevisionsDB
            )
            == True
        ), "Type of deployed_app_variant_revision in kwargs is not correct"
        deployed_app_variant_revision = kwargs.get("deployed_app_variant_revision")

        if deployed_app_variant_revision is not None:
            environment_revision.deployed_app_variant_revision_id = (  # type: ignore
                deployed_app_variant_revision.id  # type: ignore
            )

        deployment = kwargs.get("deployment")
        assert (
            isinstance(deployment, DeploymentDB) == True
        ), "Type of deployment in kwargs is not correct"
        if deployment is not None:
            environment_revision.deployment_id = deployment.id  # type: ignore

    if isCloudEE():
        environment_revision.organization_id = environment.organization_id
        environment_revision.workspace_id = environment.workspace_id

    session.add(environment_revision)


async def list_app_variant_revisions_by_variant(
    app_variant: AppVariantDB,
):
    """Returns list of app variant revision for the given app variant

    Args:
        app_variant (AppVariantDB): The app variant to retrieve environments for.

    Returns:
        List[AppVariantRevisionsDB]: A list of AppVariantRevisionsDB objects.
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantRevisionsDB).filter_by(variant_id=app_variant.id)
        )
        app_variant_revisions = result.scalars().all()
        return app_variant_revisions


async def fetch_app_variant_revision(app_variant: str, revision_number: int):
    """Returns list of app variant revision for the given app variant

    Args:
        app_variant (AppVariantDB): The app variant to retrieve environments for.

    Returns:
        List[AppVariantRevisionsDB]: A list of AppVariantRevisionsDB objects.
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantRevisionsDB)
            .options(
                joinedload(AppVariantRevisionsDB.modified_by).load_only(
                    UserDB.username
                )  # type: ignore
            )
            .filter_by(variant_id=uuid.UUID(app_variant), revision=revision_number)
        )
        app_variant_revisions = result.scalars().one_or_none()
        return app_variant_revisions


async def list_environments_by_variant(
    session: AsyncSession,
    app_variant: AppVariantDB,
):
    """
    Returns a list of environments for a given app variant.

    Args:
        session (AsyncSession): the current ongoing session
        app_variant (AppVariantDB): The app variant to retrieve environments for.

    Returns:
        List[AppEnvironmentDB]: A list of AppEnvironmentDB objects.
    """

    result = await session.execute(
        select(AppEnvironmentDB).filter_by(app_id=app_variant.app.id)
    )
    environments_db = result.scalars().all()
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

    async with db_engine.get_session() as session:
        result = await session.execute(select(ImageDB).filter_by(id=image.id))
        image = result.scalars().one_or_none()

        await session.delete(image)
        await session.commit()


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
    async with db_engine.get_session() as session:
        await session.delete(environment_db)
        await session.commit()


async def remove_testsets(testset_ids: List[str]):
    """
    Removes testsets.

    Args:
        testset_ids (List[str]):  The testset identifiers
    """

    async with db_engine.get_session() as session:
        query = select(TestSetDB).where(TestSetDB.id.in_(testset_ids))
        result = await session.execute(query)
        testsets = result.scalars().all()
        for testset in testsets:
            await session.delete(testset)
        await session.commit()


async def remove_app_testsets(app_id: str):
    """Returns a list of testsets owned by an app.

    Args:
        app_id (str): The name of the app

    Returns:
        int: The number of testsets deleted
    """

    # Find testsets owned by the app
    deleted_count: int = 0

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(TestSetDB).filter_by(app_id=uuid.UUID(app_id))
        )
        testsets = result.scalars().all()

        if len(testsets) == 0:
            logger.info(f"No testsets found for app {app_id}")
            return 0

        for testset in testsets:
            await session.delete(testset)
            deleted_count += 1
            logger.info(f"{deleted_count} testset(s) deleted for app {app_id}")

        await session.commit()
        return deleted_count


async def remove_base_from_db(base_id: str):
    """
    Remove a base from the database.

    Args:
        base_id (str): The base to be removed from the database.

    Raises:
        ValueError: If the base is None.

    Returns:
        None
    """

    assert base_id is None, "base_id is required"
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(VariantBaseDB).filter_by(id=uuid.UUID(base_id))
        )
        base = result.scalars().one_or_none()
        if not base:
            raise NoResultFound(f"Base with id {base_id} not found")

        await session.delete(base)
        await session.commit()


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
    async with db_engine.get_session() as session:
        result = await session.execute(select(AppDB).filter_by(id=uuid.UUID(app_id)))
        app_db = result.scalars().one_or_none()
        if not app_db:
            raise NoResultFound(f"App with id {app_id} not found")

        await session.delete(app_db)
        await session.commit()


async def update_variant_parameters(
    app_variant_id: str, parameters: Dict[str, Any], user_uid: str
) -> None:
    """
    Update the parameters of an app variant in the database.

    Args:
        app_variant_id (str): The app variant ID.
        parameters (Dict[str, Any]): The new parameters to set for the app variant.
        user_uid (str): The UID of the user that is updating the app variant.

    Raises:
        NoResultFound: If there is an issue updating the variant parameters.
    """

    user = await get_user(user_uid)
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantDB).filter_by(id=uuid.UUID(app_variant_id))
        )
        app_variant_db = result.scalars().one_or_none()
        if not app_variant_db:
            raise NoResultFound(f"App variant with id {app_variant_id} not found")

        # Update associated ConfigDB parameters
        for key, value in parameters.items():
            if hasattr(app_variant_db.config_parameters, key):
                setattr(app_variant_db.config_parameters, key, value)

        # ...and variant versioning
        app_variant_db.revision += 1  # type: ignore
        app_variant_db.modified_by_id = user.id

        # Save updated ConfigDB
        await session.commit()

        variant_revision = AppVariantRevisionsDB(
            variant_id=app_variant_db.id,
            revision=app_variant_db.revision,
            modified_by_id=user.id,
            base_id=app_variant_db.base_id,
            config_name=app_variant_db.config_name,
            config_parameters=app_variant_db.config_parameters,
        )

        session.add(variant_revision)
        await session.commit()


async def get_app_variant_instance_by_id(variant_id: str) -> AppVariantDB:
    """Get the app variant object from the database with the provided id.

    Arguments:
        variant_id (str): The app variant unique identifier

    Returns:
        AppVariantDB: instance of app variant object
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .options(joinedload(AppVariantDB.base), joinedload(AppVariantDB.app))
            .filter_by(id=uuid.UUID(variant_id))
        )
        app_variant_db = result.scalars().one_or_none()
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

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantRevisionsDB).filter_by(id=uuid.UUID(variant_revision_id))
        )
        variant_revision_db = result.scalars().one_or_none()
        return variant_revision_db


async def fetch_testset_by_id(testset_id: str) -> Optional[TestSetDB]:
    """Fetches a testset by its ID.
    Args:
        testset_id (str): The ID of the testset to fetch.
    Returns:
        TestSetDB: The fetched testset, or None if no testset was found.
    """

    assert testset_id is not None, "testset_id cannot be None"
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(TestSetDB).filter_by(id=uuid.UUID(testset_id))
        )
        testset = result.scalars().one_or_none()
        return testset


async def create_testset(app: AppDB, user_uid: str, testset_data: Dict[str, Any]):
    """
    Creates a testset.

    Args:
        app (AppDB): The app object
        user_uid (str): The user uID
        testset_data (dict): The data of the testset to create with

    Returns:
        returns the newly created TestsetDB
    """

    user = await get_user(user_uid=user_uid)
    async with db_engine.get_session() as session:
        testset_db = TestSetDB(**testset_data, app_id=app.id, user_id=user.id)
        if isCloudEE():
            testset_db.organization_id = app.organization_id
            testset_db.workspace_id = app.workspace_id

        session.add(testset_db)
        await session.commit()
        await session.refresh(testset_db)

        return testset_db


async def update_testset(testset_id: str, values_to_update: dict) -> None:
    """Update a testset.

    Args:
        testset (TestsetDB): the testset object to update
        values_to_update (dict):  The values to update
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(TestSetDB).filter_by(id=uuid.UUID(testset_id))
        )
        testset = result.scalars().one_or_none()

        # Validate keys in values_to_update and update attributes
        valid_keys = [key for key in values_to_update.keys() if hasattr(testset, key)]
        for key in valid_keys:
            setattr(testset, key, values_to_update[key])

        await session.commit()
        await session.refresh(testset)


async def fetch_testsets_by_app_id(app_id: str):
    """Fetches all testsets for a given app.
    Args:
        app_id (str): The ID of the app to fetch testsets for.
    Returns:
        List[TestSetDB]: The fetched testsets.
    """

    assert app_id is not None, "app_id cannot be None"
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(TestSetDB).filter_by(app_id=uuid.UUID(app_id))
        )
        testsets = result.scalars().all()
        return testsets


async def fetch_evaluation_by_id(evaluation_id: str) -> Optional[EvaluationDB]:
    """Fetches a evaluation by its ID.

    Args:
        evaluation_id (str): The ID of the evaluation to fetch.

    Returns:
        EvaluationDB: The fetched evaluation, or None if no evaluation was found.
    """

    assert evaluation_id is not None, "evaluation_id cannot be None"
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(EvaluationDB)
            .options(
                joinedload(EvaluationDB.user).load_only(UserDB.username),  # type: ignore
                joinedload(EvaluationDB.testset).load_only(TestSetDB.id, TestSetDB.name),  # type: ignore
            )
            .filter_by(id=uuid.UUID(evaluation_id))
        )
        evaluation = result.scalars().one_or_none()
        return evaluation


async def list_human_evaluations(app_id: str):
    """
    Fetches human evaluations belonging to an App.

    Args:
        app_id (str):  The application identifier
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(HumanEvaluationDB)
            .options(
                joinedload(HumanEvaluationDB.user).load_only(UserDB.id, UserDB.username),  # type: ignore
                joinedload(HumanEvaluationDB.testset).load_only(TestSetDB.id, TestSetDB.name),  # type: ignore
            )
            .filter_by(app_id=uuid.UUID(app_id))
        )
        human_evaluations = result.scalars().all()
        return human_evaluations


async def create_human_evaluation(
    app: AppDB,
    user_id: str,
    status: str,
    evaluation_type: str,
    testset_id: str,
    variants_ids: List[str],
):
    """
    Creates a human evaluation.

    Args:
        app (AppDB: The app object
        user_id (id): The ID of the user
        status (str): The status of the evaluation
        evaluation_type (str): The evaluation type
        testset_id (str): The ID of the evaluation testset
        variants_ids (List[str]): The IDs of the variants for the evaluation
    """

    async with db_engine.get_session() as session:
        human_evaluation = HumanEvaluationDB(
            app_id=app.id,
            user_id=uuid.UUID(user_id),
            status=status,
            evaluation_type=evaluation_type,
            testset_id=testset_id,
        )
        if isCloudEE():
            human_evaluation.organization_id = str(app.organization_id)
            human_evaluation.workspace_id = str(app.workspace_id)

        session.add(human_evaluation)
        await session.commit()
        await session.refresh(human_evaluation, attribute_names=["testset"])

        # create variants for human evaluation
        await create_human_evaluation_variants(
            human_evaluation_id=str(human_evaluation.id), variants_ids=variants_ids
        )
        return human_evaluation


async def fetch_human_evaluation_variants(human_evaluation_id: str):
    """
    Fetches human evaluation variants.

    Args:
        human_evaluation_id (str): The human evaluation ID

    Returns:
        The human evaluation variants.
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(HumanEvaluationVariantDB)
            .options(
                joinedload(HumanEvaluationVariantDB.variant).load_only(
                    AppVariantDB.id, AppVariantDB.variant_name
                ),  # type: ignore
                joinedload(HumanEvaluationVariantDB.variant_revision).load_only(
                    AppVariantRevisionsDB.revision, AppVariantRevisionsDB.id
                ),  # type: ignore
            )
            .filter_by(human_evaluation_id=uuid.UUID(human_evaluation_id))
        )
        evaluation_variants = result.scalars().all()
        return evaluation_variants


async def create_human_evaluation_variants(
    human_evaluation_id: str, variants_ids: List[str]
):
    """
    Creates human evaluation variants.

    Args:
        human_evaluation_id (str):  The human evaluation identifier
        variants_ids (List[str]):  The variants identifiers
    """

    variants_dict = {}
    for variant_id in variants_ids:
        variant = await fetch_app_variant_by_id(app_variant_id=variant_id)
        if variant:
            variants_dict[variant_id] = variant

    variants_revisions_dict = {}
    for variant_id, variant in variants_dict.items():
        variant_revision = await fetch_app_variant_revision_by_variant(
            app_variant_id=str(variant.id), revision=variant.revision  # type: ignore
        )
        if variant_revision:
            variants_revisions_dict[variant_id] = variant_revision

    if set(variants_dict.keys()) != set(variants_revisions_dict.keys()):
        raise ValueError("Mismatch between variants and their revisions")

    async with db_engine.get_session() as session:
        for variant_id in variants_ids:
            variant = variants_dict[variant_id]
            variant_revision = variants_revisions_dict[variant_id]
            human_evaluation_variant = HumanEvaluationVariantDB(
                human_evaluation_id=uuid.UUID(human_evaluation_id),
                variant_id=variant.id,  # type: ignore
                variant_revision_id=variant_revision.id,  # type: ignore
            )
            session.add(human_evaluation_variant)

        await session.commit()


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
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(HumanEvaluationDB)
            .options(
                joinedload(HumanEvaluationDB.user).load_only(UserDB.username),  # type: ignore
                joinedload(HumanEvaluationDB.testset).load_only(TestSetDB.name),  # type: ignore
            )
            .filter_by(id=uuid.UUID(evaluation_id))
        )
        evaluation = result.scalars().one_or_none()
        return evaluation


async def update_human_evaluation(evaluation_id: str, values_to_update: dict):
    """Updates human evaluation with the specified values.

    Args:
        evaluation_id (str): The evaluation ID
        values_to_update (dict):  The values to update

    Exceptions:
        NoResultFound: if human evaluation is not found
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(HumanEvaluationDB).filter_by(id=uuid.UUID(evaluation_id))
        )
        human_evaluation = result.scalars().one_or_none()
        if not human_evaluation:
            raise NoResultFound(f"Human evaluation with id {evaluation_id} not found")

        for key, value in values_to_update.items():
            if hasattr(human_evaluation, key):
                setattr(human_evaluation, key, value)

        await session.commit()
        await session.refresh(human_evaluation)


async def delete_human_evaluation(evaluation_id: str):
    """Delete the evaluation by its ID.

    Args:
        evaluation_id (str): The ID of the evaluation to delete.
    """

    assert evaluation_id is not None, "evaluation_id cannot be None"
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(HumanEvaluationDB).filter_by(id=uuid.UUID(evaluation_id))
        )
        evaluation = result.scalars().one_or_none()
        if not evaluation:
            raise NoResultFound(f"Human evaluation with id {evaluation_id} not found")

        await session.delete(evaluation)
        await session.commit()


async def create_human_evaluation_scenario(
    inputs: List[HumanEvaluationScenarioInput],
    user_id: str,
    app: AppDB,
    evaluation_id: str,
    evaluation_extend: Dict[str, Any],
):
    """
    Creates a human evaluation scenario.

    Args:
        inputs (List[HumanEvaluationScenarioInput]): The inputs.
        user_id (str): The user ID.
        app (AppDB): The app object.
        evaluation_id (str): The evaluation identifier.
        evaluation_extend (Dict[str, any]): An extended required payload for the evaluation scenario. Contains score, vote, and correct_answer.
    """

    async with db_engine.get_session() as session:
        evaluation_scenario = HumanEvaluationScenarioDB(
            **evaluation_extend,
            user_id=uuid.UUID(user_id),
            evaluation_id=uuid.UUID(evaluation_id),
            inputs=[input.dict() for input in inputs],
            outputs=[],
        )

        if isCloudEE():
            evaluation_scenario.organization_id = str(app.organization_id)
            evaluation_scenario.workspace_id = str(app.workspace_id)

        session.add(evaluation_scenario)
        await session.commit()


async def update_human_evaluation_scenario(
    evaluation_scenario_id: str, values_to_update: dict
):
    """Updates human evaluation scenario with the specified values.

    Args:
        evaluation_scenario_id (str): The evaluation scenario ID
        values_to_update (dict):  The values to update

    Exceptions:
        NoResultFound: if human evaluation scenario is not found
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(HumanEvaluationScenarioDB).filter_by(
                id=uuid.UUID(evaluation_scenario_id)
            )
        )
        human_evaluation_scenario = result.scalars().one_or_none()
        if not human_evaluation_scenario:
            raise NoResultFound(
                f"Human evaluation scenario with id {evaluation_scenario_id} not found"
            )

        for key, value in values_to_update.items():
            if hasattr(human_evaluation_scenario, key):
                setattr(human_evaluation_scenario, key, value)

        await session.commit()
        await session.refresh(human_evaluation_scenario)


async def fetch_human_evaluation_scenarios(evaluation_id: str):
    """
    Fetches human evaluation scenarios.

    Args:
        evaluation_id (str):  The evaluation identifier

    Returns:
        The evaluation scenarios.
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(HumanEvaluationScenarioDB).filter_by(
                evaluation_id=uuid.UUID(evaluation_id)
            )
        )
        evaluation_scenarios = result.scalars().all()
        return evaluation_scenarios


async def fetch_evaluation_scenarios(evaluation_id: str):
    """
    Fetches evaluation scenarios.

    Args:
        evaluation_id (str):  The evaluation identifier

    Returns:
        The evaluation scenarios.
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(EvaluationScenarioDB).filter_by(
                evaluation_id=uuid.UUID(evaluation_id)
            )
        )
        evaluation_scenarios = result.scalars().all()
        return evaluation_scenarios


async def fetch_evaluation_scenario_results(evaluation_scenario_id: str):
    """
    Fetches evaluation scenario results.

    Args:
        evaluation_scenario_id (str):  The evaluation scenario identifier

    Returns:
        The evaluation scenario results.
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(EvaluationScenarioResultDB)
            .options(
                load_only(
                    EvaluationScenarioResultDB.evaluator_config_id,  # type: ignore
                    EvaluationScenarioResultDB.result,  # type: ignore
                )
            )
            .filter_by(evaluation_scenario_id=uuid.UUID(evaluation_scenario_id))
        )
        scenario_results = result.scalars().all()
        return scenario_results


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
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(EvaluationScenarioDB).filter_by(id=uuid.UUID(evaluation_scenario_id))
        )
        evaluation_scenario = result.scalars().one_or_none()
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
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(HumanEvaluationScenarioDB).filter_by(
                id=uuid.UUID(evaluation_scenario_id)
            )
        )
        evaluation_scenario = result.scalars().one_or_none()
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
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(HumanEvaluationScenarioDB).filter_by(
                evaluation_id=evaluation.id  # type: ignore
            )
        )
        human_eval_scenario = result.scalars().one_or_none()
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
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .filter_by(base_id=uuid.UUID(base_id))
            .order_by(AppVariantDB.created_at.desc())
        )
        last_variant = result.scalars().first()
        if not last_variant:
            return None
        return last_variant


async def add_template(**kwargs: dict) -> str:
    """
    Adds a new template to the database.

    Args:
        **kwargs (dict): Keyword arguments containing the template data.

    Returns:
        template_id (str): The Id of the created template.
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(TemplateDB).filter_by(tag_id=kwargs["tag_id"])
        )
        existing_template = result.scalars().one_or_none()

        if existing_template is None:
            db_template = TemplateDB(**kwargs)

            session.add(db_template)
            await session.commit()
            await session.refresh(db_template)

            return str(db_template.id)

        return str(existing_template.id)


async def add_zip_template(key, value):
    """
    Adds a new s3 zip template to the database

    Args:
        session: SQLAlchemy async session
        key: key of the json file
        value (dict): dictionary value of a key

    Returns:
        template_id (Str): The Id of the created template.
    """

    async with db_engine.get_session() as session:
        query = select(TemplateDB).where(TemplateDB.name == key)
        result = await session.execute(query)
        existing_template = result.scalars().first()
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
                await session.delete(existing_template)
                await session.commit()

        # Create a new template
        template_name = key
        title = value.get("name")
        description = value.get("description")
        template_uri = value.get("template_uri")

        template_db_instance = TemplateDB(
            type=TemplateType.ZIP,
            name=template_name,
            title=title,
            description=description,
            template_uri=template_uri,
        )
        session.add(template_db_instance)
        await session.commit()

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
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(TemplateDB).filter_by(id=uuid.UUID(template_id))
        )
        template_db = result.scalars().one_or_none()
        return template_db


async def remove_old_template_from_db(tag_ids: list) -> None:
    """Deletes old templates that are no longer in docker hub.

    Arguments:
        tag_ids -- list of template IDs you want to keep
    """

    async with db_engine.get_session() as session:
        # Fetch all templates with tag_id in tag_ids
        templates = await session.execute(select(TemplateDB))
        templates = templates.scalars().all()

        # Filter templates to delete
        templates_to_delete = [
            template for template in templates if template.tag_id not in tag_ids
        ]

        # Delete each template
        for template in templates_to_delete:
            await session.delete(template)

        # Commit the changes
        await session.commit()


async def get_templates():
    """
    Gets the templates.

    Returns:
        The docker templates to create an LLM app from the UI.
    """

    async with db_engine.get_session() as session:
        result = await session.execute(select(TemplateDB))
        templates = result.scalars().all()
        return converters.templates_db_to_pydantic(templates)  # type: ignore


async def update_base(
    base_id: str,
    **kwargs: dict,
) -> VariantBaseDB:
    """Update the base object in the database with the provided id.

    Arguments:
        base (VariantBaseDB): The base object to update.
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(VariantBaseDB).filter_by(id=uuid.UUID(base_id))
        )
        base = result.scalars().one_or_none()
        for key, value in kwargs.items():
            if hasattr(base, key):
                setattr(base, key, value)

        await session.commit()
        await session.refresh(base)

        return base


async def remove_base(base_db: VariantBaseDB):
    """Delete the base object in the database with the provided id.

    Arguments:
        base (VariantBaseDB): The base object to update.
    """

    async with db_engine.get_session() as session:
        await session.delete(base_db)
        await session.commit()


async def update_app_variant(
    app_variant: AppVariantDB,
    **kwargs: dict,
) -> AppVariantDB:
    """Update the app variant object in the database with the provided id.

    Arguments:
        app_variant (AppVariantDB): The app variant object to update.
    """

    async with db_engine.get_session() as session:
        for key, value in kwargs.items():
            if hasattr(app_variant, key):
                setattr(app_variant, key, value)

        await session.commit()
        await session.refresh(app_variant)
        return app_variant


async def fetch_app_by_name_and_parameters(
    app_name: str,
    user_uid: str,
    organization_id: Optional[str] = None,
    workspace_id: Optional[str] = None,
):
    """Fetch an app by its name, organization id, and workspace_id.

    Args:
        app_name (str): The name of the app
        organization_id (str): The ID of the app organization
        workspace_id (str): The ID of the app workspace

    Returns:
        AppDB: the instance of the app
    """

    async with db_engine.get_session() as session:
        base_query = select(AppDB).filter_by(app_name=app_name)

        if isCloudEE():
            # assert that if organization is provided, workspace_id is also provided, and vice versa
            assert (
                organization_id is not None and workspace_id is not None
            ), "organization_id and workspace_id must be provided together"

            query = base_query.filter_by(
                organization_id=uuid.UUID(organization_id),
                workspace_id=uuid.UUID(workspace_id),
            )
        else:
            query = base_query.join(UserDB).filter(UserDB.uid == user_uid)

        result = await session.execute(query)
        app_db = result.unique().scalars().one_or_none()
        return app_db


async def create_new_evaluation(
    app: AppDB,
    user_id: str,
    testset: TestSetDB,
    status: Result,
    variant: str,
    variant_revision: str,
    organization=None,
    workspace=None,
) -> EvaluationDB:
    """Create a new evaluation scenario.
    Returns:
        EvaluationScenarioDB: The created evaluation scenario.
    """

    async with db_engine.get_session() as session:
        evaluation = EvaluationDB(
            app_id=app.id,
            user_id=uuid.UUID(user_id),
            testset_id=testset.id,
            status=status.dict(),
            variant_id=uuid.UUID(variant),
            variant_revision_id=uuid.UUID(variant_revision),
        )

        if isCloudEE():
            # assert that if organization is provided, workspace is also provided, and vice versa
            assert (
                organization is not None and workspace is not None
            ), "organization and workspace must be provided together"

            evaluation.organization_id = uuid.UUID(organization_id)  # type: ignore
            evaluation.workspace_id = uuid.UUID(workspace_id)  # type: ignore

        session.add(evaluation)
        await session.commit()
        await session.refresh(
            evaluation, attribute_names=["user", "testset", "aggregated_results"]
        )

        return evaluation


async def list_evaluations(app_id: str):
    """Retrieves evaluations of the specified app from the db.

    Args:
        app_id (str): The ID of the app
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(EvaluationDB)
            .options(
                joinedload(EvaluationDB.user).load_only(UserDB.id, UserDB.username),  # type: ignore
                joinedload(EvaluationDB.testset).load_only(TestSetDB.id, TestSetDB.name),  # type: ignore
                joinedload(EvaluationDB.aggregated_results),
            )
            .filter_by(app_id=uuid.UUID(app_id))
        )
        evaluations = result.unique().scalars().all()
        return evaluations


async def fetch_evaluations_by_resource(resource_type: str, resource_ids: List[str]):
    """
    Fetches an evaluations by resource.

    Args:
        resource_type:  The resource type
        resource_ids:   The resource identifiers

    Returns:
        The evaluations by resource.

    Raises:
        HTTPException:400 resource_type {type} is not supported
    """

    ids = list(map(uuid.UUID, resource_ids))

    async with db_engine.get_session() as session:
        if resource_type == "variant":
            query = select(EvaluationDB).filter(EvaluationDB.variant_id.in_(ids))
        elif resource_type == "testset":
            query = select(EvaluationDB).filter(EvaluationDB.testset_id.in_(ids))
        elif resource_type == "evaluator_config":
            query = (
                select(EvaluationDB)
                .join(EvaluationDB.evaluator_configs)
                .filter(EvaluationEvaluatorConfigDB.evaluator_config_id.in_(ids))
            )
        else:
            raise HTTPException(
                status_code=400,
                detail=f"resource_type {resource_type} is not supported",
            )

        result = await session.execute(query)
        res = result.scalars().all()
        return res


async def delete_evaluations(evaluation_ids: List[str]) -> None:
    """Delete evaluations based on the ids provided from the db.

    Args:
        evaluations_ids (list[str]): The IDs of the evaluation
    """

    async with db_engine.get_session() as session:
        query = select(EvaluationDB).where(EvaluationDB.id.in_(evaluation_ids))
        result = await session.execute(query)
        evaluations = result.scalars().all()
        for evaluation in evaluations:
            await session.delete(evaluation)
        await session.commit()


async def create_new_evaluation_scenario(
    user_id: str,
    evaluation: EvaluationDB,
    variant_id: str,
    inputs: List[EvaluationScenarioInput],
    outputs: List[EvaluationScenarioOutput],
    correct_answers: Optional[List[CorrectAnswer]],
    is_pinned: Optional[bool],
    note: Optional[str],
    results: List[EvaluationScenarioResult],
    organization=None,
    workspace=None,
) -> EvaluationScenarioDB:
    """Create a new evaluation scenario.

    Returns:
        EvaluationScenarioDB: The created evaluation scenario.
    """

    async with db_engine.get_session() as session:
        evaluation_scenario = EvaluationScenarioDB(
            user_id=uuid.UUID(user_id),
            evaluation_id=evaluation.id,
            variant_id=uuid.UUID(variant_id),
            inputs=[input.dict() for input in inputs],
            outputs=[output.dict() for output in outputs],
            correct_answers=(
                [correct_answer.dict() for correct_answer in correct_answers]
                if correct_answers is not None
                else []
            ),
            is_pinned=is_pinned,
            note=note,
        )

        if isCloudEE():
            # assert that if organization is provided, workspace is also provided, and vice versa
            assert (
                organization is not None and workspace is not None
            ), "organization and workspace must be provided together"

            evaluation_scenario.organization_id = organization_id  # type: ignore
            evaluation_scenario.workspace_id = workspace_id  # type: ignore

        session.add(evaluation_scenario)
        await session.commit()
        await session.refresh(evaluation_scenario)

        # create evaluation scenario result
        for result in results:
            evaluation_scenario_result = EvaluationScenarioResultDB(
                evaluation_scenario_id=evaluation_scenario.id,
                evaluator_config_id=uuid.UUID(result.evaluator_config),
                result=result.result.dict(),
            )

            session.add(evaluation_scenario_result)

        await session.commit()  # ensures that scenario results insertion is committed
        await session.refresh(evaluation_scenario)

        return evaluation_scenario


async def update_evaluation_with_aggregated_results(
    evaluation_id: str, aggregated_results: List[AggregatedResult]
):
    async with db_engine.get_session() as session:
        for result in aggregated_results:
            aggregated_result = EvaluationAggregatedResultDB(
                evaluation_id=uuid.UUID(evaluation_id),
                evaluator_config_id=uuid.UUID(result.evaluator_config),
                result=result.result.dict(),
            )
            session.add(aggregated_result)

        await session.commit()


async def fetch_eval_aggregated_results(evaluation_id: str):
    """
    Fetches an evaluation aggregated results by evaluation identifier.

    Args:
        evaluation_id (str):  The evaluation identifier

    Returns:
        The evaluation aggregated results by evaluation identifier.
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(EvaluationAggregatedResultDB)
            .options(
                joinedload(EvaluationAggregatedResultDB.evaluator_config).load_only(
                    EvaluatorConfigDB.id,  # type: ignore
                    EvaluatorConfigDB.name,  # type: ignore
                    EvaluatorConfigDB.evaluator_key,  # type: ignore
                    EvaluatorConfigDB.settings_values,  # type: ignore
                    EvaluatorConfigDB.created_at,  # type: ignore
                    EvaluatorConfigDB.updated_at,  # type: ignore
                )
            )
            .filter_by(evaluation_id=uuid.UUID(evaluation_id))
        )
        aggregated_results = result.scalars().all()
        return aggregated_results


async def fetch_evaluators_configs(app_id: str):
    """Fetches a list of evaluator configurations from the database.

    Returns:
        List[EvaluatorConfigDB]: A list of evaluator configuration objects.
    """

    assert app_id is not None, "evaluation_id cannot be None"
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(EvaluatorConfigDB).filter_by(app_id=uuid.UUID(app_id))
        )
        evaluators_configs = result.scalars().all()
        return evaluators_configs


async def fetch_evaluator_config(evaluator_config_id: str):
    """Fetch evaluator configurations from the database.

    Returns:
        EvaluatorConfigDB: the evaluator configuration object.
    """

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(EvaluatorConfigDB).filter_by(id=uuid.UUID(evaluator_config_id))
        )
        evaluator_config = result.scalars().one_or_none()
        return evaluator_config


async def check_if_ai_critique_exists_in_list_of_evaluators_configs(
    evaluators_configs_ids: List[str],
) -> bool:
    """Fetch evaluator configurations from the database.

    Returns:
        EvaluatorConfigDB: the evaluator configuration object.
    """

    async with db_engine.get_session() as session:
        evaluator_config_uuids = [
            uuid.UUID(evaluator_config_id)
            for evaluator_config_id in evaluators_configs_ids
        ]

        query = select(EvaluatorConfigDB).where(
            EvaluatorConfigDB.id.in_(evaluator_config_uuids),
            EvaluatorConfigDB.evaluator_key == "auto_ai_critique",
        )

        result = await session.execute(query)
        evaluators_configs = result.scalars().all()

        return bool(evaluators_configs)


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

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(EvaluatorConfigDB).filter_by(
                app_id=uuid.UUID(app_id), evaluator_key=evaluator_name
            )
        )
        evaluator_config = result.scalars().one_or_none()
        return evaluator_config


async def create_evaluator_config(
    app: AppDB,
    user_id: str,
    name: str,
    evaluator_key: str,
    organization=None,
    workspace=None,
    settings_values: Optional[Dict[str, Any]] = None,
) -> EvaluatorConfigDB:
    """Create a new evaluator configuration in the database."""

    async with db_engine.get_session() as session:
        new_evaluator_config = EvaluatorConfigDB(
            app_id=app.id,
            user_id=uuid.UUID(user_id),
            name=name,
            evaluator_key=evaluator_key,
            settings_values=settings_values,
        )

        if isCloudEE():
            # assert that if organization is provided, workspace is also provided, and vice versa
            assert (
                organization is not None and workspace is not None
            ), "organization and workspace must be provided together"

            new_evaluator_config.organization_id = uuid.UUID(organization)
            new_evaluator_config.workspace_id = uuid.UUID(workspace)

        try:
            session.add(new_evaluator_config)
            await session.commit()
            await session.refresh(new_evaluator_config)

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

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(EvaluatorConfigDB).filter_by(id=uuid.UUID(evaluator_config_id))
        )
        evaluator_config = result.scalars().one_or_none()
        if not evaluator_config:
            raise NoResultFound(
                f"Evaluator config with id {evaluator_config_id} not found"
            )

        for key, value in updates.items():
            if hasattr(evaluator_config.settings_values, key):
                setattr(evaluator_config.settings_values, key, value)

        await session.commit()
        await session.refresh(evaluator_config)

        return evaluator_config


async def delete_evaluator_config(evaluator_config_id: str) -> bool:
    """Delete an evaluator configuration from the database."""

    assert evaluator_config_id is not None, "Evaluator Config ID cannot be None"
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(EvaluatorConfigDB).filter_by(id=uuid.UUID(evaluator_config_id))
        )
        evaluator_config = result.scalars().one_or_none()
        if evaluator_config is None:
            raise NoResultFound(
                f"Evaluator config with id {evaluator_config_id} not found"
            )

        await session.delete(evaluator_config)
        await session.commit()

        return True


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

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(EvaluationDB).filter_by(id=uuid.UUID(evaluation_id))
        )
        evaluation = result.scalars().one_or_none()
        for key, value in updates.items():
            if hasattr(evaluation, key):
                setattr(evaluation, key, value)

        await session.commit()
        await session.refresh(evaluation)

        return evaluation


async def check_if_evaluation_contains_failed_evaluation_scenarios(
    evaluation_id: str,
) -> bool:
    async with db_engine.get_session() as session:
        EvaluationResultAlias = aliased(EvaluationScenarioResultDB)
        query = (
            select(func.count(EvaluationScenarioDB.id))
            .join(EvaluationResultAlias, EvaluationScenarioDB.results)
            .where(
                EvaluationScenarioDB.evaluation_id == uuid.UUID(evaluation_id),
                EvaluationResultAlias.result["type"].astext == "error",
            )
        )

        result = await session.execute(query)
        count = result.scalar()
        if not count:
            return False
        return count > 0

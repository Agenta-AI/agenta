import os
import uuid
import logging
from enum import Enum
from pathlib import Path
from urllib.parse import urlparse
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from sqlalchemy.future import select
from sqlalchemy import func, or_, asc
from sqlalchemy.exc import NoResultFound
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, aliased, load_only

from agenta_backend.models import converters
from agenta_backend.utils.common import isCloudEE
from agenta_backend.services.json_importer_helper import get_json

from agenta_backend.dbs.postgres.shared.engine import engine


if isCloudEE():
    from agenta_backend.commons.services import db_manager_ee
    from agenta_backend.commons.utils.permissions import check_rbac_permission
    from agenta_backend.commons.services.selectors import get_user_org_and_workspace_id

    from agenta_backend.commons.models.db_models import (
        WorkspaceDB,
        AppDB_ as AppDB,
        UserDB_ as UserDB,
        ImageDB_ as ImageDB,
        ProjectDB_ as ProjectDB,
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
        ProjectDB,
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
    IDsMappingDB,
    AppVariantRevisionsDB,
    HumanEvaluationVariantDB,
    EvaluationScenarioResultDB,
    EvaluationEvaluatorConfigDB,
    EvaluationAggregatedResultDB,
)

from agenta_backend.models.shared_models import (
    Result,
    AppType,
    ConfigDB,
    TemplateType,
    CorrectAnswer,
    AggregatedResult,
    EvaluationScenarioResult,
    EvaluationScenarioInput,
    EvaluationScenarioOutput,
    HumanEvaluationScenarioInput,
)


# Define logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Define parent directory
PARENT_DIRECTORY = Path(os.path.dirname(__file__)).parent


async def fetch_project_by_id(
    project_id: str,
) -> ProjectDB:
    async with engine.session() as session:
        project = (
            (
                await session.execute(
                    select(ProjectDB).filter_by(
                        id=uuid.UUID(project_id),
                    )
                )
            )
            .scalars()
            .first()
        )

        return project


async def add_testset_to_app_variant(
    template_name: str, app_name: str, project_id: str
):
    """Add testset to app variant.

    Args:
        template_name (str): The name of the app template image
        app_name (str): The name of the app
        project_id (str): The ID of the project
    """

    async with engine.session() as session:
        try:
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
                    project_id=uuid.UUID(project_id),
                )

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

    async with engine.session() as session:
        result = await session.execute(
            select(ImageDB).filter_by(id=uuid.UUID(image_id))
        )
        image = result.scalars().first()
        return image


async def fetch_app_by_id(app_id: str) -> AppDB:
    """Fetches an app by its ID.

    Args:
        app_id: _description_
    """

    assert app_id is not None, "app_id cannot be None"
    app_uuid = await get_object_uuid(object_id=app_id, table_name="app_db")
    async with engine.session() as session:
        base_query = select(AppDB).filter_by(id=uuid.UUID(app_uuid))
        result = await session.execute(base_query)
        app = result.unique().scalars().first()
        if not app:
            raise NoResultFound(f"No application with ID '{app_uuid}' found")
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
    async with engine.session() as session:
        base_query = select(AppVariantDB).options(
            joinedload(AppVariantDB.app.of_type(AppDB)).load_only(AppDB.id, AppDB.app_name),  # type: ignore
            joinedload(AppVariantDB.base.of_type(VariantBaseDB)).joinedload(VariantBaseDB.deployment.of_type(DeploymentDB)).load_only(DeploymentDB.id, DeploymentDB.uri),  # type: ignore
        )
        if isCloudEE():
            query = base_query.options(
                joinedload(AppVariantDB.image.of_type(ImageDB)).load_only(ImageDB.docker_id, ImageDB.tags),  # type: ignore
            )
        else:
            query = base_query.options(
                joinedload(AppVariantDB.image).load_only(ImageDB.docker_id, ImageDB.tags),  # type: ignore
            )

        result = await session.execute(query.filter_by(id=uuid.UUID(app_variant_id)))
        app_variant = result.scalars().first()
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
    async with engine.session() as session:
        result = await session.execute(
            select(AppVariantDB).filter_by(base_id=uuid.UUID(base_id))
        )
        app_variant = result.scalars().first()
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
    async with engine.session() as session:
        result = await session.execute(
            select(AppVariantDB).filter_by(
                base_id=uuid.UUID(base_id), config_name=config_name
            )
        )
        app_variant = result.scalars().first()
        return app_variant


async def fetch_app_variant_revision_by_variant(
    app_variant_id: str, project_id: str, revision: int
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

    async with engine.session() as session:
        result = await session.execute(
            select(AppVariantRevisionsDB)
            .filter_by(
                variant_id=uuid.UUID(app_variant_id),
                project_id=uuid.UUID(project_id),
                revision=revision,
            )
            .options(
                joinedload(AppVariantRevisionsDB.modified_by.of_type(UserDB)).load_only(
                    UserDB.email, UserDB.username
                )
            )
        )
        app_variant_revision = result.scalars().first()
        if app_variant_revision is None:
            raise Exception(
                f"app variant revision  for app_variant {app_variant_id} and revision {revision} not found"
            )
        return app_variant_revision


async def fetch_app_environment_revision_by_environment(
    app_environment_id: str, project_id: str, revision: int
) -> AppEnvironmentRevisionDB:
    """Fetches app environment revision by environment id and revision

    Args:
        app_environment_id: str
        revision: str

    Returns:
        AppEnvironmentRevisionDB
    """

    assert app_environment_id is not None, "app_environment_id cannot be None"
    assert revision is not None, "revision cannot be None"

    async with engine.session() as session:
        result = await session.execute(
            select(AppEnvironmentRevisionDB).filter_by(
                environment_id=uuid.UUID(app_environment_id),
                project_id=uuid.UUID(project_id),
                revision=revision,
            )
        )
        app_environment_revision = result.scalars().first()
        if app_environment_revision is None:
            raise Exception(
                f"app environment revision  for app_environment {app_environment_id} and revision {revision} not found"
            )
        return app_environment_revision


async def fetch_app_environment_revision_by_version(
    app_environment_id: str, project_id: str, version: str
) -> Tuple[AppEnvironmentRevisionDB, int]:
    """Fetches app environment revision by environment id and revision

    Args:
        app_environment_id: str
        version: str

    Returns:
        AppEnvironmentRevisionDB
    """

    assert app_environment_id is not None, "app_environment_id cannot be None"

    if version and version < 0:
        raise Exception("version cannot be negative")

    elif version and version > 0:
        async with engine.session() as session:
            result = await session.execute(
                select(AppEnvironmentRevisionDB)
                .filter_by(
                    environment_id=uuid.UUID(app_environment_id),
                    project_id=uuid.UUID(project_id),
                )
                .order_by(AppEnvironmentRevisionDB.created_at.asc())
                .limit(1)
                .offset(version - 1)
            )
            app_environment_revision = result.scalars().one_or_none()
            if app_environment_revision is None:
                raise Exception(
                    f"app environment revision  for app_environment {app_environment_id} and revision {version} not found"
                )

            return app_environment_revision, version

    else:
        async with engine.session() as session:
            result = await session.execute(
                select(AppEnvironmentRevisionDB)
                .filter_by(
                    environment_id=uuid.UUID(app_environment_id),
                    project_id=uuid.UUID(project_id),
                )
                .order_by(AppEnvironmentRevisionDB.created_at.desc())
                .limit(1)
            )
            app_environment_revision = result.scalars().one_or_none()
            if app_environment_revision is None:
                raise Exception(
                    f"app environment revision  for app_environment {app_environment_id} and revision {version} not found"
                )

            version = (
                await session.execute(
                    select(func.count())
                    .select_from(AppEnvironmentRevisionDB)
                    .filter_by(
                        environment_id=uuid.UUID(app_environment_id),
                        project_id=uuid.UUID(project_id),
                    )
                )
            ).scalar()

            return app_environment_revision, version


async def fetch_base_by_id(base_id: str) -> Optional[VariantBaseDB]:
    """
    Fetches a base by its ID.

    Args:
        base_id (str): The ID of the base to fetch.

    Returns:
        VariantBaseDB: The fetched base, or None if no base was found.
    """

    assert base_id is not None, "no base_id provided"
    base_uuid = await get_object_uuid(object_id=base_id, table_name="bases")
    async with engine.session() as session:
        result = await session.execute(
            select(VariantBaseDB)
            .options(
                joinedload(VariantBaseDB.image), joinedload(VariantBaseDB.deployment)
            )
            .filter_by(id=uuid.UUID(base_uuid))
        )
        base = result.scalars().first()
        if base is None:
            raise NoResultFound(f"Base with id {base_id} not found")
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

    async with engine.session() as session:
        result = await session.execute(
            select(AppVariantDB).filter_by(
                variant_name=variant_name, app_id=uuid.UUID(app_id)
            )
        )
        app_variant = result.scalars().first()
        return app_variant


async def fetch_app_variant_by_config_name_and_appid(
    config_name: str, app_id: str
) -> AppVariantDB:
    """Fetch an app variant by it's name and app id.

    Args:
        config_name (str): The name of the variant
        app_id (str): The ID of the variant app

    Returns:
        AppVariantDB: the instance of the app variant
    """

    async with engine.session() as session:
        result = await session.execute(
            select(AppVariantDB).filter_by(
                config_name=config_name, app_id=uuid.UUID(app_id)
            )
        )
        app_variant = result.scalars().first()
        return app_variant


async def create_new_variant_base(
    app: AppDB,
    project_id: str,
    base_name: str,
    image: Optional[ImageDB] = None,
) -> VariantBaseDB:
    """Create a new base.
    Args:
        base_name (str): The name of the base.
        image (ImageDB): The image of the base.
        project_id (str): The ID of the project
        app (AppDB): The associated App Object.
    Returns:
        VariantBaseDB: The created base.
    """

    logger.debug(f"Creating new base: {base_name} with image: {image} for app: {app}")
    async with engine.session() as session:
        base = VariantBaseDB(
            app_id=app.id,
            project_id=uuid.UUID(project_id),
            base_name=base_name,
            image_id=image.id if image is not None else None,
        )

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
    project_id: str,
    base: VariantBaseDB,
    config: ConfigDB,
    base_name: str,
    image: Optional[ImageDB] = None,
) -> AppVariantDB:
    """Create a new variant.

    Args:
        variant_name (str): The name of the variant.
        project_id (str): The ID of the project.
        image (ImageDB): The image of the variant.
        base (VariantBaseDB): The base of the variant.
        config (ConfigDB): The config of the variant.
        base_name (str): The name of the variant base.

    Returns:
        AppVariantDB: The created variant.
    """

    assert (
        config.parameters == {}
    ), "Parameters should be empty when calling create_new_app_variant (otherwise revision should not be set to 0)"

    async with engine.session() as session:
        variant = AppVariantDB(
            app_id=app.id,
            project_id=uuid.UUID(project_id),
            modified_by_id=user.id,
            revision=0,
            variant_name=variant_name,
            image_id=image.id if image is not None else None,
            base_id=base.id,
            base_name=base_name,
            config_name=config.config_name,
            config_parameters=config.parameters,
        )

        session.add(variant)

        await session.commit()
        await session.refresh(
            variant,
            attribute_names=[
                "app",
                "image",
                "base",
            ],
        )  # Ensures the app, image, user and base relationship are loaded

        variant_revision = AppVariantRevisionsDB(
            variant_id=variant.id,
            revision=0,
            project_id=uuid.UUID(project_id),
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
    project_id: str,
    deletable: bool,
    template_uri: Optional[str] = None,
    docker_id: Optional[str] = None,
    tags: Optional[str] = None,
) -> ImageDB:
    """Create a new image.
    Args:
        image_type (str): The type of image to create.
        project_id (str): The ID of the project.
        docker_id (str): The ID of the image.
        deletable (bool): Whether the image can be deleted.
        tags (str): The tags of the image.

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

    async with engine.session() as session:
        image = ImageDB(
            deletable=deletable,
            project_id=uuid.UUID(project_id),
        )

        image_types = {"zip": TemplateType.ZIP.value, "image": TemplateType.IMAGE.value}

        image_type_value = image_types.get(image_type)
        if image_type_value is None:
            raise ValueError(f"Invalid image_type: {image_type}")

        image.type = image_type_value  # type: ignore
        if image_type_value == "zip":
            image.template_uri = template_uri  # type: ignore
        else:
            image.tags = tags  # type: ignore
            image.docker_id = docker_id  # type: ignore

        session.add(image)
        await session.commit()
        await session.refresh(image)

        return image


async def create_deployment(
    app_id: str,
    project_id: str,
    uri: str,
    status: str,
    container_name: Optional[str] = "",
    container_id: Optional[str] = "",
) -> DeploymentDB:
    """Create a new deployment.

    Args:
        app (str): The app to create the deployment for.
        project_id (str): The ID of the project to create the deployment for.
        container_name (str): The name of the container.
        container_id (str): The ID of the container.
        uri (str): The URI of the container.
        status (str): The status of the container.

    Returns:
        DeploymentDB: The created deployment.
    """

    async with engine.session() as session:
        try:
            deployment = DeploymentDB(
                app_id=uuid.UUID(app_id),
                project_id=uuid.UUID(project_id),
                container_name=container_name,
                container_id=container_id,
                uri=uri,
                status=status,
            )

            session.add(deployment)
            await session.commit()
            await session.refresh(deployment)

            return deployment

        except Exception as e:
            raise Exception(f"Error while creating deployment: {e}")


async def get_app_type_from_template_id(template_id: Optional[str]) -> Optional[str]:
    """Get the application type from the specified template.

    Args:
        template_id (Optional[str]): The ID of the template

    Returns:
        AppType (Optional[str]): The determined application type. Defaults to None.
    """

    if template_id is None:
        return None

    template_db = await get_template(template_id=template_id)
    if "Completion Prompt" in template_db.title:
        return AppType.COMPLETION_TEMPLATE
    elif "Chat Prompt" in template_db.title:
        return AppType.CHAT_TEMPLATE

    return None


async def get_app_type_from_template_key(template_key: Optional[str]) -> Optional[str]:
    """Get the application type from the specified service.

    Args:
        template_key (Optional[str]): The key of the service

    Returns:
        AppType (Optional[str]): The determined application type. Defaults to None.
    """

    if template_key in [AppType.CHAT_SERVICE, AppType.COMPLETION_SERVICE]:
        return template_key

    return None


async def get_app_type(
    template_id: Optional[str] = None,
    template_key: Optional[str] = None,
) -> str:
    if template_id:
        return await get_app_type_from_template_id(template_id=template_id)

    if template_key:
        return await get_app_type_from_template_key(template_key=template_key)

    return AppType.CUSTOM


async def create_app_and_envs(
    app_name: str,
    template_id: Optional[str] = None,
    template_key: Optional[str] = None,
    project_id: Optional[str] = None,
) -> AppDB:
    """
    Create a new app with the given name and organization ID.

    Args:
        app_name (str): The name of the app to create.
        template_id (str): The ID of the template.
        project_id (str): The ID of the project.

    Returns:
        AppDB: The created app.

    Raises:
        ValueError: If an app with the same name already exists.
    """

    app = await fetch_app_by_name_and_parameters(
        app_name=app_name, project_id=project_id
    )
    if app is not None:
        raise ValueError("App with the same name already exists")

    app_type = await get_app_type(
        template_id=template_id,
        template_key=template_key,
    )

    async with engine.session() as session:
        app = AppDB(
            app_name=app_name, project_id=uuid.UUID(project_id), app_type=app_type
        )

        session.add(app)
        await session.commit()
        await session.refresh(app)

        await initialize_environments(session=session, app_db=app)
        return app


async def update_app(app_id: str, values_to_update: dict) -> None:
    """Update the app in the database.

    Arguments:
        app_id (str): The app id
        values_to_update (dict): The values to update in the app
    """

    async with engine.session() as session:
        result = await session.execute(select(AppDB).filter_by(id=uuid.UUID(app_id)))
        app = result.scalars().first()
        if not app:
            raise NoResultFound(f"App with {app_id} not found")

        # Check if 'app_name' is in the values to update
        if "app_name" in values_to_update:
            new_app_name = values_to_update["app_name"]

            # Check if another app with the same name exists for the user
            existing_app_result = await session.execute(
                select(AppDB)
                .filter(
                    AppDB.project_id == app.project_id
                )  # Assuming 'user_id' exists on the AppDB model
                .filter(AppDB.app_name == new_app_name)
            )
            existing_app = existing_app_result.scalars().first()

            if existing_app:
                raise Exception(
                    f"Cannot update app name to '{new_app_name}' because another app with this name already exists."
                )

        for key, value in values_to_update.items():
            if hasattr(app, key):
                setattr(app, key, value)

        await session.commit()


async def get_deployment_by_id(deployment_id: str) -> DeploymentDB:
    """Get the deployment object from the database with the provided id.

    Arguments:
        deployment_id (str): The deployment id

    Returns:
        DeploymentDB: instance of deployment object
    """

    async with engine.session() as session:
        result = await session.execute(
            select(DeploymentDB).filter_by(id=uuid.UUID(deployment_id))
        )
        deployment = result.scalars().first()
        return deployment


async def get_deployment_by_appid(app_id: str) -> DeploymentDB:
    """Get the deployment object from the database with the provided app id.

    Arguments:
        app_id (str): The app id

    Returns:
        DeploymentDB: instance of deployment object
    """

    async with engine.session() as session:
        result = await session.execute(
            select(DeploymentDB).filter_by(app_id=uuid.UUID(app_id))
        )
        deployment = result.scalars().first()
        logger.debug(f"deployment: {deployment}")
        return deployment


async def list_app_variants_for_app_id(
    app_id: str, project_id: str
) -> List[AppVariantDB]:
    """
    Lists all the app variants from the db

    Args:
        app_name (str): if specified, only returns the variants for the app name
        project_id (str): The ID of the project.

    Returns:
        List[AppVariant]: List of AppVariant objects
    """

    assert app_id is not None, "app_id cannot be None"
    async with engine.session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .filter_by(app_id=uuid.UUID(app_id), project_id=uuid.UUID(project_id))
            .options(joinedload(AppVariantDB.app))
        )
        app_variants = result.scalars().all()
        return app_variants


async def list_app_variants_by_app_slug(
    app_slug: str, project_id: str
) -> List[AppVariantDB]:
    """List all the app variants for the specified app_slug

    Args:
        app_slug (str): The slug of the app
        project_id (str): The ID of the project.

    Returns:
        List[AppVariant]: List of AppVariant objects
    """

    assert app_slug is not None, "app_slug cannot be None"
    app_db = await fetch_app_by_name_and_parameters(
        app_name=app_slug, project_id=project_id
    )
    if app_db is None:
        raise NoResultFound(f"App with name {app_slug} not found.")

    async with engine.session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .filter_by(app_id=app_db.id)
            .options(
                joinedload(AppVariantDB.app),
                load_only(
                    AppVariantDB.id,
                    AppVariantDB.config_name,
                    AppVariantDB.revision,  # type: ignore
                ),
            )
        )
        variants = result.scalars().all()
        return variants


async def fetch_app_variant_by_slug(variant_slug: str, app_id: str) -> AppVariantDB:
    """Fetch an app variant by it's slug name and app id.

    Args:
        variant_name (str): The name of the variant
        app_id (str): The ID of the variant app

    Returns:
        AppVariantDB: the instance of the app variant
    """

    async with engine.session() as session:
        result = await session.execute(
            select(AppVariantDB).filter_by(
                config_name=variant_slug, app_id=uuid.UUID(app_id)
            )
        )
        app_variant = result.scalars().first()
        return app_variant


async def list_bases_for_app_id(app_id: str, base_name: Optional[str] = None):
    """List all the bases for the specified app_id

    Args:
        app_id (str): The ID of the app
        base_name (str): The name of the base

    Returns:
        List[VariantBaseDB]: list of VariantBase objects
    """

    assert app_id is not None, "app_id cannot be None"
    async with engine.session() as session:
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
        base (VariantBaseDB): if specified, only returns the variants for the base

    Returns:
        List[AppVariant]: List of AppVariant objects
    """

    assert base is not None, "base cannot be None"
    async with engine.session() as session:
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

    async with engine.session() as session:
        # NOTE: Backward Compatibility
        # ---------------------------
        # Previously, the user_id field in the api_keys collection in MongoDB used the
        # session_id from SuperTokens in Cloud and  "0" as the uid in OSS.
        # During migration, we changed this to use the actual user ID. Therefore, we have two checks:
        # 1. Check if user_uid is found in the UserDB.uid column.
        # 2. If not found, check if user_uid is found in the UserDB.id column.
        conditions = [UserDB.uid == user_uid]
        if isCloudEE():
            conditions.append(UserDB.id == uuid.UUID(user_uid))

        result = await session.execute(select(UserDB).where(or_(*conditions)))
        user = result.scalars().first()

        if user is None and isCloudEE():
            raise Exception("Please login or signup")

        if user is None and not isCloudEE():
            user_db = UserDB(uid="0")

            session.add(user_db)
            await session.commit()
            await session.refresh(user_db)

            return user_db

        return user


async def get_user_with_uid(user_uid: str):
    """Get the user with the specified uid from the database.

    Arguments:
        user_uid (str): The user unique identifier

    Returns:
        UserDB: instance of user
    """

    # TODO: deprecate use of get_user function and use get_user_with_uid instead.
    user_db = await get_user(user_uid=user_uid)
    return user_db


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

    async with engine.session() as session:
        result = await session.execute(select(UserDB).filter_by(id=uuid.UUID(user_id)))
        user = result.scalars().first()
        if user is None:
            logger.error("Failed to get user with id")
            raise NoResultFound(f"User with id {user_id} not found")
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

    async with engine.session() as session:
        result = await session.execute(select(UserDB).filter_by(email=email))
        user = result.scalars().first()
        return user


async def get_users_by_ids(user_ids: List):
    """
    Retrieve users from the database by their IDs.

    Args:
        user_ids (List): A list of user IDs to retrieve.
    """

    async with engine.session() as session:
        user_uids = [uuid.UUID(user_id) for user_id in user_ids]
        result = await session.execute(select(UserDB).where(UserDB.id.in_(user_uids)))
        users = result.scalars().all()
        return users


async def get_orga_image_instance_by_docker_id(
    docker_id: str, project_id: str
) -> ImageDB:
    """Get the image object from the database with the provided id.

    Arguments:
        docker_id (str): The image id
        project_id (str): The ID of project.

    Returns:
        ImageDB: instance of image object
    """

    async with engine.session() as session:
        query = select(ImageDB).filter_by(
            docker_id=docker_id, project_id=uuid.UUID(project_id)
        )
        result = await session.execute(query)
        image = result.scalars().first()
        return image


async def get_orga_image_instance_by_uri(template_uri: str) -> ImageDB:
    """Get the image object from the database with the provided id.

    Arguments:
        template_uri (url): The image template url

    Returns:
        ImageDB: instance of image object
    """

    parsed_url = urlparse(template_uri)
    if not parsed_url.scheme and not parsed_url.netloc:
        raise ValueError(f"Invalid URL: {template_uri}")

    async with engine.session() as session:
        query = select(ImageDB).filter_by(template_uri=template_uri)
        result = await session.execute(query)
        image = result.scalars().first()
        return image


async def get_app_instance_by_id(app_id: str) -> AppDB:
    """Get the app object from the database with the provided id.

    Arguments:
        app_id (str): The app unique identifier

    Returns:
        AppDB: instance of app object
    """

    async with engine.session() as session:
        result = await session.execute(select(AppDB).filter_by(id=uuid.UUID(app_id)))
        app = result.scalars().first()
        return app


async def add_variant_from_base_and_config(
    base_db: VariantBaseDB,
    new_config_name: str,
    parameters: Dict[str, Any],
    user_uid: str,
    project_id: str,
) -> AppVariantDB:
    """
    Add a new variant to the database based on an existing base and a new configuration.

    Args:
        base_db (VariantBaseDB): The existing base to use as a template for the new variant.
        new_config_name (str): The name of the new configuration to use for the new variant.
        parameters (Dict[str, Any]): The parameters to use for the new configuration.
        user_uid (str): The UID of the user
        project_id (str): The ID of the project

    Returns:
        AppVariantDB: The newly created app variant.
    """

    new_variant_name = f"{base_db.base_name}.{new_config_name}"
    previous_app_variant_db = await find_previous_variant_from_base_id(
        str(base_db.id), project_id
    )
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
    async with engine.session() as session:
        db_app_variant = AppVariantDB(
            app_id=previous_app_variant_db.app_id,
            variant_name=new_variant_name,
            image_id=base_db.image_id,
            modified_by_id=user_db.id,
            revision=1,
            base_name=base_db.base_name,
            project_id=uuid.UUID(project_id),
            base_id=base_db.id,
            config_name=new_config_name,
            config_parameters=parameters,
        )

        session.add(db_app_variant)
        await session.commit()
        await session.refresh(db_app_variant)

        variant_revision = AppVariantRevisionsDB(
            variant_id=db_app_variant.id,
            revision=1,
            modified_by_id=user_db.id,
            project_id=uuid.UUID(project_id),
            base_id=base_db.id,
            config_name=new_config_name,
            config_parameters=parameters,
        )

        session.add(variant_revision)
        await session.commit()
        await session.refresh(variant_revision)

        return db_app_variant


async def list_apps(
    project_id: str,
    app_name: Optional[str] = None,
):
    """
    Lists all the unique app names and their IDs from the database

    Errors:
        JSONResponse: You do not have permission to access this organization; status_code: 403

    Returns:
        List[App]
    """

    if app_name is not None:
        app_db = await fetch_app_by_name_and_parameters(
            app_name=app_name, project_id=project_id
        )
        return [converters.app_db_to_pydantic(app_db)]

    else:
        async with engine.session() as session:
            result = await session.execute(
                select(AppDB).filter_by(project_id=uuid.UUID(project_id))
            )
            apps = result.unique().scalars().all()
            return [converters.app_db_to_pydantic(app) for app in apps]


async def list_app_variants(app_id: str):
    """
    Lists all the app variants from the db

    Args:
        app_name (str): if specified, only returns the variants for the app name
        project_id (str): The ID of the project

    Returns:
        List[AppVariant]: List of AppVariant objects
    """

    app_uuid = await get_object_uuid(object_id=app_id, table_name="app_db")
    async with engine.session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .options(
                joinedload(AppVariantDB.app.of_type(AppDB)).load_only(AppDB.id, AppDB.app_name),  # type: ignore
                joinedload(AppVariantDB.base.of_type(VariantBaseDB)).joinedload(VariantBaseDB.deployment.of_type(DeploymentDB)).load_only(DeploymentDB.uri),  # type: ignore
            )
            .filter_by(app_id=uuid.UUID(app_uuid))
        )
        app_variants = result.scalars().all()
        return app_variants


async def check_is_last_variant_for_image(
    variant_base_id: str, project_id: str
) -> bool:
    """Checks whether the input variant is the sole variant that uses its linked image.

    NOTE: This is a helpful function to determine whether to delete the image when removing a variant. Usually many variants will use the same image (these variants would have been created using the UI). We only delete the image and shutdown the container if the variant is the last one using the image

    Arguments:
        app_variant -- AppVariant to check

    Returns:
        true if it's the last variant, false otherwise
    """

    async with engine.session() as session:
        query = select(AppVariantDB).filter_by(
            base_id=uuid.UUID(variant_base_id), project_id=uuid.UUID(project_id)
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

    async with engine.session() as session:
        result = await session.execute(
            select(DeploymentDB).filter_by(id=uuid.UUID(deployment_id))
        )
        deployment = result.scalars().first()
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

    async with engine.session() as session:
        result = await session.execute(
            select(DeploymentDB).filter_by(app_id=uuid.UUID(app_id))
        )
        environments = result.scalars().all()
        return environments


async def remove_app_variant_from_db(app_variant_db: AppVariantDB, project_id: str):
    """Remove an app variant from the db
    the logic for removing the image is in app_manager.py

    Args:
        app_variant (AppVariantDB): the application variant to remove
        project_id (str): The ID of the project
    """

    logger.debug("Removing app variant")
    assert app_variant_db is not None, "app_variant_db is missing"

    logger.debug("list_app_variants_revisions_by_variant")
    app_variant_revisions = await list_app_variant_revisions_by_variant(
        app_variant_db, project_id
    )

    async with engine.session() as session:
        # Delete all the revisions associated with the variant
        for app_variant_revision in app_variant_revisions:
            await session.delete(app_variant_revision)

        # Delete app variant and commit action to database
        await session.delete(app_variant_db)
        await session.commit()


async def deploy_to_environment(
    environment_name: str, variant_id: str, **user_org_data
) -> Tuple[Optional[str], Optional[int]]:
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
        app_variant_id=variant_id, project_id=str(app_variant_db.project_id), revision=app_variant_db.revision  # type: ignore
    )
    if app_variant_db is None:
        raise ValueError("App variant not found")

    # Retrieve app deployment
    deployment = await get_deployment_by_appid(str(app_variant_db.app_id))

    # Retrieve user
    assert "user_uid" in user_org_data, "User uid is required"
    user = await get_user(user_uid=user_org_data["user_uid"])

    async with engine.session() as session:
        # Find the environment for the given app name and user
        result = await session.execute(
            select(AppEnvironmentDB).filter_by(
                app_id=app_variant_db.app_id,
                project_id=app_variant_db.project_id,
                name=environment_name,
            )
        )
        environment_db = result.scalars().first()
        if environment_db is None:
            raise ValueError(f"Environment {environment_name} not found")

        # Update the environment with the new variant name
        environment_db.revision = app_variant_revision_db.revision  # type: ignore
        environment_db.deployed_app_variant_id = app_variant_db.id
        environment_db.deployed_app_variant_revision_id = app_variant_revision_db.id
        environment_db.deployment_id = deployment.id

        # Create revision for app environment
        await create_environment_revision(
            session,
            environment_db,
            user,
            str(app_variant_db.project_id),
            deployed_app_variant_revision=app_variant_revision_db,
            deployment=deployment,
        )

        await session.commit()

    return environment_db.name, environment_db.revision


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

    async with engine.session() as session:
        query = select(AppEnvironmentDB).filter_by(
            app_id=uuid.UUID(app_id), name=environment_name
        )
        if isCloudEE():
            query = query.options(
                joinedload(AppEnvironmentDB.deployed_app_variant.of_type(AppVariantDB)),  # type: ignore
            )
        result = await session.execute(query)
        app_environment = result.scalars().first()
        return app_environment


async def fetch_app_environment_by_id(
    environment_id: str,
) -> Optional[AppEnvironmentDB]:
    """Fetch an app environment using the provided environment id.

    Args:
        environment_id (str): The ID of the environment

    Returns:
        AppEnvironmentDB: app environment object
    """

    async with engine.session() as session:
        result = await session.execute(
            select(AppEnvironmentDB).filter_by(id=uuid.UUID(environment_id))
        )
        app_environment = result.scalars().one_or_none()
        return app_environment


async def fetch_app_environment_revision_by_app_variant_revision_id(
    app_variant_revision_id: str,
) -> Optional[AppEnvironmentRevisionDB]:
    """Fetch an app environment using the deployed app variant revision id.

    Args:
        app_variant_revision_id (str): The ID of the deployed app variant revision

    Returns:
        AppEnvironmentRevisionDB: app environment object
    """

    async with engine.session() as session:
        query = select(AppEnvironmentRevisionDB).filter_by(
            deployed_app_variant_revision_id=uuid.UUID(app_variant_revision_id),
        )
        if isCloudEE():
            query = query.options(
                joinedload(AppEnvironmentRevisionDB.deployed_app_variant.of_type(AppVariantDB)),  # type: ignore
            )
        result = await session.execute(query)
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

    async with engine.session() as session:
        result = await session.execute(
            select(AppVariantRevisionsDB).filter_by(id=uuid.UUID(variant_revision_id))
        )
        app_revision = result.scalars().first()
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

    async with engine.session() as session:
        query = select(AppEnvironmentRevisionDB).filter_by(
            environment_id=environment.id
        )
        if isCloudEE():
            query = query.options(
                joinedload(AppEnvironmentRevisionDB.modified_by.of_type(UserDB)).load_only(UserDB.username)  # type: ignore
            )

        result = await session.execute(
            query.order_by(asc(AppEnvironmentRevisionDB.created_at))
        )
        environment_revisions = result.scalars().all()
        return environment_revisions


async def fetch_app_environment_revision(revision_id: str) -> AppEnvironmentRevisionDB:
    """Fetch an app environment revision using the provided revision_id.

    Args:
        revision_id (str): The ID of the revision
    """

    async with engine.session() as session:
        result = await session.execute(
            select(AppEnvironmentRevisionDB).filter_by(id=uuid.UUID(revision_id))
        )
        environment_revision = result.scalars().first()
        return environment_revision


async def update_app_environment(
    app_environment: AppEnvironmentDB, values_to_update: dict
):
    """Updates an app environment with the provided values to update.

    Args:
        app_environment (AppEnvironmentDB): the app environment object
        values_to_update (dict): the values to update with
    """

    async with engine.session() as session:
        for key, value in values_to_update.items():
            if hasattr(app_environment, key):
                setattr(app_environment, key, value)

        await session.commit()
        await session.refresh(app_environment)


async def update_app_environment_deployed_variant_revision(
    app_environment_id: str, deployed_variant_revision: str
):
    """Updates the deployed variant revision for an app environment

    Args:
        app_environment_id (str): the app environment ID
        deployed_variant_revision (str): the ID of the deployed variant revision
    """

    async with engine.session() as session:
        result = await session.execute(
            select(AppVariantRevisionsDB).filter_by(
                id=uuid.UUID(deployed_variant_revision)
            )
        )
        app_variant_revision = result.scalars().first()
        if app_variant_revision is None:
            raise Exception(
                f"App variant revision {deployed_variant_revision} not found"
            )

        app_environment_result = await session.execute(
            select(AppEnvironmentDB).filter_by(id=uuid.UUID(app_environment_id))
        )
        app_environment = app_environment_result.scalars().first()
        app_environment.deployed_app_variant_revision_id = app_variant_revision.id  # type: ignore

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

    async with engine.session() as session:
        result = await session.execute(
            select(AppEnvironmentDB)
            .options(
                joinedload(AppEnvironmentDB.deployed_app_variant_revision).load_only(
                    AppVariantRevisionsDB.base_id,  # type: ignore
                    AppVariantRevisionsDB.revision,  # type: ignore
                    AppVariantRevisionsDB.config_name,  # type: ignore
                    AppVariantRevisionsDB.config_parameters,  # type: ignore
                )
            )
            .filter_by(app_id=uuid.UUID(app_id), project_id=app_instance.project_id)
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
        app_id=app_db.id, name=name, project_id=app_db.project_id, revision=0
    )

    session.add(environment_db)
    await session.commit()
    await session.refresh(environment_db)

    return environment_db


async def create_environment_revision(
    session: AsyncSession,
    environment: AppEnvironmentDB,
    user: UserDB,
    project_id: str,
    **kwargs: dict,
):
    """Creates a new environment revision.

    Args:
        environment (AppEnvironmentDB): The environment to create a revision for.
        user (UserDB): The user that made the deployment.
        project_id (str): The ID of the project.
    """

    assert environment is not None, "environment cannot be None"
    assert user is not None, "user cannot be None"

    environment_revision = AppEnvironmentRevisionDB(
        environment_id=environment.id,
        revision=environment.revision,
        modified_by_id=user.id,
        project_id=uuid.UUID(project_id),
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

    session.add(environment_revision)


async def list_app_variant_revisions_by_variant(
    app_variant: AppVariantDB, project_id: str
) -> List[AppVariantRevisionsDB]:
    """Returns list of app variant revisions for the given app variant.

    Args:
        app_variant (AppVariantDB): The app variant to retrieve revisions for.
        project_id (str): The ID of the project.

    Returns:
        List[AppVariantRevisionsDB]: A list of AppVariantRevisionsDB objects.
    """
    async with engine.session() as session:
        base_query = (
            select(AppVariantRevisionsDB)
            .filter_by(variant_id=app_variant.id, project_id=uuid.UUID(project_id))
            .options(
                joinedload(AppVariantRevisionsDB.variant_revision.of_type(AppVariantDB))
                .joinedload(AppVariantDB.app.of_type(AppDB))
                .load_only(AppDB.app_name),
                joinedload(AppVariantRevisionsDB.modified_by.of_type(UserDB)).load_only(
                    UserDB.username, UserDB.email
                ),
            )
        )

        result = await session.execute(base_query)
        app_variant_revisions = result.scalars().all()
        return app_variant_revisions


async def fetch_app_variant_revision(app_variant: str, revision_number: int):
    """Returns list of app variant revision for the given app variant

    Args:
        app_variant (AppVariantDB): The app variant to retrieve environments for.

    Returns:
        List[AppVariantRevisionsDB]: A list of AppVariantRevisionsDB objects.
    """

    async with engine.session() as session:
        base_query = select(AppVariantRevisionsDB).filter_by(
            variant_id=uuid.UUID(app_variant), revision=revision_number
        )
        if isCloudEE():
            query = base_query.options(
                joinedload(AppVariantRevisionsDB.modified_by.of_type(UserDB)).load_only(
                    UserDB.username
                )  # type: ignore
            )
        else:
            query = base_query.options(
                joinedload(AppVariantRevisionsDB.modified_by).load_only(
                    UserDB.username
                )  # type: ignore
            )
        result = await session.execute(query)
        app_variant_revisions = result.scalars().first()
        return app_variant_revisions


async def remove_image(image: ImageDB, project_id: str):
    """
    Removes an image from the database.

    Args:
        image (ImageDB): The image to remove from the database.
        project_id (str): The ID of the project the image belongs to.

    Raises:
        ValueError: If the image is None.

    Returns:
        None
    """

    if image is None:
        raise ValueError("Image is None")

    async with engine.session() as session:
        result = await session.execute(
            select(ImageDB).filter_by(id=image.id, project_id=uuid.UUID(project_id))
        )
        image = result.scalars().first()

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
    async with engine.session() as session:
        await session.delete(environment_db)
        await session.commit()


async def remove_testsets(testset_ids: List[str]):
    """
    Removes testsets.

    Args:
        testset_ids (List[str]):  The testset identifiers
    """

    async with engine.session() as session:
        query = select(TestSetDB).where(TestSetDB.id.in_(testset_ids))
        result = await session.execute(query)
        testsets = result.scalars().all()
        for testset in testsets:
            await session.delete(testset)
        await session.commit()


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
    async with engine.session() as session:
        result = await session.execute(
            select(VariantBaseDB).filter_by(id=uuid.UUID(base_id))
        )
        base = result.scalars().first()
        if not base:
            raise NoResultFound(f"Base with id {base_id} not found")

        await session.delete(base)
        await session.commit()


async def remove_app_by_id(app_id: str, project_id: str):
    """
    Removes an app instance from the database by its ID.

    Args:
        app_id (str): The ID of the app instance to remove.
        project_id (str): The ID of the project.

    Raises:
        AssertionError: If app_id is None or if the app instance could not be found.

    Returns:
        None
    """

    assert app_id is not None, "app_id cannot be None"
    async with engine.session() as session:
        result = await session.execute(
            select(AppDB).filter_by(
                id=uuid.UUID(app_id), project_id=uuid.UUID(project_id)
            )
        )
        app_db = result.scalars().first()
        if not app_db:
            raise NoResultFound(f"App with id {app_id} not found")

        await session.delete(app_db)
        await session.commit()


async def update_variant_parameters(
    app_variant_id: str, parameters: Dict[str, Any], project_id: str, user_uid: str
) -> AppVariantDB:
    """
    Update the parameters of an app variant in the database.

    Args:
        app_variant_id (str): The app variant ID.
        parameters (Dict[str, Any]): The new parameters to set for the app variant.
        project_id (str): The ID of the project.
        user_uid (str): The UID of the user that is updating the app variant.

    Raises:
        NoResultFound: If there is an issue updating the variant parameters.
    """

    user = await get_user(user_uid)
    async with engine.session() as session:
        result = await session.execute(
            select(AppVariantDB).filter_by(
                id=uuid.UUID(app_variant_id), project_id=uuid.UUID(project_id)
            )
        )
        app_variant_db = result.scalars().first()
        if not app_variant_db:
            raise NoResultFound(f"App variant with id {app_variant_id} not found")

        # Update associated ConfigDB parameters
        if parameters == {}:
            app_variant_db.config_parameters = {}
        else:
            app_variant_db.config_parameters.update(parameters)

        # ...and variant versioning
        app_variant_db.revision += 1  # type: ignore
        app_variant_db.modified_by_id = user.id

        # Save updated ConfigDB
        await session.commit()
        await session.refresh(app_variant_db)

        variant_revision = AppVariantRevisionsDB(
            variant_id=app_variant_db.id,
            revision=app_variant_db.revision,
            modified_by_id=user.id,
            project_id=uuid.UUID(project_id),
            base_id=app_variant_db.base_id,
            config_name=app_variant_db.config_name,
            config_parameters=app_variant_db.config_parameters,
        )

        session.add(variant_revision)
        await session.commit()

        return app_variant_db


async def get_app_variant_instance_by_id(
    variant_id: str, project_id: str
) -> AppVariantDB:
    """Get the app variant object from the database with the provided id.

    Arguments:
        variant_id (str): The app variant unique identifier
        project_id (str): The ID of the project

    Returns:
        AppVariantDB: instance of app variant object
    """

    async with engine.session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .options(
                joinedload(AppVariantDB.app.of_type(AppDB)).load_only(AppDB.id, AppDB.app_name),  # type: ignore
                joinedload(AppVariantDB.base.of_type(VariantBaseDB)).joinedload(VariantBaseDB.deployment.of_type(DeploymentDB)).load_only(DeploymentDB.uri),  # type: ignore
            )
            .filter_by(id=uuid.UUID(variant_id), project_id=uuid.UUID(project_id)),
        )
        app_variant_db = result.scalars().first()
        return app_variant_db


async def fetch_testset_by_id(testset_id: str) -> Optional[TestSetDB]:
    """Fetches a testset by its ID.
    Args:
        testset_id (str): The ID of the testset to fetch.
    Returns:
        TestSetDB: The fetched testset, or None if no testset was found.
    """

    if not isinstance(testset_id, str) or not testset_id:
        raise ValueError(f"testset_id {testset_id} must be a non-empty string")

    try:
        testset_uuid = uuid.UUID(testset_id)
    except ValueError as e:
        raise ValueError(f"testset_id {testset_id} is not a valid UUID") from e

    async with engine.session() as session:
        result = await session.execute(select(TestSetDB).filter_by(id=testset_uuid))
        testset = result.scalars().first()
        if not testset:
            raise NoResultFound(f"Testset with id {testset_id} not found")
        return testset


async def create_testset(project_id: str, testset_data: Dict[str, Any]):
    """
    Creates a testset.

    Args:
        app (AppDB): The app object
        project_id (str): The ID of the project
        testset_data (dict): The data of the testset to create with

    Returns:
        returns the newly created TestsetDB
    """

    async with engine.session() as session:
        testset_db = TestSetDB(**testset_data, project_id=uuid.UUID(project_id))

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

    async with engine.session() as session:
        result = await session.execute(
            select(TestSetDB).filter_by(id=uuid.UUID(testset_id))
        )
        testset = result.scalars().first()

        # Validate keys in values_to_update and update attributes
        valid_keys = [key for key in values_to_update.keys() if hasattr(testset, key)]
        for key in valid_keys:
            setattr(testset, key, values_to_update[key])

        await session.commit()
        await session.refresh(testset)


async def fetch_testsets_by_project_id(project_id: str):
    """Fetches all testsets for a given project.

    Args:
        project_id (str): The ID of the project.

    Returns:
        List[TestSetDB]: The fetched testsets.
    """

    async with engine.session() as session:
        result = await session.execute(
            select(TestSetDB).filter_by(project_id=uuid.UUID(project_id))
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
    async with engine.session() as session:
        base_query = select(EvaluationDB).filter_by(id=uuid.UUID(evaluation_id))
        if isCloudEE():
            query = base_query.options(
                joinedload(EvaluationDB.testset.of_type(TestSetDB)).load_only(TestSetDB.id, TestSetDB.name),  # type: ignore
            )
        else:
            query = base_query.options(
                joinedload(EvaluationDB.testset).load_only(TestSetDB.id, TestSetDB.name),  # type: ignore
            )

        result = await session.execute(
            query.options(
                joinedload(EvaluationDB.variant.of_type(AppVariantDB)).load_only(AppVariantDB.id, AppVariantDB.variant_name),  # type: ignore
                joinedload(EvaluationDB.variant_revision.of_type(AppVariantRevisionsDB)).load_only(AppVariantRevisionsDB.revision),  # type: ignore
                joinedload(
                    EvaluationDB.aggregated_results.of_type(
                        EvaluationAggregatedResultDB
                    )
                ).joinedload(EvaluationAggregatedResultDB.evaluator_config),
            )
        )
        evaluation = result.unique().scalars().first()
        return evaluation


async def list_human_evaluations(app_id: str, project_id: str):
    """
    Fetches human evaluations belonging to an App.

    Args:
        app_id (str):  The application identifier
    """

    async with engine.session() as session:
        base_query = (
            select(HumanEvaluationDB)
            .filter_by(app_id=uuid.UUID(app_id), project_id=uuid.UUID(project_id))
            .filter(HumanEvaluationDB.testset_id.isnot(None))
        )
        if isCloudEE():
            query = base_query.options(
                joinedload(HumanEvaluationDB.testset.of_type(TestSetDB)).load_only(TestSetDB.id, TestSetDB.name),  # type: ignore
            )
        else:
            query = base_query.options(
                joinedload(HumanEvaluationDB.testset).load_only(TestSetDB.id, TestSetDB.name),  # type: ignore
            )
        result = await session.execute(query)
        human_evaluations = result.scalars().all()
        return human_evaluations


async def create_human_evaluation(
    app: AppDB,
    status: str,
    evaluation_type: str,
    testset_id: str,
    variants_ids: List[str],
):
    """
    Creates a human evaluation.

    Args:
        app (AppDB: The app object
        status (str): The status of the evaluation
        evaluation_type (str): The evaluation type
        testset_id (str): The ID of the evaluation testset
        variants_ids (List[str]): The IDs of the variants for the evaluation
    """

    async with engine.session() as session:
        human_evaluation = HumanEvaluationDB(
            app_id=app.id,
            project_id=app.project_id,
            status=status,
            evaluation_type=evaluation_type,
            testset_id=testset_id,
        )

        session.add(human_evaluation)
        await session.commit()
        await session.refresh(human_evaluation, attribute_names=["testset"])

        # create variants for human evaluation
        await create_human_evaluation_variants(
            human_evaluation_id=str(human_evaluation.id),
            variants_ids=variants_ids,
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

    async with engine.session() as session:
        base_query = select(HumanEvaluationVariantDB).filter_by(
            human_evaluation_id=uuid.UUID(human_evaluation_id)
        )
        if isCloudEE():
            query = base_query.options(
                joinedload(HumanEvaluationVariantDB.variant.of_type(AppVariantDB)).load_only(AppVariantDB.id, AppVariantDB.variant_name),  # type: ignore
                joinedload(HumanEvaluationVariantDB.variant_revision.of_type(AppVariantRevisionsDB)).load_only(AppVariantRevisionsDB.id, AppVariantRevisionsDB.revision),  # type: ignore
            )
        else:
            query = base_query.options(
                joinedload(HumanEvaluationVariantDB.variant).load_only(
                    AppVariantDB.id, AppVariantDB.variant_name
                ),  # type: ignore
                joinedload(HumanEvaluationVariantDB.variant_revision).load_only(
                    AppVariantRevisionsDB.revision, AppVariantRevisionsDB.id
                ),  # type: ignore
            )
        result = await session.execute(query)
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
        project_id (str): The project ID
    """

    variants_dict = {}
    for variant_id in variants_ids:
        variant = await fetch_app_variant_by_id(app_variant_id=variant_id)
        if variant:
            variants_dict[variant_id] = variant

    variants_revisions_dict = {}
    for variant_id, variant in variants_dict.items():
        variant_revision = await fetch_app_variant_revision_by_variant(
            app_variant_id=str(variant.id), project_id=str(variant.project_id), revision=variant.revision  # type: ignore
        )
        if variant_revision:
            variants_revisions_dict[variant_id] = variant_revision

    if set(variants_dict.keys()) != set(variants_revisions_dict.keys()):
        raise ValueError("Mismatch between variants and their revisions")

    async with engine.session() as session:
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
    """
    Fetches a evaluation by its ID.

    Args:
        evaluation_id (str): The ID of the evaluation to fetch.

    Returns:
        EvaluationDB: The fetched evaluation, or None if no evaluation was found.
    """

    assert evaluation_id is not None, "evaluation_id cannot be None"
    async with engine.session() as session:
        base_query = select(HumanEvaluationDB).filter_by(id=uuid.UUID(evaluation_id))
        if isCloudEE():
            query = base_query.options(
                joinedload(HumanEvaluationDB.testset.of_type(TestSetDB)).load_only(TestSetDB.id, TestSetDB.name),  # type: ignore
            )
        else:
            query = base_query.options(
                joinedload(HumanEvaluationDB.testset).load_only(TestSetDB.id, TestSetDB.name),  # type: ignore
            )
        result = await session.execute(query)
        evaluation = result.scalars().first()
        return evaluation


async def update_human_evaluation(evaluation_id: str, values_to_update: dict):
    """Updates human evaluation with the specified values.

    Args:
        evaluation_id (str): The evaluation ID
        values_to_update (dict):  The values to update

    Exceptions:
        NoResultFound: if human evaluation is not found
    """

    async with engine.session() as session:
        result = await session.execute(
            select(HumanEvaluationDB).filter_by(id=uuid.UUID(evaluation_id))
        )
        human_evaluation = result.scalars().first()
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
    async with engine.session() as session:
        result = await session.execute(
            select(HumanEvaluationDB).filter_by(id=uuid.UUID(evaluation_id))
        )
        evaluation = result.scalars().first()
        if not evaluation:
            raise NoResultFound(f"Human evaluation with id {evaluation_id} not found")

        await session.delete(evaluation)
        await session.commit()


async def create_human_evaluation_scenario(
    inputs: List[HumanEvaluationScenarioInput],
    project_id: str,
    evaluation_id: str,
    evaluation_extend: Dict[str, Any],
):
    """
    Creates a human evaluation scenario.

    Args:
        inputs (List[HumanEvaluationScenarioInput]): The inputs.
        evaluation_id (str): The evaluation identifier.
        evaluation_extend (Dict[str, any]): An extended required payload for the evaluation scenario. Contains score, vote, and correct_answer.
    """

    async with engine.session() as session:
        evaluation_scenario = HumanEvaluationScenarioDB(
            **evaluation_extend,
            project_id=uuid.UUID(project_id),
            evaluation_id=uuid.UUID(evaluation_id),
            inputs=[input.model_dump() for input in inputs],
            outputs=[],
        )

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

    async with engine.session() as session:
        result = await session.execute(
            select(HumanEvaluationScenarioDB).filter_by(
                id=uuid.UUID(evaluation_scenario_id)
            )
        )
        human_evaluation_scenario = result.scalars().first()
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

    async with engine.session() as session:
        result = await session.execute(
            select(HumanEvaluationScenarioDB).filter_by(
                evaluation_id=uuid.UUID(evaluation_id)
            )
        )
        evaluation_scenarios = result.scalars().all()
        return evaluation_scenarios


async def fetch_evaluation_scenarios(evaluation_id: str, project_id: str):
    """
    Fetches evaluation scenarios.

    Args:
        evaluation_id (str):  The evaluation identifier
        project_id (str): The ID of the project

    Returns:
        The evaluation scenarios.
    """

    async with engine.session() as session:
        result = await session.execute(
            select(EvaluationScenarioDB)
            .filter_by(
                evaluation_id=uuid.UUID(evaluation_id), project_id=uuid.UUID(project_id)
            )
            .options(joinedload(EvaluationScenarioDB.results))
        )
        evaluation_scenarios = result.unique().scalars().all()
        return evaluation_scenarios


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
    async with engine.session() as session:
        result = await session.execute(
            select(EvaluationScenarioDB).filter_by(id=uuid.UUID(evaluation_scenario_id))
        )
        evaluation_scenario = result.scalars().first()
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
    async with engine.session() as session:
        result = await session.execute(
            select(HumanEvaluationScenarioDB).filter_by(
                id=uuid.UUID(evaluation_scenario_id)
            )
        )
        evaluation_scenario = result.scalars().first()
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
    async with engine.session() as session:
        result = await session.execute(
            select(HumanEvaluationScenarioDB).filter_by(
                evaluation_id=evaluation.id  # type: ignore
            )
        )
        human_eval_scenario = result.scalars().first()
        return human_eval_scenario


async def find_previous_variant_from_base_id(
    base_id: str, project_id: str
) -> Optional[AppVariantDB]:
    """Find the previous variant from a base id.

    Args:
        base_id (str): The base id to search for.
        project_id (str): The ID of the project.

    Returns:
        Optional[AppVariantDB]: The previous variant, or None if no previous variant was found.
    """

    assert base_id is not None, "base_id cannot be None"
    async with engine.session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .filter_by(base_id=uuid.UUID(base_id), project_id=uuid.UUID(project_id))
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

    async with engine.session() as session:
        conditions = [
            TemplateDB.tag_id == kwargs["tag_id"],
            TemplateDB.name == kwargs["name"],
        ]
        result = await session.execute(select(TemplateDB).where(or_(*conditions)))
        existing_template = result.scalars().first()

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

    async with engine.session() as session:
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
    async with engine.session() as session:
        result = await session.execute(
            select(TemplateDB).filter_by(id=uuid.UUID(template_id))
        )
        template_db = result.scalars().first()
        return template_db


async def remove_old_template_from_db(tag_ids: list) -> None:
    """Deletes old templates that are no longer in docker hub.

    Arguments:
        tag_ids -- list of template IDs you want to keep
    """

    async with engine.session() as session:
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

    async with engine.session() as session:
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

    async with engine.session() as session:
        result = await session.execute(
            select(VariantBaseDB).filter_by(id=uuid.UUID(base_id))
        )
        base = result.scalars().first()
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

    async with engine.session() as session:
        await session.delete(base_db)
        await session.commit()


async def update_app_variant(
    app_variant_id: str,
    **kwargs: dict,
) -> AppVariantDB:
    """Update the app variant object in the database with the provided id.

    Arguments:
        app_variant_id (str): The app variant oIDbject to update.
    """

    async with engine.session() as session:
        result = await session.execute(
            select(AppVariantDB).filter_by(id=uuid.UUID(app_variant_id))
        )
        app_variant = result.scalars().first()
        if not app_variant:
            raise NoResultFound(f"App variant with id {app_variant_id} not found")

        for key, value in kwargs.items():
            if hasattr(app_variant, key):
                setattr(app_variant, key, value)

        await session.commit()
        await session.refresh(
            app_variant,
            attribute_names=[
                "app",
                "image",
                "base",
            ],
        )

        return app_variant


async def fetch_app_by_name_and_parameters(
    app_name: str,
    project_id: Optional[str] = None,
):
    """Fetch an app by its name and project identifier.

    Args:
        app_name (str): The name of the app
        project_id (str, optional): The ID of the project. Defaults to None.

    Returns:
        AppDB: the instance of the app
    """
    if project_id is None:
        raise ValueError("project_id must be provided.")

    async with engine.session() as session:
        query = select(AppDB).filter_by(
            app_name=app_name, project_id=uuid.UUID(project_id)
        )
        result = await session.execute(query)
        app_db = result.unique().scalars().first()
        return app_db


async def create_new_evaluation(
    app: AppDB,
    project_id: str,
    testset: TestSetDB,
    status: Result,
    variant: str,
    variant_revision: str,
) -> EvaluationDB:
    """Create a new evaluation scenario.
    Returns:
        EvaluationScenarioDB: The created evaluation scenario.
    """

    async with engine.session() as session:
        evaluation = EvaluationDB(
            app_id=app.id,
            project_id=uuid.UUID(project_id),
            testset_id=testset.id,
            status=status.model_dump(),
            variant_id=uuid.UUID(variant),
            variant_revision_id=uuid.UUID(variant_revision),
        )

        session.add(evaluation)
        await session.commit()
        await session.refresh(
            evaluation,
            attribute_names=[
                "testset",
                "variant",
                "variant_revision",
                "aggregated_results",
            ],
        )

        return evaluation


async def list_evaluations(app_id: str, project_id: str):
    """Retrieves evaluations of the specified app from the db.

    Args:
        app_id (str): The ID of the app
        project_id (str): The ID of the project
    """

    async with engine.session() as session:
        base_query = select(EvaluationDB).filter_by(
            app_id=uuid.UUID(app_id), project_id=uuid.UUID(project_id)
        )
        if isCloudEE():
            query = base_query.options(
                joinedload(EvaluationDB.testset.of_type(TestSetDB)).load_only(TestSetDB.id, TestSetDB.name),  # type: ignore
            )
        else:
            query = base_query.options(
                joinedload(EvaluationDB.testset).load_only(TestSetDB.id, TestSetDB.name),  # type: ignore
            )

        result = await session.execute(
            query.options(
                joinedload(EvaluationDB.variant.of_type(AppVariantDB)).load_only(AppVariantDB.id, AppVariantDB.variant_name),  # type: ignore
                joinedload(EvaluationDB.variant_revision.of_type(AppVariantRevisionsDB)).load_only(AppVariantRevisionsDB.revision),  # type: ignore
                joinedload(
                    EvaluationDB.aggregated_results.of_type(
                        EvaluationAggregatedResultDB
                    )
                ).joinedload(EvaluationAggregatedResultDB.evaluator_config),
            )
        )
        evaluations = result.unique().scalars().all()
        return evaluations


async def fetch_evaluations_by_resource(
    resource_type: str, project_id: str, resource_ids: List[str]
):
    """
    Fetches an evaluations by resource.

    Args:
        resource_type (str):  The resource type
        project_id (str): The ID of the project
        resource_ids (List[str]):   The resource identifiers

    Returns:
        The evaluations by resource.

    Raises:
        HTTPException:400 resource_type {type} is not supported
    """

    ids = list(map(uuid.UUID, resource_ids))

    async with engine.session() as session:
        if resource_type == "variant":
            result_evaluations = await session.execute(
                select(EvaluationDB)
                .filter(
                    EvaluationDB.variant_id.in_(ids),
                    EvaluationDB.project_id == uuid.UUID(project_id),
                )
                .options(load_only(EvaluationDB.id))  # type: ignore
            )
            result_human_evaluations = await session.execute(
                select(HumanEvaluationDB)
                .join(HumanEvaluationVariantDB)
                .filter(
                    HumanEvaluationVariantDB.variant_id.in_(ids),
                    HumanEvaluationDB.project_id == uuid.UUID(project_id),
                )
                .options(load_only(HumanEvaluationDB.id))  # type: ignore
            )
            res_evaluations = result_evaluations.scalars().all()
            res_human_evaluations = result_human_evaluations.scalars().all()
            return res_evaluations + res_human_evaluations

        elif resource_type == "testset":
            result_evaluations = await session.execute(
                select(EvaluationDB)
                .filter(
                    EvaluationDB.testset_id.in_(ids),
                    EvaluationDB.project_id == uuid.UUID(project_id),
                )
                .options(load_only(EvaluationDB.id))  # type: ignore
            )
            result_human_evaluations = await session.execute(
                select(HumanEvaluationDB)
                .filter(
                    HumanEvaluationDB.testset_id.in_(ids),
                    HumanEvaluationDB.project_id
                    == uuid.UUID(project_id),  # Fixed to match HumanEvaluationDB
                )
                .options(load_only(HumanEvaluationDB.id))  # type: ignore
            )
            res_evaluations = result_evaluations.scalars().all()
            res_human_evaluations = result_human_evaluations.scalars().all()
            return res_evaluations + res_human_evaluations

        elif resource_type == "evaluator_config":
            query = (
                select(EvaluationDB)
                .join(EvaluationDB.evaluator_configs)
                .filter(
                    EvaluationEvaluatorConfigDB.evaluator_config_id.in_(ids),
                    EvaluationDB.project_id == uuid.UUID(project_id),
                )
            )
            result = await session.execute(query)
            res = result.scalars().all()
            return res

        raise HTTPException(
            status_code=400,
            detail=f"resource_type {resource_type} is not supported",
        )


async def delete_evaluations(evaluation_ids: List[str]) -> None:
    """Delete evaluations based on the ids provided from the db.

    Args:
        evaluations_ids (list[str]): The IDs of the evaluation
    """

    async with engine.session() as session:
        query = select(EvaluationDB).where(EvaluationDB.id.in_(evaluation_ids))
        result = await session.execute(query)
        evaluations = result.scalars().all()
        for evaluation in evaluations:
            await session.delete(evaluation)
        await session.commit()


async def create_new_evaluation_scenario(
    project_id: str,
    evaluation_id: str,
    variant_id: str,
    inputs: List[EvaluationScenarioInput],
    outputs: List[EvaluationScenarioOutput],
    correct_answers: Optional[List[CorrectAnswer]],
    is_pinned: Optional[bool],
    note: Optional[str],
    results: List[EvaluationScenarioResult],
) -> EvaluationScenarioDB:
    """Create a new evaluation scenario.

    Returns:
        EvaluationScenarioDB: The created evaluation scenario.
    """

    async with engine.session() as session:
        evaluation_scenario = EvaluationScenarioDB(
            project_id=uuid.UUID(project_id),
            evaluation_id=uuid.UUID(evaluation_id),
            variant_id=uuid.UUID(variant_id),
            inputs=[input.model_dump() for input in inputs],
            outputs=[output.model_dump() for output in outputs],
            correct_answers=(
                [correct_answer.model_dump() for correct_answer in correct_answers]
                if correct_answers is not None
                else []
            ),
            is_pinned=is_pinned,
            note=note,
        )

        session.add(evaluation_scenario)
        await session.commit()
        await session.refresh(evaluation_scenario)

        # create evaluation scenario result
        for result in results:
            evaluation_scenario_result = EvaluationScenarioResultDB(
                evaluation_scenario_id=evaluation_scenario.id,
                evaluator_config_id=uuid.UUID(result.evaluator_config),
                result=result.result.model_dump(),
            )

            session.add(evaluation_scenario_result)

        await session.commit()  # ensures that scenario results insertion is committed
        await session.refresh(evaluation_scenario)

        return evaluation_scenario


async def update_evaluation_with_aggregated_results(
    evaluation_id: str, aggregated_results: List[AggregatedResult]
):
    async with engine.session() as session:
        for result in aggregated_results:
            aggregated_result = EvaluationAggregatedResultDB(
                evaluation_id=uuid.UUID(evaluation_id),
                evaluator_config_id=uuid.UUID(result.evaluator_config),
                result=result.result.model_dump(),
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

    async with engine.session() as session:
        base_query = select(EvaluationAggregatedResultDB).filter_by(
            evaluation_id=uuid.UUID(evaluation_id)
        )
        if isCloudEE():
            query = base_query.options(
                joinedload(
                    EvaluationAggregatedResultDB.evaluator_config.of_type(
                        EvaluatorConfigDB
                    )
                ).load_only(
                    EvaluatorConfigDB.id,  # type: ignore
                    EvaluatorConfigDB.name,  # type: ignore
                    EvaluatorConfigDB.evaluator_key,  # type: ignore
                    EvaluatorConfigDB.settings_values,  # type: ignore
                    EvaluatorConfigDB.created_at,  # type: ignore
                    EvaluatorConfigDB.updated_at,  # type: ignore
                )
            )
        else:
            query = base_query.options(
                joinedload(EvaluationAggregatedResultDB.evaluator_config).load_only(
                    EvaluatorConfigDB.id,  # type: ignore
                    EvaluatorConfigDB.name,  # type: ignore
                    EvaluatorConfigDB.evaluator_key,  # type: ignore
                    EvaluatorConfigDB.settings_values,  # type: ignore
                    EvaluatorConfigDB.created_at,  # type: ignore
                    EvaluatorConfigDB.updated_at,  # type: ignore
                )
            )

        result = await session.execute(query)
        aggregated_results = result.scalars().all()
        return aggregated_results


async def fetch_evaluators_configs(project_id: str):
    """Fetches a list of evaluator configurations from the database.

    Returns:
        List[EvaluatorConfigDB]: A list of evaluator configuration objects.
    """

    async with engine.session() as session:
        result = await session.execute(
            select(EvaluatorConfigDB).filter_by(project_id=uuid.UUID(project_id))
        )
        evaluators_configs = result.scalars().all()
        return evaluators_configs


async def fetch_evaluator_config(evaluator_config_id: str):
    """Fetch evaluator configurations from the database.

    Args:
        evaluator_config_id (str): The ID of the evaluator configuration.

    Returns:
        EvaluatorConfigDB: the evaluator configuration object.
    """

    async with engine.session() as session:
        result = await session.execute(
            select(EvaluatorConfigDB).filter_by(id=uuid.UUID(evaluator_config_id))
        )
        evaluator_config = result.scalars().first()
        return evaluator_config


async def check_if_evaluators_exist_in_list_of_evaluators_configs(
    evaluators_configs_ids: List[str], evaluators_keys: List[str]
) -> bool:
    """Check if the provided evaluators exist in the database within the given evaluator configurations.

    Arguments:
        evaluators_configs_ids (List[str]): List of evaluator configuration IDs to search within.
        evaluators_keys (List[str]): List of evaluator keys to check for existence.

    Returns:
        bool: True if all evaluators exist, False otherwise.
    """

    async with engine.session() as session:
        evaluator_config_uuids = [
            uuid.UUID(evaluator_config_id)
            for evaluator_config_id in evaluators_configs_ids
        ]

        query = select(EvaluatorConfigDB.id, EvaluatorConfigDB.evaluator_key).where(
            EvaluatorConfigDB.id.in_(evaluator_config_uuids),
            EvaluatorConfigDB.evaluator_key.in_(evaluators_keys),
        )
        result = await session.execute(query)

        # NOTE: result.all() returns the records as a list of tuples
        # 0 is the evaluator_id and 1 is evaluator_key
        fetched_evaluators_keys = {config[1] for config in result.all()}

        # Ensure the passed evaluators are found in the fetched evaluator keys
        return any(key in fetched_evaluators_keys for key in evaluators_keys)


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

    async with engine.session() as session:
        result = await session.execute(
            select(EvaluatorConfigDB).filter_by(
                app_id=uuid.UUID(app_id), evaluator_key=evaluator_name
            )
        )
        evaluator_config = result.scalars().first()
        return evaluator_config


async def create_evaluator_config(
    project_id: str,
    name: str,
    evaluator_key: str,
    app_name: Optional[str] = None,
    settings_values: Optional[Dict[str, Any]] = None,
) -> EvaluatorConfigDB:
    """Create a new evaluator configuration in the database."""

    async with engine.session() as session:
        name_suffix = f" ({app_name})" if app_name else ""
        new_evaluator_config = EvaluatorConfigDB(
            project_id=uuid.UUID(project_id),
            name=f"{name}{name_suffix}",
            evaluator_key=evaluator_key,
            settings_values=settings_values,
        )

        session.add(new_evaluator_config)
        await session.commit()
        await session.refresh(new_evaluator_config)

        return new_evaluator_config


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

    async with engine.session() as session:
        result = await session.execute(
            select(EvaluatorConfigDB).filter_by(id=uuid.UUID(evaluator_config_id))
        )
        evaluator_config = result.scalars().first()
        if not evaluator_config:
            raise NoResultFound(
                f"Evaluator config with id {evaluator_config_id} not found"
            )

        # Update evaluator config settings values
        for key, value in updates.items():
            if hasattr(evaluator_config, key):
                setattr(evaluator_config, key, value)

        await session.commit()
        await session.refresh(evaluator_config)

        return evaluator_config


async def delete_evaluator_config(evaluator_config_id: str) -> bool:
    """Delete an evaluator configuration from the database."""

    assert evaluator_config_id is not None, "Evaluator Config ID cannot be None"
    async with engine.session() as session:
        result = await session.execute(
            select(EvaluatorConfigDB).filter_by(id=uuid.UUID(evaluator_config_id))
        )
        evaluator_config = result.scalars().first()
        if evaluator_config is None:
            raise NoResultFound(
                f"Evaluator config with id {evaluator_config_id} not found"
            )

        await session.delete(evaluator_config)
        await session.commit()

        return True


async def update_evaluation(
    evaluation_id: str, project_id: str, updates: Dict[str, Any]
) -> EvaluationDB:
    """
    Update an evaluator configuration in the database with the provided id.

    Arguments:
        evaluation_id (str): The ID of the evaluator configuration to be updated.
        project_id (str): The ID of the project.
        updates (Dict[str, Any]): The updates to apply to the evaluator configuration.

    Returns:
        EvaluatorConfigDB: The updated evaluator configuration object.
    """

    async with engine.session() as session:
        result = await session.execute(
            select(EvaluationDB).filter_by(
                id=uuid.UUID(evaluation_id), project_id=uuid.UUID(project_id)
            )
        )
        evaluation = result.scalars().first()
        for key, value in updates.items():
            if hasattr(evaluation, key):
                setattr(evaluation, key, value)

        await session.commit()
        await session.refresh(evaluation)

        return evaluation


async def check_if_evaluation_contains_failed_evaluation_scenarios(
    evaluation_id: str,
) -> bool:
    async with engine.session() as session:
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


async def get_object_uuid(object_id: str, table_name: str) -> str:
    """
    Checks if the given object_id is a valid MongoDB ObjectId and fetches the corresponding
    UUID from the specified table. If the object_id is not a valid ObjectId, it is assumed
    to be a PostgreSQL UUID and returned as is.
    Args:
        object_id (str): The ID of the object, which could be a MongoDB ObjectId or a PostgreSQL UUID.
        table_name (str): The name of the table to fetch the UUID from.
    Returns:
        str: The corresponding object UUID.
    Raises:
        AssertionError: If the resulting object UUID is None.
    """

    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        # Ensure the object_id is a valid MongoDB ObjectId
        if isinstance(ObjectId(object_id), ObjectId):
            object_uuid_as_str = await fetch_corresponding_object_uuid(
                table_name=table_name, object_id=object_id
            )
    except InvalidId:
        # Use the object_id directly if it is not a valid MongoDB ObjectId
        object_uuid_as_str = object_id

    assert (
        object_uuid_as_str is not None
    ), f"{table_name} Object UUID cannot be none. Is the object_id {object_id} a valid MongoDB ObjectId?"
    return object_uuid_as_str


async def fetch_corresponding_object_uuid(table_name: str, object_id: str) -> str:
    """
    Fetches a corresponding object uuid.
    Args:
        table_name (str):  The table name
        object_id (str):   The object identifier
    Returns:
        The corresponding object uuid as string.
    """

    async with engine.session() as session:
        result = await session.execute(
            select(IDsMappingDB).filter_by(table_name=table_name, objectid=object_id)
        )
        object_mapping = result.scalars().first()
        return str(object_mapping.uuid)


async def fetch_default_project() -> ProjectDB:
    """
    Fetch the default project from the database.
    Returns:
        ProjectDB: The default project instance.
    """

    async with engine.session() as session:
        result = await session.execute(select(ProjectDB).filter_by(is_default=True))
        default_project = result.scalars().first()
        return default_project

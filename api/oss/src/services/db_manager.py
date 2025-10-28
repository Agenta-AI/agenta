import os
import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from json import dumps

from fastapi import HTTPException
from sqlalchemy.future import select
from sqlalchemy import func, or_, asc
from sqlalchemy.ext.asyncio import AsyncSession
from supertokens_python.types import AccountInfo
from sqlalchemy.orm import joinedload, load_only, selectinload
from sqlalchemy.exc import NoResultFound, MultipleResultsFound, SQLAlchemyError
from supertokens_python.asyncio import list_users_by_account_info
from supertokens_python.asyncio import delete_user as delete_user_from_supertokens

from oss.src.utils.logging import get_module_logger
from oss.src.models import converters
from oss.src.services import user_service
from oss.src.utils.common import is_ee
from oss.src.dbs.postgres.shared.engine import engine
from oss.src.services.json_importer_helper import get_json


if is_ee():
    from ee.src.models.db_models import ProjectDB, WorkspaceDB
else:
    from oss.src.models.db_models import ProjectDB, WorkspaceDB

from oss.src.models.db_models import (
    AppDB,
    UserDB,
    APIKeyDB,
    TestSetDB,
    IDsMappingDB,
    DeploymentDB,
    InvitationDB,
    AppVariantDB,
    VariantBaseDB,
    OrganizationDB,
    AppEnvironmentDB,
    EvaluatorConfigDB,
    AppVariantRevisionsDB,
    AppEnvironmentRevisionDB,
)
from oss.src.models.shared_models import (
    AppType,
    ConfigDB,
)


log = get_module_logger(__name__)

# Define parent directory
PARENT_DIRECTORY = Path(os.path.dirname(__file__)).parent


async def fetch_project_by_id(
    project_id: str,
) -> Optional[ProjectDB]:
    async with engine.core_session() as session:
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


async def fetch_workspace_by_id(
    workspace_id: str,
) -> Optional[WorkspaceDB]:
    async with engine.core_session() as session:
        workspace = (
            (
                await session.execute(
                    select(WorkspaceDB).filter_by(
                        id=uuid.UUID(workspace_id),
                    )
                )
            )
            .scalars()
            .first()
        )

        return workspace


async def fetch_organization_by_id(
    organization_id: str,
) -> Optional[OrganizationDB]:
    async with engine.core_session() as session:
        organization = (
            (
                await session.execute(
                    select(OrganizationDB).filter_by(
                        id=uuid.UUID(organization_id),
                    )
                )
            )
            .scalars()
            .first()
        )

        return organization


async def add_testset_to_app_variant(
    template_name: str, app_name: str, project_id: str
):
    """Add testset to app variant.

    Args:
        template_name (str): The name of the app template name
        app_name (str): The name of the app
        project_id (str): The ID of the project
    """

    async with engine.core_session() as session:
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
            log.error(f"An error occurred in adding the default testset: {e}")


async def fetch_app_by_id(app_id: str) -> AppDB:
    """Fetches an app by its ID.

    Args:
        app_id: _description_
    """

    assert app_id is not None, "app_id cannot be None"
    app_uuid = await get_object_uuid(object_id=app_id, table_name="app_db")
    async with engine.core_session() as session:
        base_query = select(AppDB).filter_by(id=uuid.UUID(app_uuid))
        result = await session.execute(base_query)
        app = result.unique().scalars().first()
        if not app:
            raise NoResultFound(f"No application with ID '{app_uuid}' found")
        return app


async def fetch_latest_app_variant(app_id: str) -> Optional[AppVariantDB]:
    """Fetches the latest app variant for a given app ID.

    Args:
        app_id (str): The ID of the app to fetch the latest variant for.

    Returns:
        AppVariantDB: The latest app variant, or None if no app variant was found.
    """

    async with engine.core_session() as session:
        base_query = (
            select(AppVariantDB)
            .filter_by(app_id=uuid.UUID(app_id))
            .order_by(AppVariantDB.created_at.desc())
        )
        result = await session.execute(base_query)
        app_variant = result.scalars().first()
        return app_variant


async def fetch_app_variant_by_id(app_variant_id: str) -> Optional[AppVariantDB]:
    """
    Fetches an app variant by its ID.

    Args:
        app_variant_id (str): The ID of the app variant to fetch.

    Returns:
        AppVariantDB: The fetched app variant, or None if no app variant was found.
    """

    assert app_variant_id is not None, "app_variant_id cannot be None"
    async with engine.core_session() as session:
        query = select(AppVariantDB).options(
            joinedload(AppVariantDB.app.of_type(AppDB)).load_only(AppDB.id, AppDB.app_name),  # type: ignore
            joinedload(AppVariantDB.base.of_type(VariantBaseDB)).joinedload(VariantBaseDB.deployment.of_type(DeploymentDB)).load_only(DeploymentDB.id, DeploymentDB.uri),  # type: ignore
        )

        result = await session.execute(
            query.where(AppVariantDB.hidden.is_not(True)).filter_by(
                id=uuid.UUID(app_variant_id)
            )
        )
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
    async with engine.core_session() as session:
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
    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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
        async with engine.core_session() as session:
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
        async with engine.core_session() as session:
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
    async with engine.core_session() as session:
        result = await session.execute(
            select(VariantBaseDB)
            .options(joinedload(VariantBaseDB.deployment))
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

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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
) -> VariantBaseDB:
    """Create a new base.
    Args:
        base_name (str): The name of the base.
        project_id (str): The ID of the project
        app (AppDB): The associated App Object.
    Returns:
        VariantBaseDB: The created base.
    """

    async with engine.core_session() as session:
        base = VariantBaseDB(
            app_id=app.id,
            project_id=uuid.UUID(project_id),
            base_name=base_name,
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
    commit_message: Optional[str] = None,
) -> AppVariantDB:
    """Create a new variant.

    Args:
        variant_name (str): The name of the variant.
        project_id (str): The ID of the project.
        base (VariantBaseDB): The base of the variant.
        config (ConfigDB): The config of the variant.
        base_name (str): The name of the variant base.
        commit_message (Optional[str]): The commit message for the new variant.

    Returns:
        AppVariantDB: The created variant.
    """

    assert (
        config.parameters == {}
    ), "Parameters should be empty when calling create_new_app_variant (otherwise revision should not be set to 0)"

    async with engine.core_session() as session:
        variant = AppVariantDB(
            app_id=app.id,
            project_id=uuid.UUID(project_id),
            modified_by_id=user.id,
            revision=0,
            variant_name=variant_name,
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
                "base",
            ],
        )  # Ensures the app, user and base relationship are loaded

        variant_revision = AppVariantRevisionsDB(
            variant_id=variant.id,
            revision=0,
            commit_message=commit_message,
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


async def create_deployment(
    app_id: str,
    project_id: str,
    uri: str,
) -> DeploymentDB:
    """Create a new deployment.

    Args:
        app (str): The app to create the deployment for.
        project_id (str): The ID of the project to create the deployment for.
        uri (str): The URI of the service.

    Returns:
        DeploymentDB: The created deployment.
    """

    async with engine.core_session() as session:
        try:
            deployment = DeploymentDB(
                app_id=uuid.UUID(app_id),
                project_id=uuid.UUID(project_id),
                uri=uri,
            )

            session.add(deployment)
            await session.commit()
            await session.refresh(deployment)

            return deployment

        except Exception as e:
            raise Exception(f"Error while creating deployment: {e}")


async def get_app_type_from_template_key(template_key: Optional[str]) -> Optional[str]:
    """Get the application type from the specified service.

    Args:
        template_key (Optional[str]): The key of the service

    Returns:
        AppType (Optional[str]): The determined application type. Defaults to None.
    """

    if template_key in [
        AppType.CHAT_SERVICE,
        AppType.COMPLETION_SERVICE,
        AppType.CUSTOM,
    ]:
        return template_key

    return None


async def get_app_type(
    template_key: Optional[str] = None,
) -> str:
    if template_key:
        return await get_app_type_from_template_key(template_key=template_key)

    return AppType.CUSTOM


async def create_app_and_envs(
    app_name: str,
    template_key: Optional[str] = None,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> AppDB:
    """
    Create a new app with the given name and organization ID.

    Args:
        app_name (str): The name of the app to create.
        project_id (str): The ID of the project.

    Returns:
        AppDB: The created app.

    Raises:
        ValueError: If an app with the same name already exists.
    """

    app = await fetch_app_by_name_and_parameters(
        app_name=app_name,
        project_id=project_id,
    )
    if app is not None:
        raise ValueError("App with the same name already exists")

    app_type = await get_app_type(
        template_key=template_key,
    )

    async with engine.core_session() as session:
        app = AppDB(
            project_id=uuid.UUID(project_id),
            app_name=app_name,
            app_type=app_type,
            modified_by_id=uuid.UUID(user_id) if user_id else None,
        )

        session.add(app)
        await session.commit()
        await session.refresh(app)

        await initialize_environments(session=session, app_db=app)
        return app


async def update_app(app_id: str, values_to_update: dict):
    """Update the app in the database.

    Arguments:
        app_id (str): The app id
        values_to_update (dict): The values to update in the app
    """

    async with engine.core_session() as session:
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
        return app


async def get_deployment_by_id(deployment_id: str) -> DeploymentDB:
    """Get the deployment object from the database with the provided id.

    Arguments:
        deployment_id (str): The deployment id

    Returns:
        DeploymentDB: instance of deployment object
    """

    try:
        deployment_uuid = uuid.UUID(deployment_id)
    except ValueError as e:
        log.error(f"Invalid deployment_id '{deployment_id}': {e}")
        return None

    try:
        async with engine.core_session() as session:
            result = await session.execute(
                select(DeploymentDB).filter_by(id=deployment_uuid)
            )
            deployment = result.scalars().first()
            return deployment
    except SQLAlchemyError as e:
        log.error(f"Database error while fetching deployment {deployment_id}: {e}")
        return None
    except Exception as e:
        log.error(f"Unexpected error in get_deployment_by_id: {e}")
        return None


async def get_deployment_by_appid(app_id: str) -> DeploymentDB:
    """Get the deployment object from the database with the provided app id.

    Arguments:
        app_id (str): The app id

    Returns:
        DeploymentDB: instance of deployment object
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(DeploymentDB).filter_by(app_id=uuid.UUID(app_id))
        )
        deployment = result.scalars().first()
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
    async with engine.core_session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .where(AppVariantDB.hidden.is_not(True))
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

    async with engine.core_session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .where(AppVariantDB.hidden.is_not(True))
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

    async with engine.core_session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .where(AppVariantDB.hidden.is_not(True))
            .filter_by(config_name=variant_slug, app_id=uuid.UUID(app_id))
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
    async with engine.core_session() as session:
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
    async with engine.core_session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .where(AppVariantDB.hidden.is_not(True))
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

    async with engine.core_session() as session:
        # NOTE: Backward Compatibility
        # ---------------------------
        # Previously, the user_id field in the api_keys collection in MongoDB used the
        # session_id from SuperTokens in Cloud and  "0" as the uid in OSS.
        # During migration, we changed this to use the actual user ID. Therefore, we have two checks:
        # 1. Check if user_uid is found in the UserDB.uid column.
        # 2. If not found, check if user_uid is found in the UserDB.id column.
        conditions = [UserDB.uid == user_uid]
        if is_ee():
            conditions.append(UserDB.id == uuid.UUID(user_uid))

        result = await session.execute(select(UserDB).where(or_(*conditions)))
        user = result.scalars().first()

        return user


async def check_if_user_exists_and_create_organization(user_email: str):
    """Check if a user with the given email exists and if not, create a new organization for them."""

    async with engine.core_session() as session:
        user_query = await session.execute(select(UserDB).filter_by(email=user_email))
        user = user_query.scalars().first()

        # count total number of users in database
        total_users = (
            await session.scalar(select(func.count()).select_from(UserDB)) or 0
        )

        if user is None and (total_users == 0):
            organization_name = user_email.split("@")[0]
            organization_db = await create_organization(name=organization_name)
            workspace_db = await create_workspace(
                name=organization_name, organization_id=str(organization_db.id)
            )

            # update default project with organization and workspace ids
            await create_or_update_default_project(
                values_to_update={
                    "organization_id": organization_db.id,
                    "workspace_id": workspace_db.id,
                    "project_name": organization_name,
                }
            )
            return organization_db

        organizations_db = await get_organizations()
        return organizations_db[0]


async def check_if_user_invitation_exists(email: str, organization_id: str):
    """Check if a user invitation with the given email and organization_id exists."""

    project_db = await get_project_by_organization_id(organization_id=organization_id)
    if not project_db:
        raise NoResultFound("Project not found for user invitation in organization.")

    async with engine.core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(
                email=email,
                project_id=project_db.id,
            )
        )
        user_invitation = result.scalars().first()

        total_users = (
            await session.scalar(select(func.count()).select_from(UserDB)) or 0
        )

        if not user_invitation and (total_users == 0):
            return True

        if not user_invitation:
            return False

        return True


async def delete_accounts() -> None:
    async with engine.core_session() as session:
        # fetch all projects

        stmt = select(ProjectDB)

        result = await session.execute(stmt)

        projects = result.scalars().all()

        # delete all projects

        for project in projects:
            try:
                await session.delete(project)
                log.info(
                    "[scopes] project deleted",
                    project_id=project.id,
                )
            except Exception as e:
                log.error(
                    "[scopes] error deleting project",
                    project_id=project.id,
                    error=str(e),
                )

        # fetch all workspaces

        stmt = select(WorkspaceDB)

        result = await session.execute(stmt)

        workspaces = result.scalars().all()

        # delete all workspaces

        for workspace in workspaces:
            try:
                await session.delete(workspace)
                log.info(
                    "[scopes] workspace deleted",
                    workspace_id=workspace.id,
                )
            except Exception as e:
                log.error(
                    "[scopes] error deleting workspace",
                    workspace_id=workspace.id,
                    error=str(e),
                )

        # fetch all organizations

        stmt = select(OrganizationDB)

        result = await session.execute(stmt)

        organizations = result.scalars().all()

        # delete all organizations

        for organization in organizations:
            try:
                await session.delete(organization)
                log.info(
                    "[scopes] organization deleted",
                    organization_id=organization.id,
                )
            except Exception as e:
                log.error(
                    "[scopes] error deleting organization",
                    organization_id=organization.id,
                    error=str(e),
                )

        await session.commit()

        # fetch all users

        stmt = select(UserDB)

        result = await session.execute(stmt)

        users = result.scalars().all()

        # delete all users (supertokens)

        for user in users:
            try:
                await delete_user_from_supertokens(user.uid)
                log.info(
                    "[scopes] user deleted (supertokens)",
                    user_uid=user.uid,
                )
            except Exception as e:
                log.error(
                    "[scopes] error deleting user from supertokens",
                    user_uid=user.uid,
                    error=str(e),
                )

        # delete all users

        for user in users:
            try:
                await session.delete(user)
                log.info(
                    "[scopes] user deleted",
                    user_id=user.id,
                )
            except Exception as e:
                log.error(
                    "[scopes] error deleting user",
                    user_id=user.id,
                    error=str(e),
                )

        await session.commit()


async def create_accounts(payload: dict) -> UserDB:
    """Create a new account in the database.

    Args:
        payload (dict): The payload to create the user

    Returns:
        UserDB: instance of user
    """

    # pop required fields for organization & workspace creation
    organization_id = payload.pop("organization_id")

    # create user
    user_info = {**payload, "username": payload["email"].split("@")[0]}
    user_db = await user_service.create_new_user(payload=user_info)

    # only update organization to have user_db as its "owner" if it does not yet have one
    # ---> updating the organization only happens in the first-user scenario
    #   where the first-user becomes the organization/workspace owner.
    try:
        await get_organization_owner(organization_id=organization_id)
    except (NoResultFound, ValueError):
        await update_organization(
            organization_id=organization_id, values_to_update={"owner": str(user_db.id)}
        )

    # get project belonging to organization
    project_db = await get_project_by_organization_id(organization_id=organization_id)

    # update user invitation in the case the user was invited
    invitation = await get_project_invitation_by_email(
        project_id=str(project_db.id), email=payload["email"]
    )
    if invitation is not None:
        await update_invitation(
            invitation_id=str(invitation.id),
            values_to_update={"user_id": str(user_db.id), "used": True},
        )

    return user_db


async def create_organization(name: str):
    """Create a new organization in the database.

    Args:
        name (str): The name of the organization

    Returns:
        OrganizationDB: instance of organization
    """

    async with engine.core_session() as session:
        organization_db = OrganizationDB(name=name)

        session.add(organization_db)

        log.info(
            "[scopes] organization created",
            organization_id=organization_db.id,
        )

        await session.commit()

        return organization_db


async def create_workspace(name: str, organization_id: str):
    """Create a new workspace in the database.

    Args:
        name (str): The name of the workspace
        organization_id (str): The ID of the organization

    Returns:
        WorkspaceDB: instance of workspace
    """

    async with engine.core_session() as session:
        workspace_db = WorkspaceDB(
            name=name,
            organization_id=uuid.UUID(organization_id),
            description="Default Workspace",
            type="default",
        )

        session.add(workspace_db)

        log.info(
            "[scopes] workspace created",
            organization_id=organization_id,
            workspace_id=workspace_db.id,
        )

        await session.commit()

        return workspace_db


async def update_organization(organization_id: str, values_to_update: Dict[str, Any]):
    """
    Update the specified organization in the database.

    Args:
        organization_id (str): The ID of the organization
        values_to_update (Dict[str, Any]): The values to update in the organization
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
        )
        organization = result.scalar()
        if organization is None:
            raise Exception(f"Organization with ID {organization_id} not found")

        for key, value in values_to_update.items():
            if hasattr(organization, key):
                setattr(organization, key, value)

        await session.commit()
        await session.refresh(organization)


async def create_or_update_default_project(values_to_update: Dict[str, Any]):
    """Update the specified project in the database.

    Args:
        values_to_update (Dict[str, Any]): The values to update in the project
    """

    async with engine.core_session() as session:
        result = await session.execute(select(ProjectDB).filter_by(is_default=True))
        project = result.scalar()

        if project is None:
            project = ProjectDB(project_name="Default Project", is_default=True)

            session.add(project)

        for key, value in values_to_update.items():
            if hasattr(project, key):
                setattr(project, key, value)

        await session.commit()
        await session.refresh(project)


async def get_organizations() -> List[OrganizationDB]:
    """
    Retrieve organizations from the database by their IDs.

    Returns:
        List: A list of organizations.
    """

    async with engine.core_session() as session:
        result = await session.execute(select(OrganizationDB))
        organizations = result.scalars().all()
        return organizations


async def get_organization_by_id(organization_id: str) -> OrganizationDB:
    """
    Retrieve an organization from the database by its ID.

    Args:
        organization_id (str): The ID of the organization

    Returns:
        OrganizationDB: The organization object if found, None otherwise.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
        )
        organization = result.scalar()
        return organization


async def get_organization_owner(organization_id: str):
    """
    Retrieve the owner of an organization from the database by its ID.

    Args:
        organization_id (str): The ID of the organization

    Returns:
        UserDB: The owner of the organization if found, None otherwise.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(OrganizationDB).filter_by(id=uuid.UUID(organization_id))
        )
        organization = result.scalar()
        if organization is None:
            raise NoResultFound(f"Organization with ID {organization_id} not found")

        return await get_user_with_id(user_id=str(organization.owner))


async def get_workspace(workspace_id: str) -> WorkspaceDB:
    """
    Retrieve a workspace.

    Args:
        workspace_id (str): The workspace id.

    Returns:
        Workspace: The retrieved workspace.
    """

    async with engine.core_session() as session:
        query = select(WorkspaceDB).filter_by(id=uuid.UUID(workspace_id))
        if is_ee():
            query = query.options(joinedload(WorkspaceDB.members))

        result = await session.execute(query)
        workspace = result.scalars().first()
        return workspace


async def get_workspaces() -> List[WorkspaceDB]:
    """
    Retrieve workspaces from the database by their IDs.

    Returns:
        List: A list of workspaces.
    """

    async with engine.core_session() as session:
        result = await session.execute(select(WorkspaceDB))
        workspaces = result.scalars().all()
        return workspaces


async def remove_user_from_workspace(project_id: str, email: str):
    """Remove a user from a workspace.

    Args:
        project_id (str): The ID of the project
        email (str): The email of the user to remove
    """

    user = await get_user_with_email(email=email)
    user_invitation = await get_project_invitation_by_email(
        project_id=project_id, email=email
    )

    user_id = user.id if user else None

    project = await fetch_project_by_id(project_id=project_id)

    if not project:
        raise NoResultFound(f"Project with ID {project_id} not found")

    async with engine.core_session() as session:
        if user:
            await session.delete(user)

            log.info(
                "[scopes] user deleted",
                user_id=user_id,
            )

        if user_invitation:
            user_info_from_supertokens = await list_users_by_account_info(
                tenant_id="public", account_info=AccountInfo(email=email)
            )
            if len(user_info_from_supertokens) >= 1:
                await delete_user_from_supertokens(
                    user_id=user_info_from_supertokens[0].id
                )

            await session.delete(user_invitation)

            log.info(
                "[scopes] invitation deleted",
                organization_id=project.organization_id,
                workspace_id=project.workspace_id,
                project_id=project_id,
                user_id=user_id,
                invitation_id=user_invitation.id,
            )

        await session.commit()


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


async def get_user_with_id(user_id: str) -> UserDB:
    """
    Retrieves a user from a database based on their ID.

    Args:
        user_id (str): The ID of the user to retrieve from the database.

    Returns:
        user: The user object retrieved from the database.

    Raises:
        Exception: If an error occurs while getting the user from the database.
    """

    async with engine.core_session() as session:
        result = await session.execute(select(UserDB).filter_by(id=uuid.UUID(user_id)))
        user = result.scalars().first()
        if user is None:
            log.error("Failed to get user with id")
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

    async with engine.core_session() as session:
        result = await session.execute(select(UserDB).filter_by(email=email))
        user = result.scalars().first()
        return user


async def get_users_by_ids(user_ids: List):
    """
    Retrieve users from the database by their IDs.

    Args:
        user_ids (List): A list of user IDs to retrieve.
    """

    async with engine.core_session() as session:
        user_uids = [uuid.UUID(user_id) for user_id in user_ids]
        result = await session.execute(select(UserDB).where(UserDB.id.in_(user_uids)))
        users = result.scalars().all()
        return users


async def get_users() -> List[UserDB]:
    """
    Retrieve all users from the database.

    Returns:
        List: A list of users.
    """

    async with engine.core_session() as session:
        result = await session.execute(select(UserDB))
        users = result.scalars().all()
        return users


async def create_user_invitation_to_organization(
    project_id: str,
    token: str,
    role: str,
    email: str,
    expiration_date: datetime,
):
    """
    Create an organization invitation to a user.

    Args:
        project_id (str): The ID of the project.
        token (str): The token for the invitation.
        role (str): The role of the invitation.
        expiration_date: The expiration date of the invitation.

    Returns:
        InvitationDB: Returns the invitation db object

    Raises:
        Exception: If there is an error updating the user's roles.
    """

    user = await get_user_with_email(email=email)

    user_id = user.id if user else None

    project = await fetch_project_by_id(project_id=project_id)

    if not project:
        raise NoResultFound(f"Project with ID {project_id} not found")

    async with engine.core_session() as session:
        invitation = InvitationDB(
            token=token,
            email=email,
            role=role,
            project_id=uuid.UUID(project_id),
            expiration_date=expiration_date,
        )

        session.add(invitation)

        log.info(
            "[scopes] invitation created",
            organization_id=project.organization_id,
            workspace_id=project.workspace_id,
            project_id=project_id,
            user_id=user_id,
            invitation_id=invitation.id,
        )

        await session.commit()

        return invitation


async def get_project_by_id(project_id: str) -> ProjectDB:
    """
    Get the project from database using provided id.

    Args:
        project_id (str): The ID of the project to retrieve.

    Returns:
        str: The retrieve project or None
    """

    async with engine.core_session() as session:
        project_query = await session.execute(
            select(ProjectDB)
            .options(joinedload(ProjectDB.organization).load_only(OrganizationDB.name))
            .where(ProjectDB.id == uuid.UUID(project_id))
        )
        project = project_query.scalar()

        return project


async def get_default_project_id_from_workspace(
    workspace_id: str,
):
    """
    Get the default project ID belonging to a user from a workspace.

    Args:
        workspace_id (str): The ID of the workspace.

    Returns:
        Union[str, Exception]: The default project ID or an exception error message.
    """

    async with engine.core_session() as session:
        project_query = await session.execute(
            select(ProjectDB)
            .where(
                ProjectDB.workspace_id == uuid.UUID(workspace_id),
                ProjectDB.is_default == True,
            )
            .options(load_only(ProjectDB.id))
        )
        project = project_query.scalars().first()
        if project is None:
            raise NoResultFound(
                f"No default project for the provided workspace_id {workspace_id} found"
            )
        return str(project.id)


async def get_project_invitation_by_email(project_id: str, email: str) -> InvitationDB:
    """Get project invitation by project ID and email.

    Args:
        project_id (str): The ID of the project.
        email (str): The email address of the invited user.

    Returns:
        InvitationDB: invitation object
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(
                project_id=uuid.UUID(project_id), email=email
            )
        )
        invitation = result.scalars().first()
        return invitation


async def get_project_invitations(project_id: str) -> InvitationDB:
    """Get project invitations.

    Args:
        project_id (str): The ID of the project.

    Returns:
        List[InvitationDB]: invitation objects
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(project_id=uuid.UUID(project_id))
        )
        invitation = result.scalars().all()
        return invitation


async def update_invitation(invitation_id: str, values_to_update: dict) -> bool:
    """
    Update an invitation from an organization.

    Args:
        invitation (str): The invitation to delete.
        values_to_update (dict): The values to update in the invitation.

    Returns:
        bool: True if the invitation was successfully updated, False otherwise.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(id=uuid.UUID(invitation_id))
        )

        try:
            invitation = result.scalars().one_or_none()
            for key, value in values_to_update.items():
                if hasattr(invitation, key):
                    setattr(invitation, key, value)

        except MultipleResultsFound as e:
            log.error(
                f"Critical error: Database returned two rows when retrieving invitation with ID {invitation_id} to delete from Invitations table. Error details: {str(e)}"
            )
            raise HTTPException(
                500,
                {
                    "message": f"Error occurred while trying to delete invitation with ID {invitation_id} from Invitations table. Error details: {str(e)}"
                },
            )

        await session.commit()

        return True


async def delete_invitation(invitation_id: str) -> bool:
    """
    Delete an invitation from an organization.

    Args:
        invitation (str): The invitation to delete.

    Returns:
        bool: True if the invitation was successfully deleted, False otherwise.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(id=uuid.UUID(invitation_id))
        )

        try:
            invitation = result.scalars().one_or_none()
        except MultipleResultsFound as e:
            log.error(
                f"Critical error: Database returned two rows when retrieving invitation with ID {invitation_id} to delete from Invitations table. Error details: {str(e)}"
            )
            raise HTTPException(
                500,
                {
                    "message": f"Error occurred while trying to delete invitation with ID {invitation_id} from Invitations table. Error details: {str(e)}"
                },
            )

        project = await fetch_project_by_id(project_id=str(invitation.project_id))

        if not project:
            raise NoResultFound(f"Project with ID {invitation.project_id} not found")

        await session.delete(invitation)

        log.info(
            "[scopes] invitation deleted",
            organization_id=project.organization_id,
            workspace_id=project.workspace_id,
            project_id=invitation.project_id,
            user_id=invitation.user_id,
            invitation_id=invitation.id,
        )

        await session.commit()

        return True


async def get_project_by_organization_id(organization_id: str):
    """Get project by organization ID.

    Args:
        organization_id (str): The ID of the organization.

    Returns:
        ProjectDB: project object
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(ProjectDB).filter_by(organization_id=uuid.UUID(organization_id))
        )
        project = result.scalars().first()
        return project


async def get_project_invitation_by_token_and_email(
    project_id: str, token: str, email: str
) -> InvitationDB:
    """Get project invitation by project ID, token and email.

    Args:
        project_id (str): The ID of the project.
        token (str): The invitation token.
        email (str): The email address of the invited user.

    Returns:
        InvitationDB: invitation object
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(InvitationDB).filter_by(
                project_id=uuid.UUID(project_id), token=token, email=email
            )
        )
        invitation = result.scalars().first()
        return invitation


async def get_app_instance_by_id(
    project_id: str,
    app_id: str,
) -> AppDB:
    """Get the app object from the database with the provided id.

    Arguments:
        app_id (str): The app unique identifier

    Returns:
        AppDB: instance of app object
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(AppDB).filter_by(
                project_id=project_id,
                id=uuid.UUID(app_id),
            )
        )
        app = result.scalars().first()
        return app


async def add_variant_from_base_and_config(
    base_db: VariantBaseDB,
    new_config_name: str,
    parameters: Dict[str, Any],
    user_uid: str,
    project_id: str,
    commit_message: Optional[str] = None,
) -> AppVariantDB:
    """
    Add a new variant to the database based on an existing base and a new configuration.

    Args:
        base_db (VariantBaseDB): The existing base to use as a template for the new variant.
        new_config_name (str): The name of the new configuration to use for the new variant.
        parameters (Dict[str, Any]): The parameters to use for the new configuration.
        user_uid (str): The UID of the user
        project_id (str): The ID of the project
        commit_message (Optional[str]): The commit message to use when creating a new variant.

    Returns:
        AppVariantDB: The newly created app variant.
    """

    previous_app_variant_db = await find_previous_variant_from_base_id(
        str(base_db.id), project_id
    )
    if previous_app_variant_db is None:
        log.error("Failed to find the previous app variant in the database.")
        raise HTTPException(status_code=404, detail="Previous app variant not found")

    app_variant_for_base = await list_variants_for_base(base_db)

    already_exists = any(
        av for av in app_variant_for_base if av.config_name == new_config_name  # type: ignore
    )
    if already_exists:
        raise ValueError("App variant with the same name already exists")

    user_db = await get_user_with_id(user_id=user_uid)
    async with engine.core_session() as session:
        db_app_variant = AppVariantDB(
            app_id=previous_app_variant_db.app_id,
            variant_name=new_config_name,
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
            commit_message=commit_message,
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
        async with engine.core_session() as session:
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
    async with engine.core_session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .options(
                joinedload(AppVariantDB.app.of_type(AppDB)).load_only(AppDB.id, AppDB.app_name),  # type: ignore
                joinedload(AppVariantDB.base.of_type(VariantBaseDB)).joinedload(VariantBaseDB.deployment.of_type(DeploymentDB)).load_only(DeploymentDB.uri),  # type: ignore
            )
            .where(AppVariantDB.hidden.is_not(True))
            .filter_by(app_id=uuid.UUID(app_uuid))
        )
        app_variants = result.scalars().all()
        return app_variants


async def remove_deployment(deployment_id: str):
    """Remove a deployment from the db

    Arguments:
        deployment -- Deployment to remove
    """

    assert deployment_id is not None, "deployment_id is missing"

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
        result = await session.execute(
            select(DeploymentDB).filter_by(app_id=uuid.UUID(app_id))
        )
        environments = result.scalars().all()
        return environments


async def remove_app_variant_from_db(app_variant_db: AppVariantDB, project_id: str):
    """Remove an app variant from the db

    Args:
        app_variant (AppVariantDB): the application variant to remove
        project_id (str): The ID of the project
    """

    assert app_variant_db is not None, "app_variant_db is missing"

    app_variant_revisions = await list_app_variant_revisions_by_variant(
        variant_id=str(app_variant_db.id), project_id=project_id
    )

    async with engine.core_session() as session:
        # Delete all the revisions associated with the variant
        for app_variant_revision in app_variant_revisions:
            await session.delete(app_variant_revision)

        # Delete app variant and commit action to database
        await session.delete(app_variant_db)
        await session.commit()


async def mark_app_variant_as_hidden(app_variant_id: str):
    """
    Marks an app variant as hidden from the user interface.

    Args:
        app_variant_id (str): The ID of the app variant to hide.
    """

    app_variant_db = await fetch_app_variant_by_id(app_variant_id=app_variant_id)
    if app_variant_db is None:
        raise NoResultFound("App variant not found")

    async with engine.core_session() as session:
        app_variant_db = await session.merge(
            app_variant_db
        )  # Attach the object to the session
        app_variant_db.hidden = True
        await session.commit()


async def mark_app_variant_as_visible(app_variant_id: str):
    """
    Marks an app variant as visible in the user interface.

    Args:
        app_variant_id (str): The ID of the app variant to hide.
    """

    app_variant_db = await fetch_app_variant_by_id(app_variant_id=app_variant_id)
    if app_variant_db is None:
        raise NoResultFound("App variant not found")

    async with engine.core_session() as session:
        app_variant_db = await session.merge(
            app_variant_db
        )  # Attach the object to the session
        app_variant_db.hidden = None
        await session.commit()


async def mark_app_variant_revision_as_hidden(variant_revision_id: str):
    """
    Marks an app variant revision as hidden from the user interface.

    Args:
        variant_revision_id (str): The ID of the app variant revision to hide.
    """

    variant_revision_db = await fetch_app_variant_revision_by_id(
        variant_revision_id=variant_revision_id
    )
    if variant_revision_db is None:
        raise NoResultFound("App variant not found")

    async with engine.core_session() as session:
        variant_revision_db = await session.merge(
            variant_revision_db
        )  # Attach the object to the session
        variant_revision_db.hidden = True
        await session.commit()


async def mark_app_variant_revision_as_visible(variant_revision_id: str):
    """
    Marks an app variant revision as visible from the user interface.

    Args:
        variant_revision_id (str): The ID of the app variant revision to be visible.
    """

    variant_revision_db = await fetch_app_variant_revision_by_id(
        variant_revision_id=variant_revision_id
    )
    if variant_revision_db is None:
        raise NoResultFound("App variant not found")

    async with engine.core_session() as session:
        variant_revision_db = await session.merge(
            variant_revision_db
        )  # Attach the object to the session
        variant_revision_db.hidden = None
        await session.commit()


async def deploy_to_environment(
    environment_name: str,
    variant_id: str,
    variant_revision_id: Optional[str] = None,
    commit_message: Optional[str] = None,
    **user_org_data,
) -> Tuple[Optional[str], Optional[int]]:
    """
    Deploys an app variant to a specified environment.

    Args:
        environment_name (str): The name of the environment to deploy the app variant to.
        variant_id (str): The ID of the app variant to deploy.
        commit_message (str, optional): The commit message associated with the deployment. Defaults to None.

    Raises:
        ValueError: If the app variant is not found or if the environment is not found or if the app variant is already
                    deployed to the environment.
    Returns:
        None
    """

    app_variant_db = await fetch_app_variant_by_id(variant_id)
    if variant_revision_id:
        app_variant_revision_db = await fetch_app_variant_revision_by_id(
            variant_revision_id
        )
    else:
        app_variant_revision_db = await fetch_app_variant_revision_by_variant(
            app_variant_id=variant_id,
            project_id=str(app_variant_db.project_id),
            revision=app_variant_db.revision,
        )
    if app_variant_db is None:
        raise ValueError("App variant not found")

    # Retrieve app deployment
    deployment = await get_deployment_by_appid(str(app_variant_db.app_id))

    # Retrieve user
    assert "user_uid" in user_org_data, "User uid is required"
    user = await get_user_with_id(user_id=user_org_data["user_uid"])

    async with engine.core_session() as session:
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
            session=session,
            environment=environment_db,
            user=user,
            project_id=str(app_variant_db.project_id),
            commit_message=commit_message,
            deployed_app_variant_revision=app_variant_revision_db,
            deployment=deployment,
        )

        await session.commit()

    return environment_db.name, environment_db.revision


async def fetch_app_environment_by_name_and_appid(
    app_id: str, environment_name: str
) -> AppEnvironmentDB:
    """Fetch an app environment using the provided app id and environment name.

    Args:
        app_id (str): The Id of the app
        environment_name (str): The name of the environment

    Returns:
        AppEnvironmentDB: app environment object
    """

    async with engine.core_session() as session:
        query = select(AppEnvironmentDB).filter_by(
            app_id=uuid.UUID(app_id), name=environment_name
        )
        if is_ee():
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

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
        query = select(AppEnvironmentRevisionDB).filter_by(
            deployed_app_variant_revision_id=uuid.UUID(app_variant_revision_id),
        )
        if is_ee():
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

    async with engine.core_session() as session:
        result = await session.execute(
            select(AppVariantRevisionsDB)
            .options(
                joinedload(AppVariantRevisionsDB.base.of_type(VariantBaseDB)).joinedload(VariantBaseDB.deployment.of_type(DeploymentDB)).load_only(DeploymentDB.id, DeploymentDB.uri),  # type: ignore
            )
            .filter_by(id=uuid.UUID(variant_revision_id))
        )
        app_revision = result.scalars().first()
        return app_revision


async def fetch_environment_revisions_for_environment(environment: AppEnvironmentDB):
    """Returns list of app environment revision for the given environment.

    Args:
        environment (AppEnvironmentDB): The app environment to retrieve environments revisions for.

    Returns:
        List[AppEnvironmentRevisionDB]: A list of AppEnvironmentRevisionDB objects.
    """

    async with engine.core_session() as session:
        query = select(AppEnvironmentRevisionDB).filter_by(
            environment_id=environment.id
        )

        if is_ee():
            query = query.options(
                joinedload(
                    AppEnvironmentRevisionDB.modified_by.of_type(UserDB)
                ).load_only(
                    UserDB.username
                )  # type: ignore
            )
        else:
            query = query.options(
                joinedload(AppEnvironmentRevisionDB.modified_by).load_only(
                    UserDB.username
                )  # type: ignore
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

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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


async def list_environments(app_id: str):
    """
    List all environments for a given app ID.

    Args:
        app_id (str): The ID of the app to list environments for.

    Returns:
        List[AppEnvironmentDB]: A list of AppEnvironmentDB objects representing the environments for the given app ID.
    """

    app_instance = await fetch_app_by_id(app_id=app_id)
    if app_instance is None:
        log.error(f"App with id {app_id} not found")
        raise ValueError("App not found")

    async with engine.core_session() as session:
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
    commit_message: Optional[str] = None,
    **kwargs: dict,
):
    """Creates a new environment revision.

    Args:
        environment (AppEnvironmentDB): The environment to create a revision for.
        user (UserDB): The user that made the deployment.
        commit_message (str, optional): The commit message associated with the deployment. Defaults to None.
        project_id (str): The ID of the project.
    """

    assert environment is not None, "environment cannot be None"
    assert user is not None, "user cannot be None"

    environment_revision = AppEnvironmentRevisionDB(
        environment_id=environment.id,
        revision=environment.revision,
        modified_by_id=user.id,
        project_id=uuid.UUID(project_id),
        commit_message=commit_message,
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
    variant_id: str, project_id: str
) -> List[AppVariantRevisionsDB]:
    """Returns list of app variant revisions for the given app variant.

    Args:
        app_variant (AppVariantDB): The app variant to retrieve revisions for.
        project_id (str): The ID of the project.

    Returns:
        List[AppVariantRevisionsDB]: A list of AppVariantRevisionsDB objects.
    """
    async with engine.core_session() as session:
        base_query = (
            select(AppVariantRevisionsDB)
            .where(AppVariantRevisionsDB.hidden.is_not(True))
            .filter_by(
                variant_id=uuid.UUID(variant_id), project_id=uuid.UUID(project_id)
            )
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


async def fetch_app_variant_revision(
    app_variant: str, revision_number: int
) -> Optional[AppVariantRevisionsDB]:
    """Returns a specific app variant revision for the given app variant and revision number.

    Args:
        app_variant (str): The ID of the app variant to retrieve the revision for.
        revision_number (int): The revision number to retrieve.

    Returns:
        AppVariantRevisionsDB: The app variant revision object, or None if not found.
    """

    async with engine.core_session() as session:
        base_query = (
            select(AppVariantRevisionsDB)
            .where(AppVariantRevisionsDB.hidden.is_not(True))
            .filter_by(variant_id=uuid.UUID(app_variant), revision=revision_number)
        )
        if is_ee():
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
        app_variant_revision = result.scalars().first()
        return app_variant_revision


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
    async with engine.core_session() as session:
        await session.delete(environment_db)
        await session.commit()


async def remove_testsets(testset_ids: List[str]):
    """
    Removes testsets.

    Args:
        testset_ids (List[str]):  The testset identifiers
    """

    async with engine.core_session() as session:
        query = select(TestSetDB).where(TestSetDB.id.in_(testset_ids))
        result = await session.execute(query)
        testsets = result.scalars().all()

        for i, testset in enumerate(testsets):
            log.info(
                f"[TESTSET] DELETE ({i}):",
                project_id=testset.project_id,
                testset_id=testset.id,
                count=len(testset.csvdata),
                size=len(dumps(testset.csvdata).encode("utf-8")),
            )

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
    async with engine.core_session() as session:
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
    async with engine.core_session() as session:
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
    app_variant_id: str,
    parameters: Dict[str, Any],
    project_id: str,
    user_uid: str,
    commit_message: Optional[str] = None,
) -> AppVariantDB:
    """
    Update the parameters of an app variant in the database.

    Args:
        app_variant_id (str): The app variant ID.
        parameters (Dict[str, Any]): The new parameters to set for the app variant.
        project_id (str): The ID of the project.
        user_uid (str): The UID of the user that is updating the app variant.
        commit_message (str, optional): The commit message associated with the update. Defaults to None.

    Raises:
        NoResultFound: If there is an issue updating the variant parameters.
    """

    user = await get_user_with_id(user_id=user_uid)
    async with engine.core_session() as session:
        result = await session.execute(
            select(AppVariantDB).filter_by(
                id=uuid.UUID(app_variant_id), project_id=uuid.UUID(project_id)
            )
        )
        app_variant_db = result.scalars().first()
        if not app_variant_db:
            raise NoResultFound(f"App variant with id {app_variant_id} not found")

        # ...and variant versioning
        app_variant_db.revision += 1  # type: ignore
        app_variant_db.modified_by_id = user.id

        # Save updated ConfigDB
        await session.commit()
        await session.refresh(app_variant_db)

        variant_revision = AppVariantRevisionsDB(
            variant_id=app_variant_db.id,
            revision=app_variant_db.revision,
            commit_message=commit_message,
            modified_by_id=user.id,
            project_id=uuid.UUID(project_id),
            base_id=app_variant_db.base_id,
            config_name=app_variant_db.config_name,
            config_parameters=parameters,
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

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
        result = await session.execute(select(TestSetDB).filter_by(id=testset_uuid))
        testset = result.scalars().first()

        if not testset:
            raise NoResultFound(f"Testset with id {testset_id} not found")

        log.info(
            "[TESTSET] READ:",
            project_id=testset.project_id,
            testset_id=testset.id,
            count=len(testset.csvdata),
            size=len(dumps(testset.csvdata).encode("utf-8")),
        )

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

    async with engine.core_session() as session:
        testset = TestSetDB(**testset_data, project_id=uuid.UUID(project_id))

        log.info(
            "[TESTSET] CREATE:",
            project_id=testset.project_id,
            testset_id=testset.id,
            count=len(testset.csvdata),
            size=len(dumps(testset.csvdata).encode("utf-8")),
        )

        session.add(testset)
        await session.commit()
        await session.refresh(testset)

        return testset


async def update_testset(testset_id: str, values_to_update: dict) -> None:
    """Update a testset.

    Args:
        testset (TestsetDB): the testset object to update
        values_to_update (dict):  The values to update
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(TestSetDB).filter_by(id=uuid.UUID(testset_id))
        )
        testset = result.scalars().first()

        # Validate keys in values_to_update and update attributes
        valid_keys = [key for key in values_to_update.keys() if hasattr(testset, key)]

        for key in valid_keys:
            setattr(testset, key, values_to_update[key])

        log.info(
            "[TESTSET] UPDATE:",
            project_id=testset.project_id,
            testset_id=testset.id,
            count=len(testset.csvdata),
            size=len(dumps(testset.csvdata).encode("utf-8")),
        )

        await session.commit()
        await session.refresh(testset)


async def fetch_testsets_by_project_id(project_id: str):
    """Fetches all testsets for a given project.

    Args:
        project_id (str): The ID of the project.

    Returns:
        List[TestSetDB]: The fetched testsets.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(TestSetDB).filter_by(project_id=uuid.UUID(project_id))
        )
        testsets = result.scalars().all()

        for i, testset in enumerate(testsets):
            log.info(
                f"[TESTSET] READ ({i}):",
                project_id=testset.project_id,
                testset_id=testset.id,
                count=len(testset.csvdata),
                size=len(dumps(testset.csvdata).encode("utf-8")),
            )

        return testsets


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
    async with engine.core_session() as session:
        result = await session.execute(
            select(AppVariantDB)
            .filter_by(base_id=uuid.UUID(base_id), project_id=uuid.UUID(project_id))
            .order_by(AppVariantDB.created_at.desc())
        )
        last_variant = result.scalars().first()
        if not last_variant:
            return None
        return last_variant


async def update_base(
    base_id: str,
    **kwargs: dict,
) -> VariantBaseDB:
    """Update the base object in the database with the provided id.

    Arguments:
        base (VariantBaseDB): The base object to update.
    """

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
        query = select(AppDB).filter_by(
            app_name=app_name, project_id=uuid.UUID(project_id)
        )
        result = await session.execute(query)
        app_db = result.unique().scalars().first()
        return app_db


async def fetch_evaluators_configs(project_id: str):
    """Fetches a list of evaluator configurations from the database.

    Returns:
        List[EvaluatorConfigDB]: A list of evaluator configuration objects.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(EvaluatorConfigDB).filter_by(project_id=uuid.UUID(project_id))
        )
        evaluators_configs = result.scalars().all()
        return evaluators_configs


async def fetch_evaluator_config(evaluator_config_id: str) -> EvaluatorConfigDB:
    """Fetch evaluator configurations from the database.

    Args:
        evaluator_config_id (str): The ID of the evaluator configuration.

    Returns:
        EvaluatorConfigDB: the evaluator configuration object.
    """

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
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
    settings_values: Optional[Dict[str, Any]] = None,
) -> EvaluatorConfigDB:
    """Create a new evaluator configuration in the database."""

    async with engine.core_session() as session:
        new_evaluator_config = EvaluatorConfigDB(
            project_id=uuid.UUID(project_id),
            name=name,
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

    async with engine.core_session() as session:
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
    async with engine.core_session() as session:
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

    # from bson.errors import InvalidId

    try:
        # Ensure the object_id is a valid MongoDB ObjectId
        if isinstance(ObjectId(object_id), ObjectId):
            object_uuid_as_str = await fetch_corresponding_object_uuid(
                table_name=table_name, object_id=object_id
            )
    except:
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

    async with engine.core_session() as session:
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

    async with engine.core_session() as session:
        result = await session.execute(select(ProjectDB).filter_by(is_default=True))
        default_project = result.scalars().first()
        return default_project


async def get_user_api_key_by_prefix(api_key_prefix: str, user_id: str) -> APIKeyDB:
    """
    Gets the user api key by prefix.

    Args:
        api_key_prefix (str): The prefix of the api key
        user_uid (str): The unique ID of the user

    Returns:
        The user api key by prefix.
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(APIKeyDB).filter_by(
                prefix=api_key_prefix, created_by_id=uuid.UUID(user_id)
            )
        )
        api_key = result.scalars().first()
        return api_key


async def update_api_key_timestamp(api_key_id: str) -> None:
    """
    Updates the api key timestamp


    Args:
        api_key_id (str):     The ID of the api key

    Raises:
        NoResultFound: API Key with id xxxx not found
    """

    async with engine.core_session() as session:
        result = await session.execute(
            select(APIKeyDB).filter_by(id=uuid.UUID(api_key_id))  # type: ignore
        )
        api_key = result.scalars().first()
        if not api_key:
            raise NoResultFound(f"API Key with id {api_key_id} not found")

        api_key.updated_at = datetime.now(timezone.utc)

        await session.commit()
        await session.refresh(api_key)

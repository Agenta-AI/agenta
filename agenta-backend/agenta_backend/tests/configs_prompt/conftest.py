import os
import uuid
import pytest
import logging

from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession

from agenta_backend.services import db_manager
from agenta_backend.models.db.postgres_engine import db_engine
from agenta_backend.models.db_models import (
    ProjectDB,
    AppDB,
    UserDB,
    DeploymentDB,
    VariantBaseDB,
    AppEnvironmentDB,
    AppEnvironmentRevisionDB,
    ImageDB,
    AppVariantDB,
    AppVariantRevisionsDB,
)


# Initialize logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Set global variables
ENVIRONMENT = os.environ.get("ENVIRONMENT")
OPEN_AI_KEY = os.environ.get("OPENAI_API_KEY")
if ENVIRONMENT == "development":
    BACKEND_API_HOST = "http://host.docker.internal/api"
elif ENVIRONMENT == "github":
    BACKEND_API_HOST = "http://agenta-backend-test:8000"

# Set IDs
APP_ID = "0192a45d-511e-7d1a-aaca-20280c963b1f"
VARIANT_ID = "0192a45d-5ba1-757e-a983-787a66a4e78d"
BASE_ID = "0192a45c-4630-7130-8d59-7036ec84002f"


@pytest.fixture()
async def get_or_create_user_from_db():
    async with db_engine.get_session() as session:
        result = await session.execute(select(UserDB).filter_by(uid="0"))
        user = result.scalars().first()
        if user is None:
            create_user = UserDB(uid="0")
            session.add(create_user)
            await session.commit()
            await session.refresh(create_user)
            return create_user
        return user


@pytest.fixture()
async def get_or_create_project_from_db():
    async with db_engine.get_session() as session:
        result = await session.execute(select(ProjectDB).filter_by(is_default=True))
        project = result.scalars().first()
        if project is None:
            create_project = ProjectDB(project_name="default", is_default=True)
            session.add(create_project)
            await session.commit()
            await session.refresh(create_project)
            return create_project
        return project


@pytest.fixture()
async def get_app_variant_by_slug():
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantDB).filter_by(config_name="from_pytest")
        )
        app_variant = result.scalars().first()
        return app_variant


@pytest.fixture()
async def get_app_by_name():
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppDB).filter_by(app_name="test_prompt_client")
        )
        app = result.scalars().first()
        return app


@pytest.fixture()
async def get_production_environment_by_name():
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppEnvironmentDB).filter_by(name="production")
        )
        environment = result.scalars().first()
        return environment


@pytest.fixture()
async def get_user_from_db():
    async with db_engine.get_session() as session:
        result = await session.execute(select(UserDB).filter_by(uid="0"))
        user = result.scalars().first()
        return user


@pytest.fixture()
async def get_app_variant_revision_by_variant_id(get_app_variant_by_slug):
    variant = await get_app_variant_by_slug
    assert isinstance(
        variant, AppVariantDB
    ), "App variant gotten from fixture is not of type AppVariantDB"

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppVariantRevisionsDB).filter_by(variant_id=variant.id)
        )
        variant_revision = result.scalars().first()
        return variant_revision


@pytest.fixture()
async def get_environment_revision_by_environment_id(
    get_production_environment_by_name,
):
    environment = await get_production_environment_by_name
    assert isinstance(
        environment, AppEnvironmentDB
    ), "Production environment gotten from fixture is not of type AppEnvironmentDB"

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppEnvironmentRevisionDB).filter_by(environment_id=environment.id)
        )
        environment_revision = result.scalars().first()
        return environment_revision


async def create_app_environments(session: AsyncSession, project_id: str):
    environment_revision = {"development": 0, "staging": 0, "production": 1}
    for environment in ["development", "staging", "production"]:
        app_env = AppEnvironmentDB(
            app_id=uuid.UUID(APP_ID),
            name=environment,
            project_id=uuid.UUID(project_id),
            revision=environment_revision[environment],
        )
        session.add(app_env)


async def deploy_app_variant_to_production_environment(
    environment_name: str, variant_id: str
):
    await db_manager.deploy_to_environment(
        environment_name=environment_name,
        variant_id=variant_id,
        user_uid="0",
    )


@pytest.fixture()
async def create_app_variant_for_prompt_management(
    get_or_create_user_from_db, get_or_create_project_from_db
):
    user_db = await get_or_create_user_from_db
    assert isinstance(user_db, UserDB), "User gotten from fixture is not of type UserDB"

    project_db = await get_or_create_project_from_db
    assert isinstance(
        project_db, ProjectDB
    ), "Project gotten from fixture is not of type ProjectDB"

    async with db_engine.get_session() as session:
        app = AppDB(
            id=uuid.UUID(APP_ID),
            app_name="test_prompt_client",
            project_id=project_db.id,
        )
        session.add(app)
        await session.commit()
        await session.refresh(app)

        db_image = ImageDB(
            docker_id="sha256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            tags="agentaai/templates_v2:completion_prompt_fake",
            project_id=project_db.id,
        )
        session.add(db_image)
        await session.commit()
        await session.refresh(db_image)

        container_name = f"test_prompt_client-app-{str(project_db.id)}"
        db_deployment = DeploymentDB(
            app_id=app.id,
            project_id=project_db.id,
            container_name=container_name,
            container_id="w243e34red",
            uri="http://localhost/app/test_prompt_client",
            status="stale",
        )
        session.add(db_deployment)
        await session.commit()
        await session.refresh(db_deployment)

        db_base = VariantBaseDB(
            id=uuid.UUID(BASE_ID),
            base_name="app",
            image_id=db_image.id,
            project_id=project_db.id,
            app_id=app.id,
            deployment_id=db_deployment.id,
        )
        session.add(db_base)
        await session.commit()
        await session.refresh(db_base)

        appvariant = AppVariantDB(
            id=uuid.UUID(VARIANT_ID),
            app_id=app.id,
            variant_name="app.default",
            image_id=db_image.id,
            project_id=project_db.id,
            config_parameters={
                "force_json": 0,
                "frequence_penalty": 0,
                "inputs": [{"name": "country"}],
                "max_tokens": -1,
                "model": "gpt-3.5-turbo",
                "presence_penalty": 0,
                "prompt_system": "You are an expert in geography.",
                "prompt_user": "What is the capital of {country}?",
                "temperature": 1,
                "top_p": 1,
            },
            base_name="app",
            config_name="default",
            base_id=db_base.id,
            revision=1,
            modified_by_id=user_db.id,
        )
        session.add(appvariant)
        await session.commit()
        await session.refresh(appvariant)

        # create app environments
        await create_app_environments(session=session, project_id=str(project_db.id))

        appvariant_revision = AppVariantRevisionsDB(
            variant_id=appvariant.id,
            revision=appvariant.revision,
            project_id=project_db.id,
            modified_by_id=user_db.id,
            base_id=db_base.id,
            config_name=appvariant.config_name,
            config_parameters=appvariant.config_parameters,
        )
        session.add(appvariant_revision)
        await session.commit()
        await session.refresh(appvariant_revision)

    # Deploy app variant to production environment
    await deploy_app_variant_to_production_environment("production", str(appvariant.id))
    return appvariant

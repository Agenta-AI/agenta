import os
import logging
from asyncio import current_task
from typing import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    create_async_engine,
    async_sessionmaker,
    async_scoped_session,
)

from agenta_backend.utils.common import isCloudEE

if isCloudEE():
    from agenta_backend.commons.observability.models.db import SpanDB
    from agenta_backend.commons.models.db_models import (
        APIKeyDB,
        WorkspaceDB,
        OrganizationDB,
        InvitationDB,
        UserOrganizationDB,
        WorkspaceMemberDB,
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
        EvaluationDB,
        DeploymentDB,
        AppVariantDB,
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
    AppVariantRevisionsDB,
)

models = [
    AppDB,
    UserDB,
    ImageDB,
    TestSetDB,
    TemplateDB,
    AppVariantDB,
    DeploymentDB,
    EvaluationDB,
    VariantBaseDB,
    AppEnvironmentDB,
    AppEnvironmentRevisionDB,
    EvaluatorConfigDB,
    HumanEvaluationDB,
    EvaluationScenarioDB,
    AppVariantRevisionsDB,
    HumanEvaluationScenarioDB,
]

if isCloudEE():
    models.extend([OrganizationDB, WorkspaceDB, APIKeyDB, InvitationDB, UserOrganizationDB, WorkspaceMemberDB])  # type: ignore


# Configure and set logging level
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


class DBEngine:
    """
    Database engine to initialize SQLAlchemy (and beanie)
    """

    def __init__(self) -> None:
        self.mode = os.environ.get("DATABASE_MODE", "v2")
        self.postgres_uri = os.environ.get("POSTGRES_URI")
        self.mongo_uri = os.environ.get("MONGODB_URI")
        self.engine = create_async_engine(url=self.postgres_uri)  # type: ignore
        self.async_session_maker = async_sessionmaker(
            bind=self.engine, class_=AsyncSession, expire_on_commit=False
        )
        self.async_session = async_scoped_session(
            session_factory=self.async_session_maker, scopefunc=current_task
        )

    async def initialize_async_postgres(self):
        """
        Initialize PostgreSQL database engine and sessions.
        """

        if not self.postgres_uri:
            raise ValueError("Postgres URI cannot be None.")

        async with self.engine.begin() as conn:
            # Drop and create tables if needed
            for model in models:
                await conn.run_sync(model.metadata.create_all)
        logger.info(f"Using PostgreSQL database...")

    async def initialize_mongodb(self):
        """
        Initializes the mongodb async driver and beanie documents.

        Raises:
            ValueError: It looks like one of the following packages are not installed: beanie, motor. Exception: ImportError message
        """

        try:
            from beanie import init_beanie  # type: ignore
            from motor.motor_asyncio import AsyncIOMotorClient  # type: ignore
        except ImportError as exc:
            raise ValueError(
                f"It looks like one of the following packages are not installed: beanie, motor. Exception: {str(exc)}"
            )

        db_name = f"agenta_{self.mode}"
        client = AsyncIOMotorClient(self.mongo_uri)
        await init_beanie(database=client[db_name], document_models=[SpanDB])
        logger.info(f"Using {db_name} mongo database...")

    async def init_db(self):
        """
        Initialize the database based on the mode and create all tables.
        """

        if isCloudEE():
            await self.initialize_mongodb()
            await self.initialize_async_postgres()
        else:
            await self.initialize_async_postgres()

    async def remove_db(self) -> None:
        """
        Remove the database based on the mode.
        """

        async with self.engine.begin() as conn:
            for model in models:
                await conn.run_sync(model.metadata.drop_all)

    @asynccontextmanager
    async def get_session(self) -> AsyncGenerator[AsyncSession, None]:
        session = self.async_session()
        try:
            yield session
        except Exception as e:
            await session.rollback()
            raise e
        finally:
            await session.close()

    async def close(self):
        """
        Closes and dispose all the connections using the engine.

        :raises     Exception:  if engine is initialized
        """

        if self.engine is None:
            raise Exception("DBEngine is not initialized")

        await self.engine.dispose()


db_engine = DBEngine()

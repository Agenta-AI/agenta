import os
import logging
from contextlib import asynccontextmanager
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from agenta_backend.utils.common import isCloudEE

if isCloudEE():
    from agenta_backend.commons.observability.models.db import SpanDB
    from agenta_backend.commons.models.db_models import (
        APIKeyDB,
        WorkspaceDB,
        OrganizationDB,
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
    models.extend([SpanDB, OrganizationDB, WorkspaceDB, APIKeyDB])

# Configure and set logging level
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


class DBEngine:
    """
    Database engine to initialize SQLAlchemy and return the engine based on mode.
    """

    def __init__(self) -> None:
        self.mode = os.environ.get("DATABASE_MODE", "v2")
        self.db_url = os.environ[
            "DATABASE_URL"
        ]
        self.engine = create_async_engine(self.db_url, echo=True)
        self.async_session = sessionmaker(
            self.engine, expire_on_commit=False, class_=AsyncSession
        )

    async def init_db(self):
        """
        Initialize the database based on the mode and create all tables.
        """
        async with self.engine.begin() as conn:
            # Drop all existing tables (if needed)
            # await conn.run_sync(Base.metadata.drop_all)
            # Create tables
            for model in models:
                await conn.run_sync(model.metadata.create_all)
        logger.info(f"Using {self.mode} database...")

    async def remove_db(self) -> None:
        """
        Remove the database based on the mode.
        """
        async with self.engine.begin() as conn:
            for model in models:
                await conn.run_sync(model.metadata.drop_all)

    @asynccontextmanager
    async def get_session(self):
        session = self.async_session()
        try:
            yield session
        finally:
            await session.close()


db_engine = DBEngine()

import os
import logging
from typing import List

from pymongo import MongoClient
from beanie import init_beanie, Document
from motor.motor_asyncio import AsyncIOMotorClient

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

# Define Document Models
document_models: List[Document] = [
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
    document_models = document_models + [SpanDB, OrganizationDB, WorkspaceDB, APIKeyDB]


# Configure and set logging level
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


class DBEngine:
    """
    Database engine to initialize Beanie and return the engine based on mode.
    """

    def __init__(self) -> None:
        self.mode = os.environ.get("DATABASE_MODE", "v2")
        self.db_url = os.environ["MONGODB_URI"]

    async def initialize_client(self):
        return AsyncIOMotorClient(self.db_url)

    async def init_db(self):
        """
        Initialize Beanie based on the mode and store the engine.
        """

        client = await self.initialize_client()
        db_name = self._get_database_name(self.mode)
        await init_beanie(database=client[db_name], document_models=document_models)
        logger.info(f"Using {db_name} database...")

    def _get_database_name(self, mode: str) -> str:
        """
        Determine the appropriate database name based on the mode.
        """
        if mode in ("test", "default", "v2"):
            return f"agenta_{mode}"

        return f"agenta_{mode}"

    def remove_db(self) -> None:
        """
        Remove the database based on the mode.
        """

        client = MongoClient(self.db_url)
        if self.mode == "default":
            client.drop_database("agenta")
        else:
            client.drop_database(f"agenta_{self.mode}")

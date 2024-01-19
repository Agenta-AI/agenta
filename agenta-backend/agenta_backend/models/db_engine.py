import os
import logging
from typing import List

from pymongo import MongoClient
from beanie import init_beanie, Document
from motor.motor_asyncio import AsyncIOMotorClient

if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]:
    from agenta_backend.commons.models.db_models import (
        APIKeyDB,
        OrganizationDB_ as OrganizationDB,
        WorkspaceDB,
        AppEnvironmentDB_ as AppEnvironmentDB,
        UserDB_ as UserDB,
        ImageDB_ as ImageDB,
        AppDB_ as AppDB,
        DeploymentDB_ as DeploymentDB,
        VariantBaseDB_ as VariantBaseDB,
        AppVariantDB_ as AppVariantDB,
        TestSetDB_ as TestSetDB,
        EvaluatorConfigDB_ as EvaluatorConfigDB,
        HumanEvaluationDB_ as HumanEvaluationDB,
        HumanEvaluationScenarioDB_ as HumanEvaluationScenarioDB,
        EvaluationDB_ as EvaluationDB,
        EvaluationScenarioDB_ as EvaluationScenarioDB,
    )
else:
    from agenta_backend.models.db_models import (
        AppEnvironmentDB,
        UserDB,
        ImageDB,
        AppDB,
        DeploymentDB,
        VariantBaseDB,
        AppVariantDB,
        TestSetDB,
        EvaluatorConfigDB,
        HumanEvaluationDB,
        HumanEvaluationScenarioDB,
        EvaluationDB,
        EvaluationScenarioDB,
    )
    
from agenta_backend.models.db_models import (
    TemplateDB,
    ConfigDB,
    SpanDB,
    TraceDB,
)

# Define Document Models
document_models: List[Document] = [
    AppEnvironmentDB,
    UserDB,
    ImageDB,
    AppDB,
    DeploymentDB,
    VariantBaseDB,
    ConfigDB,
    AppVariantDB,
    TemplateDB,
    TestSetDB,
    EvaluatorConfigDB,
    HumanEvaluationDB,
    HumanEvaluationScenarioDB,
    EvaluationDB,
    EvaluationScenarioDB,
    SpanDB,
    TraceDB,
]

if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]:
    document_models = document_models + [OrganizationDB, WorkspaceDB, APIKeyDB]


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

        if not mode.isalnum():
            raise ValueError("Mode of database needs to be alphanumeric.")
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

import os
import logging

from odmantic import AIOEngine
from beanie import init_beanie
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from agenta_backend.models.db_models import (
    APIKeyDB,
    OrganizationDB,
    UserDB,
    ImageDB,
    AppDB,
    DeploymentDB,
    VariantBaseDB,
    ConfigDB,
    AppVariantDB,
    TemplateDB,
    TestSetDB,
    CustomEvaluationDB,
    EvaluatorConfigDB,
    HumanEvaluationDB,
    HumanEvaluationScenarioDB,
    EvaluationDB,
    EvaluationScenarioDB,
    SpanDB,
    TraceDB
)

# Configure and set logging level
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Define Document Models
document_models = [
    APIKeyDB,
    OrganizationDB,
    UserDB,
    ImageDB,
    AppDB,
    DeploymentDB,
    VariantBaseDB,
    ConfigDB,
    AppVariantDB,
    TemplateDB,
    TestSetDB,
    CustomEvaluationDB,
    EvaluatorConfigDB,
    HumanEvaluationDB,
    HumanEvaluationScenarioDB,
    EvaluationDB,
    EvaluationScenarioDB,
    SpanDB,
    TraceDB
]


class DBEngine:
    """
    Database engine to initialize Beanie and return the engine based on mode.
    """

    def __init__(self) -> None:
        self.mode = os.environ.get("DATABASE_MODE", "v2")
        self.db_url = os.environ["MONGODB_URI"]
        self._engine: AIOEngine = None  # Store the engine for reuse

    async def init_db(self) -> AIOEngine:
        """
        Initialize Beanie based on the mode and store the engine.
        """
        if self._engine is not None:
            return self._engine  # Return the existing engine if already initialized

        client = AsyncIOMotorClient(self.db_url)
        db_name = self._get_database_name(self.mode)

        self._engine = await init_beanie(
            database=client[db_name],
            document_models=document_models
        )

        logger.info(f"Using {db_name} database...")
        return self._engine

    def _get_database_name(self, mode: str) -> str:
        """
        Determine the appropriate database name based on the mode.
        """
        if mode in ("test", "default", "v2"):
            return f"agenta_{mode}"

        if not mode.isalnum():
            raise ValueError("Mode of database needs to be alphanumeric.")
        return f"agenta_{mode}"

    def engine(self) -> AIOEngine:
        """
        Return the initialized Beanie engine.
        """
        if self._engine is None:
            raise RuntimeError("Database engine has not been initialized yet.")
        return self._engine  

    def remove_db(self) -> None:
        """
        Remove the database based on the mode.
        """

        client = MongoClient(self.db_url)
        if self.mode == "default":
            client.drop_database("agenta")
        elif self.mode == "v2":
            client.drop_database("agenta_v2")
        elif self.mode == "test":
            client.drop_database("agenta_test")
        else:
            client.drop_database(f"agenta_{self.mode}")
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


class DBEngine(object):
    """
    Database engine to initialize client and return engine based on mode
    """

    def __init__(self) -> None:
        self.mode = os.environ.get("DATABASE_MODE", "v2")
        self.db_url = os.environ["MONGODB_URI"]

    def engine(self) -> AIOEngine:
        return True

    async def init_db(self) -> AIOEngine:
        """
        Initialize the database based on the mode.
        """
        client = AsyncIOMotorClient(os.environ["MONGODB_URI"])
        db_mode = os.environ.get("DATABASE_MODE", "v2")

        if db_mode == "test":
            await init_beanie(
                database=client["agenta_test"],
                document_models=document_models
            )
            logger.info("Using test database...")
        elif db_mode == "default":
            await init_beanie(
                database=client["agenta"],
                document_models=document_models
            )
            logger.info("Using default database...")
        elif db_mode == "v2":
            await init_beanie(
                database=client["agenta_v2"],
                document_models=document_models
            )
            logger.info("Using v2 database...")
        else:
            # make sure that self.mode does only contain alphanumeric characters
            if not db_mode.isalnum():
                raise ValueError("Mode of database needs to be alphanumeric.")
            await init_beanie(
                database=client[f"agenta_{db_mode}"],
                document_models=document_models
            )
            logger.info(f"Using {db_mode} database...")
            

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
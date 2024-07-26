from agenta_backend.models.db.config import logger
from agenta_backend.models.db.shared import DBEngine
from agenta_backend.models.db.models import isCloudEE


class CloudEEDBEngine(DBEngine):
    """
    Database engine to initialize Beanie ODM.
    """

    async def initialize_mongodb(self):
        """
        Initializes the mongodb async driver and beanie documents.

        Raises:
            ValueError: It looks like one of the following packages are not installed: beanie, motor. Exception: ImportError message
        """

        from agenta_backend.commons.observability.models.db import SpanDB  # type: ignore

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
        Initialize the database odm create all collections.
        """

        if isCloudEE():
            await self.initialize_mongodb()


cloud_ee_db_engine = CloudEEDBEngine()
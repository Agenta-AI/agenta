import os
import logging

from agenta_backend.tests.setenv import setup_pytest_variables

from odmantic import AIOEngine
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient



# Configure and set logging level
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


class DBEngine(object):
    """
    Database engine to initialize client and return engine based on mode
    """

    def __init__(self) -> None:
        self.mode = os.environ["DATABASE_MODE"]
        self.db_url = os.environ["MONGODB_URI"]

    @property
    def initialize_client(self) -> AsyncIOMotorClient:
        """
        Returns an instance of `AsyncIOMotorClient` initialized \
            with the provided `db_url`.
        """

        client = AsyncIOMotorClient(self.db_url)
        return client

    def engine(self) -> AIOEngine:
        """
        Returns an AIOEngine object with a specified database name based on the mode.
        """

        if self.mode == "test":
            aio_engine = AIOEngine(
                client=self.initialize_client, database="agenta_test"
            )
            logger.info("Using test database...")
            return aio_engine
        elif self.mode == "default":
            aio_engine = AIOEngine(client=self.initialize_client, database="agenta")
            logger.info("Using default database...")
            return aio_engine
        elif self.mode == "v2":
            aio_engine = AIOEngine(client=self.initialize_client, database="agenta_v2")
            logger.info("Using v2 database...")
            return aio_engine
        raise ValueError(
            "Mode of database is unknown. Did you mean 'default' or 'test'?"
        )

    def remove_db(self) -> None:
        """
        Remove the database based on the mode.
        """
        
        client = MongoClient(self.db_url)
        if self.mode == "default":
            client.drop_database("agenta")
        elif self.mode == "test":
            client.drop_database("agenta_test")

from agenta_backend.models.db.models import models
from agenta_backend.models.db.postgres_engine import DBEngine


class TestDBEngine(DBEngine):
    """
    Database engine to remove database tables in test db.
    """

    async def remove_db(self):
        """
        Remove the database tables.
        """

        async with self.engine.begin() as conn:
            for model in models:
                await conn.run_sync(model.metadata.drop_all)


test_db_engine = TestDBEngine()

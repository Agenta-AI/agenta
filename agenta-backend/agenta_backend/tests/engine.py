from agenta_backend.dbs.postgres.shared.engine import Engine
from agenta_backend.tests.models import models


class TestDBEngine(Engine):
    async def remove_db(self):
        async with self.async_engine.begin() as conn:
            for model in models:
                await conn.run_sync(model.metadata.drop_all)


test_db_engine = TestDBEngine()

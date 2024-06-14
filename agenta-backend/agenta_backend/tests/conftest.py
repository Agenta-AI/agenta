import pytest
import asyncio

from agenta_backend.models.db_engine import DBEngine


@pytest.fixture(scope="session", autouse=True)
def event_loop():
    """
    Create an instance of the default event loop for each test case.
    """

    policy = asyncio.get_event_loop_policy()
    res = policy.new_event_loop()
    asyncio.set_event_loop(res)
    res._close = res.close  # type: ignore

    # Initialize database and create tables
    res.run_until_complete(DBEngine().init_db())

    yield res

    res.run_until_complete(DBEngine().close())  # close connections to database
    res.run_until_complete(DBEngine().remove_db())  # drop database
    res._close()  # close event loop # type: ignore

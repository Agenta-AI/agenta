import pytest
import asyncio

from agenta_backend.utils.common import isOss

if isOss():
    from agenta_backend.tests.engine import test_db_engine as db_engine


@pytest.fixture(scope="session", autouse=True)
def event_loop():
    """
    Create an instance of the default event loop for each test case.
    """

    policy = asyncio.get_event_loop_policy()
    res = policy.new_event_loop()
    asyncio.set_event_loop(res)
    res._close = res.close  # type: ignore

    yield res

    if isOss():
        res.run_until_complete(db_engine.remove_db())  # drop database
        res.run_until_complete(db_engine.close_db())  # close connections to database

    res._close()  # close event loop # type: ignore

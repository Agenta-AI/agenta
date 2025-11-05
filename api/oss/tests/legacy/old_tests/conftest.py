import pytest
import asyncio

from oss.src.utils.common import is_oss

if is_oss():
    from oss.src.tests.engine import test_db_engine as db_engine


@pytest.fixture(scope="session", autouse=True)
def event_loop():
    """
    Create an instance of the default event loop for each testcase.
    """

    policy = asyncio.get_event_loop_policy()
    res = policy.new_event_loop()
    asyncio.set_event_loop(res)
    res._close = res.close  # type: ignore

    yield res

    if is_oss():
        res.run_until_complete(db_engine.remove_db())  # drop database
        res.run_until_complete(db_engine.close_db())  # close connections to database

    res._close()  # close event loop # type: ignore

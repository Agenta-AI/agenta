"""The access layer reads the core database only.

Copied from `integration/sessions/conftest.py` with `deployment_databases` narrowed to
core, plus the engine reset of `test_mounts_agent_id_backfill.py`: each test gets a fresh
transactions engine bound to its own event loop.
"""

import pytest

import oss.src.dbs.postgres.shared.engine as engine_module
from oss.tests.pytest.utils.deployment import (  # noqa: F401
    the_deployment_under_test,
)


@pytest.fixture
def deployment_databases():
    return ("core",)


@pytest.fixture
def deployment_applies(request):
    return request.node.get_closest_marker("integration") is not None


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None

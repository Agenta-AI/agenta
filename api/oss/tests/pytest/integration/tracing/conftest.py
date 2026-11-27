"""The tracing layer reads the tracing database; identity is settled on core.

Copied from `integration/access/conftest.py` with `deployment_databases` widened to the
tracing database, plus the engine reset of `integration/sessions/test_records_turn_span_dao.py`:
each test gets a fresh analytics engine bound to its own event loop.
"""

import pytest

import oss.src.dbs.postgres.shared.engine as engine_module
from oss.tests.pytest.utils.deployment import (  # noqa: F401
    the_deployment_under_test,
)


@pytest.fixture
def deployment_databases():
    return ("core", "tracing")


@pytest.fixture
def deployment_applies(request):
    return request.node.get_closest_marker("integration") is not None


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    engine_module._analytics_engine = None
    yield
    if engine_module._analytics_engine is not None:
        await engine_module._analytics_engine.close()
        engine_module._analytics_engine = None

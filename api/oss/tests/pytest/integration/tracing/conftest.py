"""The tracing layer: the guard settles identity on core, and the cases read tracing.

Each test gets a fresh analytics engine, because the engine singleton binds its pool to the
event loop of the first test that touches it.
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

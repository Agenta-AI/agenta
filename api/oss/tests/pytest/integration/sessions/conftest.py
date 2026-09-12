import pytest

from oss.tests.pytest.utils.postgres import use_reachable_core_uri


@pytest.fixture(autouse=True)
def _skip_when_postgres_unreachable(request):
    if (
        request.node.get_closest_marker("integration")
        and use_reachable_core_uri() is None
    ):
        pytest.skip("Postgres not reachable — skipping session DAO integration tests")

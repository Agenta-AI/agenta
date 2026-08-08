import pytest

from oss.tests.pytest.utils.postgres import postgres_reachable


@pytest.fixture(autouse=True)
def _skip_when_postgres_unreachable():
    """Every integration test here needs a running Postgres; skip, never error."""
    if not postgres_reachable():
        pytest.skip("Postgres not reachable — skipping integration tests")

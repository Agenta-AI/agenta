import pytest

from oss.tests.pytest.utils.postgres import postgres_reachable, postgres_target


@pytest.fixture(autouse=True)
def _skip_when_postgres_unreachable():
    """Every integration test here needs a running Postgres; skip, never error."""
    if not postgres_reachable():
        pytest.skip(
            f"Postgres not reachable at {postgres_target()} — skipping integration "
            "tests (outside py-run-tests, export POSTGRES_HOST if Postgres runs "
            "elsewhere)"
        )

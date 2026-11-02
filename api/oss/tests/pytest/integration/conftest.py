import pytest

from oss.tests.pytest.utils.postgres import require_core_uri


@pytest.fixture(autouse=True)
def _require_integration_database():
    """Identify the deployment database before any integration fixture writes."""
    require_core_uri()

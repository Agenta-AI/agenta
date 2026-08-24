import pytest

from tests.pytest.utils.live_runner import spawned_live_runner


@pytest.fixture
def live_runner_url():
    import os

    override = os.environ.get("AGENTA_LOCAL_LIVE_RUNNER_URL")
    if override:
        yield override
        return
    with spawned_live_runner() as url:
        yield url

import pytest


@pytest.fixture
def mock_create_app_trace(mocker):
    return mocker.patch("app.create_app_trace")
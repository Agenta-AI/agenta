# tests/conftest.py
import sys
import pathlib
import pytest
from fastapi.testclient import TestClient
from mongoengine import connect, disconnect
import os


@pytest.fixture(scope="module")
def test_client():
    from api.main import app
    client = TestClient(app)
    return client

# conftest.py


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_sessionstart(session):
    # Get the path to the parent directory of the `api` module
    api_path = str(pathlib.Path(__file__).resolve().parent.parent / "api")

    # Add the `api` module path to the Python path
    sys.path.insert(0, api_path)

    from api.main import app
    mongo_uri = "mongodb://username:password@localhost:27017"
    connect(host=mongo_uri, alias="default2")
    # Run the tests
    yield
    disconnect(alias="default2")
    # Remove the `api` module path from the Python path
    sys.path.remove(api_path)

# Add more fixtures, hooks, or shared utility functions as needed

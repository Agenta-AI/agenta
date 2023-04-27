# tests/conftest.py
import pytest
from fastapi.testclient import TestClient
from api.main import app
import mongomock
from api.db import connect_to_db


@pytest.fixture(scope="module")
def test_client():
    client = TestClient(app)
    return client


# Add more fixtures, hooks, or shared utility functions as needed

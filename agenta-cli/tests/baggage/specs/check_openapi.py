import pytest
import httpx
import os

BASE_URL = os.getenv("BASE_URL", None) or None
API_KEY = os.getenv("API_KEY", None) or None


def test_unauth_openapi():
    """Test /openapi.json without credentials for status 401."""

    assert (
        BASE_URL is not None
    ), "BASE_URL environment variable must be set to run this test"

    response = httpx.get(f"{BASE_URL}/openapi.json")

    assert (
        response.status_code == 401
    ), f"Expected status 401, got {response.status_code}"

    data = response.json()

    assert (
        data["detail"] == "Missing 'authorization' header."
    ), f'Expected "Missing \'authorization\' header.", got "{data["detail"]}"'


# REQUIRES
# - a valid API key -> API endpoint to create a new API key
# - a valid APP_ID  -> API endpoint to create a an app from hooks
def test_auth_openapi():
    """Test /openapi.json with credentials for status 401."""

    assert (
        BASE_URL is not None
    ), "BASE_URL environment variable must be set to run this test"

    assert (
        API_KEY is not None
    ), "API KEY environment variable must be set to run this test"

    response = httpx.get(f"{BASE_URL}/openapi.json", headers={"Authorization": API_KEY})

    assert (
        response.status_code == 200
    ), f"Expected status 200, got {response.status_code}"

    data = response.json()

    assert "openapi" in data, "Expected 'openapi' key in response JSON"

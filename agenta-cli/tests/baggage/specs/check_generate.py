import pytest
import httpx
import os

BASE_URL = os.getenv("BASE_URL", None) or None
API_KEY = os.getenv("API_KEY", None) or None

# 200
# 401
# 403
# 405
# 422
# 500


def test_unauth_generate():
    """Test /generate without credentials for status 401."""

    assert (
        BASE_URL is not None
    ), "BASE_URL environment variable must be set to run this test"

    response = httpx.get(f"{BASE_URL}/generate")

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
def test_auth_generate():
    """Test /generate with credentials for status 401."""

    assert (
        BASE_URL is not None
    ), "BASE_URL environment variable must be set to run this test"

    assert (
        API_KEY is not None
    ), "API KEY environment variable must be set to run this test"

    response = httpx.post(
        f"{BASE_URL}/generate",
        headers={"Authorization": API_KEY},
        json={
            "aloha": "mahalo",
        },
    )

    assert (
        response.status_code == 200
    ), f"Expected status 200, got {response.status_code}"

    data = response.json()

    assert "data" in data, "Expected 'data' key in response JSON"

    assert "mahalo" in data["data"], "Expected data:'mahalo' in response JSON"

    assert "tree" in data, "Expected 'tree' key in response JSON"

    assert "nodes" in data["tree"], "Expected tree:'nodes' in response JSON"

    assert (
        len(data["tree"]["nodes"]) == 1
    ), "Expected tree:'nodes' length 1 in response JSON"

    assert (
        "inputs" in data["tree"]["nodes"][0]["data"]
    ), "Expected tree:'nodes':'inputs' in response JSON"

    assert (
        "outputs" in data["tree"]["nodes"][0]["data"]
    ), "Expected tree:'nodes':'outputs' in response JSON"

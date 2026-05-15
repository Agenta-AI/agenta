import pytest

from .conftest import *  # noqa: F403


@pytest.mark.parametrize(
    "fastapi_server",
    [{"app_file": "./assets/greetings/main.py"}],
    indirect=True,
)
class TestApplicationRoutes:
    @pytest.fixture(autouse=True)
    def _setup(self, fastapi_server):
        self.base_url, _ = fastapi_server

    @pytest.mark.sdk_routing
    def test_health_endpoint(self, http_client):
        # ACT: Add configuration
        response = http_client.get("/health")

        # ASSERT: Verify response
        response.raise_for_status()
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

    @pytest.mark.sdk_routing
    def test_generate_endpoint_success(self, http_client, get_agenta_version):
        # ARRANGE: Prepare test data
        name = "Aloha"

        # ACT: Add configuration
        response = http_client.post("/generate", json={"name": name})

        # ASSERT: Verify response
        response.raise_for_status()
        response_data = response.json()
        assert response.status_code == 200
        assert response_data["data"] == f"Hello, {name}! (version={get_agenta_version})"
        assert type(response_data["tree"]) == dict and isinstance(  # noqa: E721
            response_data.get("tree", {}).get("nodes"), list
        )

    @pytest.mark.sdk_routing
    def test_generate_endpoint_authentication_failed(self, http_client):
        # ARRANGE: Prepare test data
        name = "Aloha"

        # ACT: Add configuration
        response = http_client.post(
            "/generate",
            headers={"Authorization": "ApiKey dummy"},
            json={"name": name},
        )

        # ASSERT: Verify response
        assert response.status_code == 401
        assert response.text == "Unauthorized"

    @pytest.mark.sdk_routing
    def test_generate_endpoint_invalid_payload(self, http_client):
        # ACT: Add configuration
        response = http_client.post("/generate")

        # ASSERT: Verify response
        assert response.status_code == 422

    @pytest.mark.sdk_routing
    def test_generate_deployed_endpoint(self, http_client, get_agenta_version):
        # ARRANGE: Prepare test data
        name = "Aloha"

        # ACT: Add configuration
        response = http_client.post("/generate_deployed", json={"name": name})

        # ASSERT: Verify response
        response_data = response.json()
        assert response.status_code == 200
        assert response_data["data"] == f"Hello, {name}! (version={get_agenta_version})"

    @pytest.mark.sdk_routing
    def test_generate_deployed_endpoint_authentication_failed(self, http_client):
        # ARRANGE: Prepare test data
        name = "Aloha"

        # ACT: Add configuration
        response = http_client.post(
            "/generate_deployed",
            headers={"Authorization": "ApiKey dummy"},
            json={"name": name},
        )

        # ASSERT: Verify response
        assert response.status_code == 401
        assert response.text == "Unauthorized"

    @pytest.mark.sdk_routing
    def test_generate_deployed_endpoint_invalid_payload(self, http_client):
        # ACT: Add configuration
        response = http_client.post("/generate_deployed")

        # ASSERT: Verify response
        assert response.status_code == 422

import pytest

from tests.legacy.conftest import *  # noqa: F403


class TestMockCompletion:
    @pytest.fixture(autouse=True, scope="class")
    async def setup_class_fixture(
        self, get_mock_response, create_app_and_variant, http_client
    ):
        app_variant_response = create_app_and_variant
        service_url = app_variant_response.get("variant", {}).get("uri", None)
        headers = {"Authorization": app_variant_response.get("credentials", None)}

        # Set valid LLM keys (only when authentication is required)
        mock_response = get_mock_response
        if not mock_response:
            await set_valid_llm_keys(client=http_client, headers=headers)  # noqa: F405

        return {
            "app_variant_response": app_variant_response,
            "headers": headers,
            "service_url": service_url,
        }

    @pytest.mark.asyncio
    @pytest.mark.functional
    async def test_completion_run(self, http_client, setup_class_fixture):
        # ARRANGE
        service_url = setup_class_fixture["service_url"]
        headers = setup_class_fixture["headers"]

        # ACT
        response = await http_client.post(
            f"{service_url}/test?mock=hello",
            json={
                "ag_config": {
                    "prompt": {
                        "llm_config": {
                            "model": "gpt-4",
                            "response_format": {"type": "text"},
                        },
                        "messages": [
                            {
                                "content": "You are an expert in geography.",
                                "role": "system",
                            },
                            {
                                "content": "What is the capital of {country}?",
                                "role": "user",
                            },
                        ],
                        "template_format": "fstring",
                    }
                },
                "inputs": {"country": "France"},
            },
            headers=headers,
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 200
        assert response_data["content_type"] == "text/plain"
        assert "data" in response_data and "version" in response_data
        assert response_data["data"] == "world"

    @pytest.mark.asyncio
    @pytest.mark.functional
    async def test_completion_run_with_invalid_inputs(
        self, http_client, setup_class_fixture
    ):
        # ARRANGE
        service_url = setup_class_fixture["service_url"]
        headers = setup_class_fixture["headers"]

        # ACT
        response = await http_client.post(
            f"{service_url}/test",
            json={
                "input": {"country_name": "France"},
            },
            headers=headers,
        )

        # ASSERT
        assert response.status_code == 422

    @pytest.mark.asyncio
    @pytest.mark.functional
    async def test_completion_test(self, http_client, setup_class_fixture):
        # ARRANGE
        service_url = setup_class_fixture["service_url"]
        headers = setup_class_fixture["headers"]

        # ACT
        response = await http_client.post(
            f"{service_url}/test?mock=hello",
            json={
                "ag_config": {
                    "prompt": {
                        "llm_config": {
                            "model": "gpt-4",
                            "response_format": {"type": "text"},
                        },
                        "messages": [
                            {
                                "content": "You are an expert in geography.",
                                "role": "system",
                            },
                            {
                                "content": "What is the capital of {country}?",
                                "role": "user",
                            },
                        ],
                        "template_format": "fstring",
                    }
                },
                "inputs": {"country": "France"},
            },
            headers=headers,
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 200
        assert response_data["content_type"] == "text/plain"
        assert "data" in response_data and "version" in response_data
        assert response_data["data"] == "world"

    @pytest.mark.asyncio
    @pytest.mark.functional
    async def test_completion_test_with_invalid_inputs(
        self, http_client, setup_class_fixture
    ):
        # ARRANGE
        service_url = setup_class_fixture["service_url"]
        headers = setup_class_fixture["headers"]

        # ACT
        response = await http_client.post(
            f"{service_url}/test",
            json={
                "messages": ["France"],
                "input": {"country_name": "France"},
            },
            headers=headers,
        )
        response_data = response.json()  # noqa: F841

        # ASSERT
        assert response.status_code == 422

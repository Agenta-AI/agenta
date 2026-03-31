import pytest

from tests.legacy.conftest import *  # noqa: F403


class TestLitellmCoverage:
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
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_completion_generate(self, http_client, setup_class_fixture):
        # ARRANGE
        service_url = setup_class_fixture["service_url"]
        headers = setup_class_fixture["headers"]

        # ACT
        response = await http_client.post(
            f"{service_url}/generate",
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

    @pytest.mark.asyncio
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_chat_generate(self, http_client, setup_class_fixture):
        # ARRANGE
        service_url = setup_class_fixture["service_url"]
        headers = setup_class_fixture["headers"]

        # ACT
        response = await http_client.post(
            f"{service_url}/generate",
            json={
                "messages": [
                    {"role": "user", "content": "What is the capital of {country}?"},
                ],
                "inputs": {"country": "France"},
            },
            headers=headers,
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 200
        assert "data" in response_data

    @pytest.mark.asyncio
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_chat_generate_with_multiple_messages(
        self, http_client, setup_class_fixture
    ):
        # ARRANGE
        service_url = setup_class_fixture["service_url"]
        headers = setup_class_fixture["headers"]

        # ACT
        response = await http_client.post(
            f"{service_url}/generate",
            json={
                "messages": [
                    {"role": "assistant", "content": "You are an expert in Geography."},
                    {"role": "user", "content": "What is the capital of {country}?"},
                    {"role": "assistant", "content": "The capital of France is Paris."},
                    {
                        "role": "user",
                        "content": "How many states are there in {country}?",
                    },
                ],
                "inputs": {"country": "France"},
            },
            headers=headers,
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 200
        assert "data" in response_data

    @pytest.mark.asyncio
    @pytest.mark.happy
    @pytest.mark.slow
    @pytest.mark.functional
    async def test_completion_generate_with_all_models(
        self,
        http_client,
        valid_run_generate_payload,
        setup_class_fixture,
        get_all_supported_models,
    ):
        # ARRANGE
        payload = valid_run_generate_payload
        headers = setup_class_fixture["headers"]
        service_url = setup_class_fixture["service_url"]
        supported_models = get_all_supported_models
        number_of_working_models = 28

        # ACT
        list_of_status_codes = []
        for supported_model in supported_models:
            payload["ag_config"]["prompt"]["llm_config"]["model"] = supported_model
            response = await http_client.post(
                f"{service_url}/generate",
                json=payload,
                headers=headers,
            )
            list_of_status_codes.append(response.status_code)

        # ASSERT
        assert list_of_status_codes.count(200) == number_of_working_models
        # assert list_of_status_codes.count(424) == (
        #     len(supported_models) - number_of_working_models
        # )

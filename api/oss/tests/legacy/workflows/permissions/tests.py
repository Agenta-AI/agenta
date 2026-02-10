import pytest

from tests.legacy.conftest import *  # noqa: F403


class TestMockCompletion:
    @pytest.fixture(autouse=True, scope="class")
    async def setup_class_fixture(self, create_app_and_variant, http_client):
        app_variant_response = create_app_and_variant
        service_url = app_variant_response.get("variant", {}).get("uri", None)
        headers = {"Authorization": app_variant_response.get("credentials", None)}

        # Set valid LLM keys
        await set_valid_llm_keys(client=http_client, headers=headers)  # noqa: F405

        return {
            "app_variant_response": app_variant_response,
            "headers": headers,
            "service_url": service_url,
        }

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.security
    @pytest.mark.not_available_in_oss
    async def test_permissions_principal_not_in_scope(
        self, http_client, setup_class_fixture
    ):
        # Arrange: Prepare data
        expected_status = 403
        description = "Principal not in scope for POST"
        service_url = setup_class_fixture["service_url"]
        app_variant_response = setup_class_fixture["app_variant_response"]
        user_scope_project_id = app_variant_response.get("scope_project_id")
        non_member_credentials = app_variant_response.get("non_member_credentials", "")
        non_member_headers = {"Authorization": non_member_credentials}
        await set_valid_llm_keys(client=http_client, headers=non_member_headers)  # noqa: F405

        # Act
        response = await http_client.post(
            f"{service_url}/test?project_id={user_scope_project_id}",
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
            headers=non_member_headers,
        )
        response_data = response.json()  # noqa: F841

        # Assert: Verify the response
        assert response.status_code == expected_status, (
            f"Failed for case: {description}"
        )
        assert response.json().get("detail") == "Service execution not allowed.", (
            f"Failed for case: {description}"
        )

import pytest

from tests.legacy.conftest import *  # noqa: F403


class TestSecretsCoverage:
    @pytest.fixture(autouse=True, scope="class")
    async def setup_class_fixture(self, create_app_and_variant):
        app_variant_response = create_app_and_variant
        service_url = app_variant_response.get("variant", {}).get("uri", None)
        headers = {"Authorization": app_variant_response.get("credentials", None)}

        return {
            "app_variant_response": app_variant_response,
            "headers": headers,
            "service_url": service_url,
        }

    @pytest.mark.asyncio
    @pytest.mark.grumpy
    @pytest.mark.typical
    @pytest.mark.security
    async def test_completion_generate_with_valid_secrets_and_invalid_scope(
        self, http_client, setup_class_fixture, valid_run_generate_payload
    ):
        # ARRANGE
        payload = valid_run_generate_payload
        service_url = setup_class_fixture["service_url"]
        headers = setup_class_fixture["headers"]
        await set_valid_llm_keys(http_client, headers)  # noqa: F405
        scope_project_id = setup_class_fixture["app_variant_response"].get(
            "scope_project_id", None
        )
        non_member_credentials = setup_class_fixture["app_variant_response"].get(
            "non_scope_credentials", None
        )
        non_member_headers = {"Authorization": non_member_credentials}

        # ACT
        response = await http_client.post(
            f"{service_url}/generate?project_id={scope_project_id}",
            json=payload,
            headers=non_member_headers,
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 403
        assert response_data["detail"] == "Service execution not allowed."

    @pytest.mark.asyncio
    @pytest.mark.happy
    @pytest.mark.functional
    @pytest.mark.typical
    async def test_completion_generate_with_valid_secrets(
        self, http_client, setup_class_fixture, valid_run_generate_payload
    ):
        # ARRANGE
        payload = valid_run_generate_payload
        service_url = setup_class_fixture["service_url"]
        headers = setup_class_fixture["headers"]
        await set_valid_llm_keys(http_client, headers)  # noqa: F405

        # ACT
        response = await http_client.post(
            f"{service_url}/generate",
            json=payload,
            headers=headers,
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 200
        assert response_data["content_type"] == "text/plain"
        assert "data" in response_data and "version" in response_data

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_completion_generate_with_invalid_secrets(
        self, http_client, setup_class_fixture, valid_run_generate_payload
    ):
        # ARRANGE
        payload = valid_run_generate_payload
        service_url = setup_class_fixture["service_url"]
        headers = setup_class_fixture["headers"]
        await set_invalid_llm_keys(http_client, headers)  # noqa: F405

        # ACT
        response = await http_client.post(
            f"{service_url}/generate?middleware_cache_enabled=false",
            json=payload,
            headers=headers,
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 401
        assert (
            "litellm.AuthenticationError: AuthenticationError: OpenAIException"
            in response_data["detail"].get("message", "")
        )

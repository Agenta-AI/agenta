import uuid

import pytest

from tests.legacy.conftest import *  # noqa: F403


class TestServiceCore:
    @pytest.fixture(autouse=True, scope="class")
    async def setup_class_fixture(self, create_app_and_variant):
        app_variant_response = create_app_and_variant
        return app_variant_response

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_missing_config(self, http_client, setup_class_fixture):
        # ARRANGE
        variant_id = None
        variant_slug = None
        application_id = None
        application_slug = None
        environment_id = None
        environment_slug = None
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/test?application_id={application_id}&application_slug={application_slug}&variant_id={variant_id}&variant_slug={variant_slug}&environment_id={environment_id}&environment_slug={environment_slug}",
            headers=headers,
            json={"inputs": ""},
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 400
        assert (
            response_data.get("detail")
            == "Config not found based on provided references."
        )

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_available_config_with_invalid_config(
        self, http_client, setup_class_fixture
    ):
        # ARRANGE
        variant_id = str(uuid.uuid4())
        variant_slug = "new-variant"
        application_id = str(uuid.uuid4())
        application_slug = "my-app"
        environment_id = str(uuid.uuid4())
        environment_slug = "pre-production"
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/test?application_id={application_id}&application_slug={application_slug}&variant_id={variant_id}&variant_slug={variant_slug}&environment_id={environment_id}&environment_slug={environment_slug}",
            headers=headers,
            json={"inputs": ""},
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 400
        assert (
            response_data.get("detail")
            == "Config not found based on provided references."
        )

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_missing_variables(self, http_client, setup_class_fixture):
        # ARRANGE
        variant_id = setup_class_fixture.get("variant", {}).get("variant_id", None)
        variant_slug = setup_class_fixture.get("variant", {}).get("variant_name", None)
        application_id = setup_class_fixture.get("app", {}).get("app_id", None)
        application_slug = setup_class_fixture.get("variant", {}).get("app_name", None)
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/test?application_id={application_id}&application_slug={application_slug}&variant_id={variant_id}&variant_slug={variant_slug}",
            headers=headers,
            json={},
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 422
        assert response_data.get("detail") == [
            {
                "input": None,
                "loc": ["body", "inputs"],
                "msg": "Field required",
                "type": "missing",
            }
        ]

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_available_variables_with_invalid_variables(
        self, http_client, invalid_run_generate_payload, setup_class_fixture
    ):
        # ARRANGE
        expected_status = 422
        payload = invalid_run_generate_payload
        variant_id = setup_class_fixture.get("variant", {}).get("variant_id", None)
        variant_slug = setup_class_fixture.get("variant", {}).get("variant_name", None)
        application_id = setup_class_fixture.get("app", {}).get("app_id", None)
        application_slug = setup_class_fixture.get("variant", {}).get("app_name", None)
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/test?application_id={application_id}&application_slug={application_slug}&variant_id={variant_id}&variant_slug={variant_slug}",
            headers=headers,
            json=payload,
        )
        response_data = response.json().get("detail", [])

        # ASSERT
        assert response.status_code == expected_status
        assert response_data[0].get("msg") == "Field required"
        assert isinstance(response_data, list)
        assert response_data[0].get("loc") == ["body", "inputs"]

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_missing_model(
        self, http_client, valid_run_generate_payload, setup_class_fixture
    ):
        # ARRANGE
        payload = valid_run_generate_payload
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/test",
            json=payload,
            headers=headers,
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 424
        assert "API key not found for model" in response_data["detail"].get(
            "message", None
        )

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    @pytest.mark.not_available_in_oss
    async def test_missing_provider_key(
        self,
        http_client,
        setup_class_fixture,
    ):
        # ARRANGE
        expected_status = 422
        app_variant_response = setup_class_fixture
        headers = {"Authorization": app_variant_response.get("credentials", None)}

        # ACT
        response = await http_client.post(
            "vault/v1/secrets",
            json={
                "header": {"name": "OpenAI", "description": ""},
                "secret": {
                    "kind": "provider_key",
                    "data": {
                        "key": str(uuid.uuid4().hex[:14]),
                    },
                },
            },
            headers=headers,
        )
        response_data = response.json().get("detail", [])

        # ASSERT
        assert response.status_code == expected_status
        assert response_data[0].get("msg") == "Field required"
        assert isinstance(response_data, list)
        assert response_data[0].get("loc") == [
            "body",
            "secret",
            "data",
            "provider",
        ]

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.security
    @pytest.mark.not_available_in_oss
    async def test_available_provider_key_with_invalid_provider_key(
        self,
        http_client,
        setup_class_fixture,
    ):
        # ARRANGE
        app_variant_response = setup_class_fixture
        llm_api_keys_names = list(API_KEYS_MAPPING.keys())  # noqa: F405
        headers = {"Authorization": app_variant_response.get("credentials", None)}

        # ACT
        list_of_status_codes = []
        for llm_api_key_name in llm_api_keys_names:
            response = await http_client.post(
                "vault/v1/secrets",
                json={
                    "header": {"name": llm_api_key_name, "description": ""},
                    "secret": {
                        "kind": "provider_key",
                        "data": {
                            "provider": "",
                            "key": str(uuid.uuid4().hex[:14]),
                        },
                    },
                },
                headers=headers,
            )
            list_of_status_codes.append(response.status_code)

        # ASSERT
        assert list_of_status_codes.count(422) == 12

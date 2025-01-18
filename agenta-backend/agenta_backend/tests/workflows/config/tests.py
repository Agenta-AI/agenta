import uuid

import pytest


class TestServiceConfig:
    @pytest.fixture(autouse=True, scope="class")
    async def setup_class_fixture(self, create_app_and_variant):
        app_variant_response = create_app_and_variant
        return app_variant_response

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_missing_application_and_variant_ref(
        self, http_client, setup_class_fixture
    ):
        # ARRANGE
        variant_id = None
        variant_slug = None
        application_id = None
        application_slug = None
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/run?application_id={application_id}&application_slug={application_slug}&variant_id={variant_id}&variant_slug={variant_slug}",
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
    async def test_missing_application_ref_and_variant_ref_id(
        self, http_client, setup_class_fixture
    ):
        # ARRANGE
        variant_slug = None
        application_id = None
        application_slug = None
        variant_id = setup_class_fixture.get("variant", {}).get("id", None)
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/run?application_id={application_id}&application_slug={application_slug}&variant_id={variant_id}&variant_slug={variant_slug}",
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
    async def test_missing_application_ref_and_environment_ref(
        self, http_client, setup_class_fixture
    ):
        # ARRANGE
        environment_id = None
        environment_slug = None
        application_id = None
        application_slug = None
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/run?application_id={application_id}&application_slug={application_slug}&environment_id={environment_id}&environment_slug={environment_slug}",
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
    async def test_missing_application_ref_and_environment_ref_id(
        self, http_client, setup_class_fixture
    ):
        # ARRANGE
        environment_id = None
        environment_slug = None
        application_id = None
        application_slug = None
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/run?application_id={application_id}&application_slug={application_slug}&environment_id={environment_id}&environment_slug={environment_slug}",
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
    async def test_missing_application_and_invalid_variant_ref(
        self, http_client, setup_class_fixture
    ):
        # ARRANGE
        variant_id = str(uuid.uuid4())
        variant_slug = "my-variant"
        application_id = None
        application_slug = None
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/run?application_id={application_id}&application_slug={application_slug}&variant_id={variant_id}&variant_slug={variant_slug}",
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
    async def test_missing_application_and_invalid_environment_ref(
        self, http_client, setup_class_fixture
    ):
        # ARRANGE
        environment_id = str(uuid.uuid4())
        environment_slug = "pre-production"
        application_id = None
        application_slug = None
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/run?application_id={application_id}&application_slug={application_slug}&environment_id={environment_id}&environment_slug={environment_slug}",
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
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_application_variant_ref(self, http_client, setup_class_fixture):
        # ARRANGE
        variant_slug = setup_class_fixture.get("variant", {}).get("variant_name", None)
        application_id = None
        application_slug = None
        variant_id = setup_class_fixture.get("variant", {}).get("variant_id", None)
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/generate?application_id={application_id}&application_slug={application_slug}&variant_id={variant_id}&variant_slug={variant_slug}",
            headers=headers,
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
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 200
        assert "tree" in response_data
        assert len(response_data.get("tree", {}).get("nodes", [])) >= 1

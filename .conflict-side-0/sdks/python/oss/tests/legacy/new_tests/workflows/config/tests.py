import uuid

import pytest

from tests.legacy.conftest import (
    fetch_variant_revision,
    set_valid_llm_keys,
    fetch_app_environment_revisions,
)


class TestServiceConfig:
    @pytest.fixture(autouse=True, scope="class")
    async def setup_class_fixture(
        self, http_client, get_mock_response, create_app_and_variant
    ):
        app_variant_response = create_app_and_variant
        headers = {"Authorization": app_variant_response.get("credentials", None)}

        # Set valid LLM keys (only when authentication is required)
        mock_response = get_mock_response
        if not mock_response:
            await set_valid_llm_keys(client=http_client, headers=headers)

        return app_variant_response

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_service_with_missing_refs(self, http_client, setup_class_fixture):
        # ARRANGE
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/run?application_id=&application_slug=&variant_id=&variant_slug=&environment_id=&environment_slug=&environment_version=",
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
    async def test_service_with_missing_application_ref_and_variant_ref_id(
        self, http_client, setup_class_fixture, valid_run_generate_payload
    ):
        # ARRANGE
        payload = valid_run_generate_payload
        variant_version = 0
        variant_slug = setup_class_fixture.get("variant", {}).get("variant_name", None)
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)
        custom_headers = {"Authorization": setup_class_fixture.get("credentials", None)}

        # ACT
        response = await http_client.post(
            f"{service_url}/run?mock=hello&variant_slug={variant_slug}&variant_version={variant_version}",
            json=payload,
            headers=custom_headers,
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
    async def test_service_with_missing_application_ref_and_environment_ref_id(
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
    async def test_service_with_missing_application_and_invalid_variant_ref(
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
    async def test_service_with_missing_application_and_invalid_environment_ref(
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
    async def test_service_with_variant_ref_id(
        self, http_client, setup_class_fixture, valid_run_generate_payload
    ):
        # ARRANGE
        payload = valid_run_generate_payload
        variant_id = setup_class_fixture.get("variant", {}).get("variant_id", None)
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)
        variant_revision = await fetch_variant_revision(
            http_client, headers, variant_id
        )
        variant_revision_id = variant_revision.get("id", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/generate?variant_id={variant_revision_id}",
            headers=headers,
            json=payload,
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 200
        assert "tree" in response_data
        assert len(response_data.get("tree", {}).get("nodes", [])) >= 1

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_service_with_variant_ref_excluding_id(
        self, http_client, setup_class_fixture, valid_run_generate_payload
    ):
        # ARRANGE
        payload = valid_run_generate_payload
        variant_version = 1  # this is 1 because there's a fixture that creates it
        variant_slug = setup_class_fixture.get("variant", {}).get("variant_name", None)
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/generate?application_id=&application_slug=&variant_version={variant_version}&variant_slug={variant_slug}",
            headers=headers,
            json=payload,
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 200
        assert "tree" in response_data
        assert len(response_data.get("tree", {}).get("nodes", [])) >= 1

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_service_with_environment_ref_id(
        self, http_client, setup_class_fixture, valid_run_generate_payload
    ):
        # ARRANGE
        payload = valid_run_generate_payload
        app_id = setup_class_fixture.get("app", {}).get("app_id", None)
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)
        environment_revisions = await fetch_app_environment_revisions(
            http_client, app_id, "production", headers
        )
        environment_revision_id = environment_revisions.get("revisions")[-1].get(
            "id", ""
        )

        # ACT
        response = await http_client.post(
            f"{service_url}/generate?environment_id={environment_revision_id}",
            headers=headers,
            json=payload,
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 200
        assert "tree" in response_data
        assert len(response_data.get("tree", {}).get("nodes", [])) >= 1

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_service_with_environment_ref_excluding_id(
        self, http_client, setup_class_fixture, valid_run_generate_payload
    ):
        # ARRANGE
        payload = valid_run_generate_payload
        environment_version = 1  # this is 1 because there's a fixture that creates it
        environment_slug = (
            "production"  # by default, this gets created along with the variant
        )
        headers = {"Authorization": setup_class_fixture.get("credentials", None)}
        service_url = setup_class_fixture.get("variant", {}).get("uri", None)

        # ACT
        response = await http_client.post(
            f"{service_url}/generate?environment_version={environment_version}&environment_slug={environment_slug}",
            headers=headers,
            json=payload,
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 200
        assert "tree" in response_data
        assert len(response_data.get("tree", {}).get("nodes", [])) >= 1

import pytest

from tests.legacy.conftest import *  # noqa: F403


class TestObservabilityCoverage:
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
    async def test_completion_generate_observability_tree(
        self, http_client, valid_run_generate_payload, setup_class_fixture
    ):
        # ARRANGE
        payload = valid_run_generate_payload
        service_url = setup_class_fixture["service_url"]
        headers = setup_class_fixture["headers"]
        project_id = setup_class_fixture["app_variant_response"].get(
            "scope_project_id", None
        )

        # ACT
        response = await http_client.post(
            f"{service_url}/test",
            json=payload,
            headers=headers,
        )
        response_data = response.json()

        # ASSERT
        assert response.status_code == 200
        assert response_data["content_type"] == "text/plain"
        assert "data" in response_data and "tree" in response_data

        # Get observability tree
        trace_responses = await fetch_trace_by_trace_id(  # noqa: F405
            http_client, headers, project_id=project_id
        )

        # Compare tree structures
        workflow_response = response_data
        observability_response = trace_responses

        # Step 1: Exclude lifecycle attribute from response(s)
        workflow_response_final = exclude_lifecycle(workflow_response)  # noqa: F405
        observability_response_final = exclude_lifecycle(observability_response)  # noqa: F405

        # Step 2: Compare structures with Jest-like matcher
        workflow_nodes = workflow_response_final.get("tree", {}).get("nodes", [])
        observability_nodes = observability_response_final.get("trees", {})[0].get(
            "nodes", []
        )

        is_match = exact_match(workflow_nodes, observability_nodes)  # noqa: F405
        assert is_match is True, (
            "Workflow nodes does not match nodes from observability"
        )

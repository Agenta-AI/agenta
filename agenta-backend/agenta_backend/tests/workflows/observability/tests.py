from datetime import datetime

import pytest

from agenta_backend.tests.conftest import *


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
            await set_valid_llm_keys(client=http_client, headers=headers)

        return {
            "app_variant_response": app_variant_response,
            "headers": headers,
            "service_url": service_url,
        }

    @pytest.mark.asyncio
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_completion_generate_observability_tree(
        self, http_client, setup_class_fixture
    ):
        # ARRANGE
        service_url = setup_class_fixture["service_url"]
        headers = setup_class_fixture["headers"]
        project_id = setup_class_fixture["app_variant_response"].get(
            "scope_project_id", None
        )

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
        trace_responses = await fetch_trace_by_trace_id(
            http_client, headers, project_id=project_id
        )

        # Assert that tree and nodes exist in the response data
        assert "tree" in response_data and "nodes" in response_data.get("tree", {})
        inline_trace_tree = response_data["tree"]

        # Assert node IDs match
        response_node = inline_trace_tree["nodes"][0]
        trace_node = trace_responses["trees"][0]["nodes"][0]

        # Assert tree IDs match
        assert response_node.get("tree", {}).get("id") == trace_responses["trees"][
            0
        ].get("tree", {}).get("id"), "Tree IDs do not match"
        assert (
            response_node["node"]["id"] == trace_node["node"]["id"]
        ), "Node IDs do not match"

        # Assert node names and types match
        assert (
            response_node["node"]["name"] == trace_node["node"]["name"]
        ), "Node names do not match"
        assert (
            response_node["node"]["type"] == trace_node["node"]["type"]
        ), "Node types do not match"

        # Extract and truncate timestamps to seconds
        response_created_at = response_node["lifecycle"]["created_at"]
        trace_created_at = trace_node["lifecycle"]["created_at"]

        # Parse and format both timestamps to exclude seconds and milliseconds
        response_created_at_trimmed = datetime.strptime(
            response_created_at[:16], "%Y-%m-%dT%H:%M"
        )
        trace_created_at_trimmed = datetime.strptime(
            trace_created_at[:16], "%Y-%m-%dT%H:%M"
        )

        # Assert lifecycle creation timestamps match up to seconds
        assert (
            response_created_at_trimmed == trace_created_at_trimmed
        ), "Creation timestamps do not match"

        # Assert time durations match
        assert (
            response_node["time"]["start"] == trace_node["time"]["start"]
        ), "Start times do not match"
        assert (
            response_node["time"]["end"] == trace_node["time"]["end"]
        ), "End times do not match"

        # Assert data inputs and outputs match
        assert (
            response_node["data"]["inputs"] == trace_node["data"]["inputs"]
        ), "Inputs do not match"
        assert (
            response_node["data"]["outputs"] == trace_node["data"]["outputs"]
        ), "Outputs do not match"

        # Assert metrics match
        assert (
            response_node["metrics"]["acc"]["duration"]
            == trace_node["metrics"]["acc"]["duration"]
        ), "Durations do not match"
        assert (
            response_node["metrics"]["acc"]["tokens"]
            == trace_node["metrics"]["acc"]["tokens"]
        ), "Tokens do not match"
        assert (
            response_node["metrics"]["acc"]["costs"]
            == trace_node["metrics"]["acc"]["costs"]
        ), "Costs do not match"

        # Assert configuration match
        response_config = response_node["meta"]["configuration"]
        trace_config = trace_node["meta"]["configuration"]["prompt"]
        assert (
            response_config["prompt"]["messages"] == trace_config["messages"]
        ), "Messages in configuration do not match"
        assert (
            response_config["prompt"]["llm_config"] == trace_config["llm_config"]
        ), "LLM configurations do not match"

        # Assert nested litellm_client node match
        response_litellm = response_node["nodes"]["litellm_client"]
        trace_litellm = trace_node["nodes"]["litellm_client"]
        assert (
            response_litellm["node"]["id"] == trace_litellm["node"]["id"]
        ), "litellm_client node IDs do not match"
        assert (
            response_litellm["data"]["inputs"] == trace_litellm["data"]["inputs"]
        ), "litellm_client inputs do not match"
        assert (
            response_litellm["data"]["outputs"] == trace_litellm["data"]["outputs"]
        ), "litellm_client outputs do not match"

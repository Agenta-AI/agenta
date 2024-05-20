import pytest
from unittest.mock import patch, AsyncMock
import asyncio
import aiohttp
import json

from agenta_backend.services.llm_apps_service import (
    batch_invoke,
    InvokationResult,
    Result,
    Error,
)


@pytest.mark.asyncio
async def test_batch_invoke_success():
    with patch(
        "agenta_backend.services.llm_apps_service.get_parameters_from_openapi",
        new_callable=AsyncMock,
    ) as mock_get_parameters_from_openapi, patch(
        "agenta_backend.services.llm_apps_service.invoke_app", new_callable=AsyncMock
    ) as mock_invoke_app, patch(
        "asyncio.sleep", new_callable=AsyncMock
    ) as mock_sleep:
        mock_get_parameters_from_openapi.return_value = [
            {"name": "param1", "type": "input"},
            {"name": "param2", "type": "input"},
        ]

        # Mock the response of invoke_app to always succeed
        def invoke_app_side_effect(uri, datapoint, parameters, openapi_parameters):
            return InvokationResult(
                result=Result(type="text", value="Success", error=None),
                latency=0.1,
                cost=0.01,
            )

        mock_invoke_app.side_effect = invoke_app_side_effect

        uri = "http://example.com"
        testset_data = [
            {"id": 1, "param1": "value1", "param2": "value2"},
            {"id": 2, "param1": "value1", "param2": "value2"},
        ]
        parameters = {}
        rate_limit_config = {
            "batch_size": 10,
            "max_retries": 3,
            "retry_delay": 3,
            "delay_between_batches": 5,
        }

        results = await batch_invoke(uri, testset_data, parameters, rate_limit_config)

        assert len(results) == 2
        assert results[0].result.type == "text"
        assert results[0].result.value == "Success"
        assert results[1].result.type == "text"
        assert results[1].result.value == "Success"


@pytest.mark.asyncio
async def test_batch_invoke_retries_and_failure():
    with patch(
        "agenta_backend.services.llm_apps_service.get_parameters_from_openapi",
        new_callable=AsyncMock,
    ) as mock_get_parameters_from_openapi, patch(
        "agenta_backend.services.llm_apps_service.invoke_app", new_callable=AsyncMock
    ) as mock_invoke_app, patch(
        "asyncio.sleep", new_callable=AsyncMock
    ) as mock_sleep:
        mock_get_parameters_from_openapi.return_value = [
            {"name": "param1", "type": "input"},
            {"name": "param2", "type": "input"},
        ]

        # Mock the response of invoke_app to always fail
        def invoke_app_side_effect(uri, datapoint, parameters, openapi_parameters):
            raise aiohttp.ClientError("Test Error")

        mock_invoke_app.side_effect = invoke_app_side_effect

        uri = "http://example.com"
        testset_data = [
            {"id": 1, "param1": "value1", "param2": "value2"},
            {"id": 2, "param1": "value1", "param2": "value2"},
        ]
        parameters = {}
        rate_limit_config = {
            "batch_size": 10,
            "max_retries": 3,
            "retry_delay": 3,
            "delay_between_batches": 5,
        }

        results = await batch_invoke(uri, testset_data, parameters, rate_limit_config)

        assert len(results) == 2
        assert results[0].result.type == "error"
        assert results[0].result.error.message == "Max retries reached"
        assert results[1].result.type == "error"
        assert results[1].result.error.message == "Max retries reached"


@pytest.mark.asyncio
async def test_batch_invoke_json_decode_error():
    with patch(
        "agenta_backend.services.llm_apps_service.get_parameters_from_openapi",
        new_callable=AsyncMock,
    ) as mock_get_parameters_from_openapi, patch(
        "agenta_backend.services.llm_apps_service.invoke_app", new_callable=AsyncMock
    ) as mock_invoke_app, patch(
        "asyncio.sleep", new_callable=AsyncMock
    ) as mock_sleep:
        mock_get_parameters_from_openapi.return_value = [
            {"name": "param1", "type": "input"},
            {"name": "param2", "type": "input"},
        ]

        # Mock the response of invoke_app to raise json.JSONDecodeError
        def invoke_app_side_effect(uri, datapoint, parameters, openapi_parameters):
            raise json.JSONDecodeError("Expecting value", "", 0)

        mock_invoke_app.side_effect = invoke_app_side_effect

        uri = "http://example.com"
        testset_data = [{"id": 1, "param1": "value1", "param2": "value2"}]
        parameters = {}
        rate_limit_config = {
            "batch_size": 1,
            "max_retries": 3,
            "retry_delay": 1,
            "delay_between_batches": 1,
        }

        results = await batch_invoke(uri, testset_data, parameters, rate_limit_config)

        assert len(results) == 1
        assert results[0].result.type == "error"
        assert "Failed to decode JSON from response" in results[0].result.error.message


@pytest.mark.asyncio
async def test_batch_invoke_generic_exception():
    with patch(
        "agenta_backend.services.llm_apps_service.get_parameters_from_openapi",
        new_callable=AsyncMock,
    ) as mock_get_parameters_from_openapi, patch(
        "agenta_backend.services.llm_apps_service.invoke_app", new_callable=AsyncMock
    ) as mock_invoke_app, patch(
        "asyncio.sleep", new_callable=AsyncMock
    ) as mock_sleep:
        mock_get_parameters_from_openapi.return_value = [
            {"name": "param1", "type": "input"},
            {"name": "param2", "type": "input"},
        ]

        # Mock the response of invoke_app to raise a generic exception
        def invoke_app_side_effect(uri, datapoint, parameters, openapi_parameters):
            raise Exception("Generic Error")

        mock_invoke_app.side_effect = invoke_app_side_effect

        uri = "http://example.com"
        testset_data = [{"id": 1, "param1": "value1", "param2": "value2"}]
        parameters = {}
        rate_limit_config = {
            "batch_size": 1,
            "max_retries": 3,
            "retry_delay": 1,
            "delay_between_batches": 1,
        }

        results = await batch_invoke(uri, testset_data, parameters, rate_limit_config)

        assert len(results) == 1
        assert results[0].result.type == "error"
        assert "Generic Error" in results[0].result.error.message

from oss.src.services.llm_apps_service import (
    _build_inspect_url,
    build_invoke_request,
    get_parameters_from_inspect,
    get_parameters_from_schemas,
)
import pytest


def test_get_parameters_from_schemas_prefers_revision_schemas_for_completion():
    parameters, is_chat = get_parameters_from_schemas(
        schemas={
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "object",
                    }
                },
            },
            "inputs": {
                "type": "object",
                "properties": {
                    "country": {
                        "type": "string",
                    }
                },
            },
        }
    )

    assert is_chat is False
    assert parameters == [
        {
            "name": "ag_config",
            "type": "dict",
            "default": ["prompt"],
        },
        {
            "name": "inputs",
            "type": "dict",
            "default": ["country"],
        },
    ]


def test_get_parameters_from_schemas_detects_chat_messages():
    parameters, is_chat = get_parameters_from_schemas(
        schemas={
            "parameters": {
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "object",
                    }
                },
            },
            "inputs": {
                "type": "object",
                "properties": {
                    "messages": {
                        "type": "array",
                        "x-ag-type-ref": "messages",
                    },
                    "context": {
                        "type": "string",
                    },
                },
            },
        }
    )

    assert is_chat is True
    assert parameters == [
        {
            "name": "ag_config",
            "type": "dict",
            "default": ["prompt"],
        },
        {
            "name": "messages",
            "type": "messages",
            "default": [],
        },
        {
            "name": "inputs",
            "type": "dict",
            "default": ["context"],
        },
    ]


def test_build_invoke_request_wraps_inputs_for_invoke_endpoint():
    request = build_invoke_request(
        payload={
            "inputs": {
                "country": "France",
            },
            "messages": [
                {
                    "role": "user",
                    "content": "What is the capital?",
                }
            ],
        },
        parameters={
            "prompt": {
                "messages": [
                    {
                        "role": "system",
                        "content": "You are an expert in geography.",
                    }
                ]
            }
        },
        references={
            "application": {"id": "app-id"},
            "application_variant": {"id": "variant-id"},
            "application_revision": {"id": "revision-id"},
        },
    )

    assert request == {
        "references": {
            "application": {"id": "app-id"},
            "application_variant": {"id": "variant-id"},
            "application_revision": {"id": "revision-id"},
        },
        "data": {
            "parameters": {
                "prompt": {
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are an expert in geography.",
                        }
                    ]
                }
            },
            "inputs": {
                "country": "France",
                "messages": [
                    {
                        "role": "user",
                        "content": "What is the capital?",
                    }
                ],
            },
        },
    }


def test_build_inspect_url_for_root_route():
    assert (
        _build_inspect_url(
            runtime_prefix="http://localhost:8080",
            route_path="",
        )
        == "http://localhost:8080/inspect"
    )


def test_build_inspect_url_for_nested_route():
    assert (
        _build_inspect_url(
            runtime_prefix="http://localhost:8080/service/",
            route_path="/summarize",
        )
        == "http://localhost:8080/service/summarize/inspect"
    )


@pytest.mark.asyncio
async def test_get_parameters_from_inspect_prefers_revision_schemas(monkeypatch):
    async def fake_post_json_to_uri(uri, headers, body):
        assert uri == "http://localhost:8080/inspect"
        assert headers == {"Authorization": "Secret test"}
        assert body == {}
        return {
            "flags": {"is_chat": False},
            "data": {
                "revision": {
                    "data": {
                        "schemas": {
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "prompt": {"type": "object"},
                                },
                            },
                            "inputs": {
                                "type": "object",
                                "properties": {
                                    "country": {"type": "string"},
                                },
                            },
                        }
                    }
                }
            },
        }

    monkeypatch.setattr(
        "oss.src.services.llm_apps_service._post_json_to_uri",
        fake_post_json_to_uri,
    )

    parameters, is_chat = await get_parameters_from_inspect(
        runtime_prefix="http://localhost:8080",
        route_path="",
        headers={"Authorization": "Secret test"},
    )

    assert is_chat is False
    assert parameters == [
        {
            "name": "ag_config",
            "type": "dict",
            "default": ["prompt"],
        },
        {
            "name": "inputs",
            "type": "dict",
            "default": ["country"],
        },
    ]

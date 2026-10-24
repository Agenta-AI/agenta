"""A `json_schema` response format reaches Anthropic as native structured outputs.

litellm can send a JSON schema to Anthropic in two ways. The native way (`output_format`)
uses constrained decoding, so the reply always matches the schema. The fallback forces a
tool call named `json_tool_call` without `strict`, and the model can then break the schema,
for example by returning a string where the schema asks for an array.

litellm 1.92.2 picked the native way only for a fixed list of model names, and every
Claude 5 model fell back to the forced tool call. These tests build the request that
litellm would send, offline, for every Anthropic model in the catalog.
"""

import pytest
from litellm.llms.anthropic.chat.transformation import AnthropicConfig

from agenta.sdk.utils.assets import supported_llm_models

SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "issue": {"type": "string"},
                    "quotes": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["issue", "quotes"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["suggestions"],
    "additionalProperties": False,
}

RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {"name": "Schema", "strict": True, "schema": SCHEMA},
}


def _anthropic_request(model: str) -> dict:
    config = AnthropicConfig()
    optional_params = config.map_openai_params(
        non_default_params={"response_format": RESPONSE_FORMAT},
        optional_params={},
        model=model,
        drop_params=True,
    )
    return config.transform_request(
        model=model,
        messages=[{"role": "user", "content": "hi"}],
        optional_params=optional_params,
        litellm_params={},
        headers={},
    )


@pytest.mark.parametrize(
    "model",
    [m.removeprefix("anthropic/") for m in supported_llm_models["anthropic"]],
)
def test_json_schema_uses_native_structured_outputs(model):
    request = _anthropic_request(model)

    assert request["output_format"] == {"type": "json_schema", "schema": SCHEMA}
    assert "tool_choice" not in request
    assert not any(
        tool.get("name") == "json_tool_call" for tool in request.get("tools", [])
    )

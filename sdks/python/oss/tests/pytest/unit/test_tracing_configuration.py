"""The root span records a workflow's configuration; an agent run records only its model."""

import json
from unittest.mock import Mock, patch

from agenta.sdk.contexts.tracing import TracingContext, tracing_context_manager
from agenta.sdk.decorators.tracing import instrument
from agenta.sdk.engines.tracing.spans import CustomSpan


def _root_span_attributes(parameters):
    raw_span = Mock()
    raw_span.parent = None

    def handler(messages=None):
        return None

    with tracing_context_manager(TracingContext(parameters=parameters)):
        instrument()._pre_instrument(CustomSpan(raw_span), handler, messages=[])

    attributes = {}
    for call in raw_span.set_attributes.call_args_list:
        attributes.update(call.kwargs["attributes"])
    return attributes


JSON_PREFIX = "@ag.type=json:"


def _configuration(attributes):
    """Rebuild the `ag.meta.configuration` object from the flattened span attributes."""
    prefix = "ag.meta.configuration."
    out = {}
    for key, value in attributes.items():
        if not key.startswith(prefix):
            continue
        if isinstance(value, str) and value.startswith(JSON_PREFIX):
            value = json.loads(value[len(JSON_PREFIX) :])
        node = out
        *path, leaf = key[len(prefix) :].split(".")
        for part in path:
            node = node.setdefault(part, {})
        node[leaf] = value
    return out


@patch("agenta.sdk.decorators.tracing.ag")
def test_agent_root_span_records_only_the_model_summary(mock_ag):
    mock_ag.tracing.redact = None
    parameters = {
        "agent": {
            "instructions": {"agents_md": "x" * 5000},
            "llm": {
                "model": "gpt-5-mini",
                "provider": "openai",
                "connection": {"mode": "agenta", "slug": "team-openai"},
                "extras": {"temperature": 0.2},
            },
            "skills": [{"name": "release-qa", "body": "x" * 5000, "files": []}],
            "tools": [{"name": "read_file"}],
        }
    }

    attributes = _root_span_attributes(parameters)

    assert _configuration(attributes) == {
        "agent": {
            "llm": {
                "model": "gpt-5-mini",
                "provider": "openai",
                "connection": {"mode": "agenta"},
            }
        }
    }


@patch("agenta.sdk.decorators.tracing.ag")
def test_agent_root_span_keeps_only_string_values(mock_ag):
    mock_ag.tracing.redact = None
    parameters = {
        "agent": {
            "llm": {"model": "opus", "connection": {"mode": {"nested": "x"}}},
        }
    }

    attributes = _root_span_attributes(parameters)

    assert _configuration(attributes) == {"agent": {"llm": {"model": "opus"}}}


@patch("agenta.sdk.decorators.tracing.ag")
def test_agent_root_span_without_llm_has_no_configuration(mock_ag):
    mock_ag.tracing.redact = None
    parameters = {"agent": {"skills": [{"name": "release-qa", "body": "x" * 5000}]}}

    attributes = _root_span_attributes(parameters)

    assert not any(key.startswith("ag.meta.configuration") for key in attributes)


@patch("agenta.sdk.decorators.tracing.ag")
def test_prompt_root_span_keeps_configuration(mock_ag):
    mock_ag.tracing.redact = None
    parameters = {"prompt": {"llm_config": {"model": "gpt-5-mini"}}}

    attributes = _root_span_attributes(parameters)

    assert any(key.startswith("ag.meta.configuration.prompt") for key in attributes)
    assert _configuration(attributes) == parameters

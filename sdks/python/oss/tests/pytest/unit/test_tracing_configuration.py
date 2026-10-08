"""The root span records a workflow's configuration, except for agent runs."""

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


@patch("agenta.sdk.decorators.tracing.ag")
def test_agent_root_span_has_no_configuration(mock_ag):
    mock_ag.tracing.redact = None
    parameters = {
        "agent": {
            "llm": {"model": "gpt-5-mini"},
            "skills": [{"name": "release-qa", "body": "x" * 5000, "files": []}],
        }
    }

    attributes = _root_span_attributes(parameters)

    assert not any(key.startswith("ag.meta.configuration") for key in attributes)


@patch("agenta.sdk.decorators.tracing.ag")
def test_prompt_root_span_keeps_configuration(mock_ag):
    mock_ag.tracing.redact = None
    parameters = {"prompt": {"llm_config": {"model": "gpt-5-mini"}}}

    attributes = _root_span_attributes(parameters)

    assert any(key.startswith("ag.meta.configuration.prompt") for key in attributes)

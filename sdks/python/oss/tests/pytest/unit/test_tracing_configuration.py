"""The root span records an agent's configuration without its skill contents."""

import json
from unittest.mock import Mock, patch

from agenta.sdk.contexts.tracing import TracingContext, tracing_context_manager
from agenta.sdk.decorators.tracing import _trace_configuration, instrument
from agenta.sdk.engines.tracing.spans import CustomSpan


def _agent_parameters():
    return {
        "agent": {
            "instructions": {"agents_md": "Be brief."},
            "llm": {"model": "gpt-5-mini"},
            "skills": [
                {
                    "name": "release-qa",
                    "description": "Run the release checklist.",
                    "body": "# Release QA\n" + "x" * 5000,
                    "files": [
                        {
                            "path": "scripts/check.py",
                            "content": "print('ok')\n" * 1000,
                            "executable": True,
                        }
                    ],
                },
                {"@ag.embed": {"@ag.references": {"workflow": {"slug": "s"}}}},
            ],
        }
    }


def test_trace_configuration_drops_skill_contents_and_keeps_shape():
    parameters = _agent_parameters()

    traced = _trace_configuration(parameters)

    skill = traced["agent"]["skills"][0]
    assert "body" not in skill
    assert skill["body_size"] == len(parameters["agent"]["skills"][0]["body"])
    assert skill["name"] == "release-qa"
    assert skill["description"] == "Run the release checklist."
    assert skill["files"] == [
        {"path": "scripts/check.py", "executable": True, "size": 12 * 1000}
    ]
    # Non-skill config and unresolved embeds pass through untouched.
    assert traced["agent"]["skills"][1] == parameters["agent"]["skills"][1]
    assert traced["agent"]["llm"] == {"model": "gpt-5-mini"}
    assert traced["agent"]["instructions"] == {"agents_md": "Be brief."}
    # The caller's parameters are not mutated: the handler still runs with the content.
    assert "body" in parameters["agent"]["skills"][0]
    assert "content" in parameters["agent"]["skills"][0]["files"][0]


def test_trace_configuration_passes_non_agent_parameters_through():
    prompt = {"prompt": {"messages": [{"role": "system", "content": "hi"}]}}

    assert _trace_configuration(prompt) is prompt
    assert _trace_configuration(None) == {}
    assert _trace_configuration({"agent": {"llm": {}}}) == {"agent": {"llm": {}}}


@patch("agenta.sdk.decorators.tracing.ag")
def test_root_span_configuration_has_no_skill_contents(mock_ag):
    mock_ag.tracing.redact = None
    raw_span = Mock()
    raw_span.parent = None

    def handler(messages=None):
        return None

    with tracing_context_manager(TracingContext(parameters=_agent_parameters())):
        instrument()._pre_instrument(CustomSpan(raw_span), handler, messages=[])

    attributes = {}
    for call in raw_span.set_attributes.call_args_list:
        attributes.update(call.kwargs["attributes"])

    skills_key = "ag.meta.configuration.agent.skills"
    assert skills_key in attributes
    recorded = attributes[skills_key]
    if isinstance(recorded, str) and recorded.startswith("@ag.type=json:"):
        recorded = json.loads(recorded[len("@ag.type=json:") :])
    assert "body" not in recorded[0]
    assert all("content" not in file for file in recorded[0]["files"])
    assert "x" * 5000 not in json.dumps(attributes)

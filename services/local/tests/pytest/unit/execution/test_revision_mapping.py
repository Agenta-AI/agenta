from typing import Any

from agenta.sdk.agents.dtos import AgentTemplate, HarnessKind
from agenta_local.core.agents.dtos import AgentRevision
from agenta_local.execution.sdk.mappings import (
    messages_to_sdk,
    revision_to_agent_params,
)


def make_revision() -> AgentRevision:
    return AgentRevision(
        id="rev_123",
        version=3,
        instructions="Research the question and cite sources.",
        model={
            "provider": "openai",
            "name": "gpt-5-mini",
            "parameters": {"temperature": 0.2},
        },
    )


def test_revision_to_agent_params_shape():
    revision = make_revision()

    params = revision_to_agent_params(revision)

    assert params == {
        "agent": {
            "instructions": {"agents_md": "Research the question and cite sources."},
            "llm": {
                "provider": "openai",
                "model": "gpt-5-mini",
                "extras": {"temperature": 0.2},
            },
            "tools": [],
            "mcps": [],
            "skills": [],
            "harness": {"kind": "pi_core", "permissions": {}, "extras": {}},
            "runner": {"kind": "sidecar", "permissions": {"default": "deny"}},
            "sandbox": {"kind": "local"},
        }
    }


def test_params_parse_through_agent_template():
    template = AgentTemplate.from_params(revision_to_agent_params(make_revision()))

    assert template.harness == HarnessKind.PI.value
    assert template.sandbox == "local"
    assert template.permission_default == "deny"
    assert template.instructions == "Research the question and cite sources."
    assert template.model == "openai/gpt-5-mini"
    assert template.tools == []
    assert template.mcp_servers == []
    assert template.skills == []
    assert template.harness_permissions == {}
    assert template.harness_extras == {}


def test_template_model_ref_carries_provider_and_extras():
    template: Any = AgentTemplate.from_params(revision_to_agent_params(make_revision()))

    assert template.model_ref is not None
    assert template.model_ref.provider == "openai"
    assert template.model_ref.model == "gpt-5-mini"
    assert template.model_ref.extras == {"temperature": 0.2}


def test_messages_to_sdk_shape():
    from agenta_local.core.execution.dtos import ExecutionMessage

    sdk_messages: list[dict[str, Any]] = messages_to_sdk(
        [
            ExecutionMessage(role="user", content="Hello"),
            ExecutionMessage(role="assistant", content="Hi"),
        ]
    )

    assert sdk_messages == [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi"},
    ]

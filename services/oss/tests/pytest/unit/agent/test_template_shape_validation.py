"""``AgentTemplate.from_params`` fails loud on a pre-migration flat template or an unknown
execution-selector key, instead of silently falling back to defaults.

This is finding F-016's residual: the QA driver once sent the flat pre-migration shape
(``harness`` / ``sandbox`` / ``model`` / ``agents_md`` as flat keys); ``from_params`` ignored the
unknown keys and returned defaults (``pi_core`` / ``local`` / ``gpt-5.5`` / no instructions), so an
"E3 daytona" run executed in the LOCAL sandbox and went green. The guard closes that hole: the
stale caller now gets a named HTTP 400. The compat boundary is deliberately narrow — only the
agent-template element and its three selector objects are checked; the portable definition fields
and the ``prompt`` chat fallback stay open.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents import AgentTemplate, AgentTemplateShapeError
from agenta.sdk.models.workflows import WorkflowServiceRequest

from oss.src.agent import app


# ---------------------------------------------------------------------------
# The valid nested shape is unchanged.
# ---------------------------------------------------------------------------


def test_valid_nested_shape_parses_every_selector():
    template = AgentTemplate.from_params(
        {
            "agent": {
                "harness": {"kind": "claude"},
                "sandbox": {"kind": "daytona"},
                "runner": {"kind": "sidecar", "permissions": {"default": "allow"}},
                "llm": {"model": "gpt-5.5"},
                "instructions": {"agents_md": "be nice"},
            }
        }
    )

    # The selectors are read from the nested sections, NOT silently defaulted.
    assert template.harness == "claude"
    assert template.sandbox == "daytona"
    assert template.model == "gpt-5.5"
    assert template.instructions == "be nice"
    assert template.permission_default == "allow"


def test_selector_permissions_and_extras_are_allowed():
    # harness carries permissions + extras; sandbox carries a Layer-2 permissions boundary.
    template = AgentTemplate.from_params(
        {
            "agent": {
                "harness": {"kind": "claude", "permissions": {}, "extras": {"x": 1}},
                "sandbox": {
                    "kind": "daytona",
                    "permissions": {"network": {"mode": "on"}},
                },
            }
        }
    )
    assert template.harness == "claude"
    assert template.harness_extras == {"x": 1}


# ---------------------------------------------------------------------------
# Pre-migration flat selector keys fail loud, naming the key and the new shape.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("selector", ["harness", "sandbox"])
def test_flat_string_selector_is_rejected(selector):
    with pytest.raises(AgentTemplateShapeError) as excinfo:
        AgentTemplate.from_params({"agent": {selector: "daytona"}})

    message = excinfo.value.message
    assert selector in message
    assert f"{selector}.kind" in message
    assert excinfo.value.code == 400


def test_flat_model_key_is_rejected():
    with pytest.raises(AgentTemplateShapeError) as excinfo:
        AgentTemplate.from_params(
            {"agent": {"harness": {"kind": "pi_core"}, "model": "gpt-5.5"}}
        )

    message = excinfo.value.message
    assert "model" in message
    assert "llm.model" in message


def test_flat_agents_md_key_is_rejected():
    with pytest.raises(AgentTemplateShapeError) as excinfo:
        AgentTemplate.from_params(
            {"agent": {"harness": {"kind": "pi_core"}, "agents_md": "hi"}}
        )

    message = excinfo.value.message
    assert "agents_md" in message
    assert "instructions.agents_md" in message


def test_full_pre_migration_template_is_rejected_not_silently_defaulted():
    # The exact F-016 payload: flat harness/sandbox/model/agents_md. It must NOT parse to
    # pi_core/local/gpt-5.5 — it must raise.
    with pytest.raises(AgentTemplateShapeError):
        AgentTemplate.from_params(
            {
                "agent": {
                    "harness": "pi_core",
                    "sandbox": "daytona",
                    "model": "gpt-5.5",
                    "agents_md": "you are an agent",
                }
            }
        )


# ---------------------------------------------------------------------------
# Unknown keys inside a selector object fail loud (the selectors are closed).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("selector", ["harness", "sandbox", "runner"])
def test_unknown_selector_key_is_rejected(selector):
    with pytest.raises(AgentTemplateShapeError) as excinfo:
        AgentTemplate.from_params(
            {"agent": {selector: {"kind": "pi_core", "garbage_key": 1}}}
        )

    message = excinfo.value.message
    assert selector in message
    assert "garbage_key" in message


# ---------------------------------------------------------------------------
# The compat boundary: forward-compat definition fields and the prompt fallback
# stay open. Only the selectors are closed.
# ---------------------------------------------------------------------------


def test_unknown_definition_level_key_is_left_open_for_forward_compat():
    # A future portable-definition field on the element must NOT be rejected: the boundary is
    # scoped to the execution selectors, not the whole template.
    template = AgentTemplate.from_params(
        {
            "agent": {
                "harness": {"kind": "pi_core"},
                "future_definition_field": {"anything": True},
            }
        }
    )
    assert template.harness == "pi_core"


def test_prompt_chat_fallback_is_not_validated():
    # The prompt-template path owns no agent element; the guard must skip it entirely.
    template = AgentTemplate.from_params(
        {
            "prompt": {
                "llm_config": {"model": "gpt-4o"},
                "messages": [{"role": "system", "content": "be nice"}],
            }
        }
    )
    assert template.model == "gpt-4o"
    assert template.instructions == "be nice"


# ---------------------------------------------------------------------------
# The error surfaces through the service handler (loud, not swallowed).
# ---------------------------------------------------------------------------


async def test_handler_raises_on_flat_template():
    with pytest.raises(AgentTemplateShapeError):
        await app._agent(
            request=WorkflowServiceRequest(),
            messages=[{"role": "user", "content": "hi"}],
            parameters={"agent": {"harness": "claude", "sandbox": "daytona"}},
        )

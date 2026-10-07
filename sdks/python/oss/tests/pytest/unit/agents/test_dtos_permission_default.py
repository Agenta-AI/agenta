"""PY-B4: an unrecognized ``runner.permissions.default`` must fail loud, not coerce to a
more-permissive mode."""

from __future__ import annotations

import pytest

from agenta.sdk.agents import AgentTemplate
from agenta.sdk.agents.dtos import (
    AgentTemplateShapeError,
    InvalidPermissionDefaultError,
)


def test_unknown_permission_default_raises() -> None:
    params = {"agent": {"runner": {"permissions": {"default": "deney"}}}}
    with pytest.raises(InvalidPermissionDefaultError) as excinfo:
        AgentTemplate.from_params(params)
    assert "deney" in str(excinfo.value)
    assert "allow_reads" in str(excinfo.value)


def test_known_permission_default_still_works() -> None:
    params = {"agent": {"runner": {"permissions": {"default": "DENY"}}}}
    template = AgentTemplate.from_params(params)
    assert template.permission_default == "deny"


def test_the_ui_shape_carries_the_agent_wide_mode() -> None:
    # The playground writes the mode at parameters.agent.runner.permissions.default.
    template = AgentTemplate.from_params(
        {"agent": {"runner": {"permissions": {"default": "ask"}}}}
    )
    assert template.permission_default == "ask"


@pytest.mark.parametrize("section", ["runner", "harness", "sandbox"])
def test_a_selector_beside_the_agent_template_is_refused(section) -> None:
    # Staging QA put `runner` beside `agent`: the mode was dropped without a word, so an
    # "ask" posture did not gate send_channel_message. Refuse it instead of running "allow".
    params = {
        "agent": {"harness": {"kind": "claude"}},
        section: {"permissions": {"default": "ask"}},
    }
    with pytest.raises(AgentTemplateShapeError, match=f"agent.{section}"):
        AgentTemplate.from_params(params)

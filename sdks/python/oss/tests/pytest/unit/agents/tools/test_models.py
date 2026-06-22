from __future__ import annotations

import pytest
from pydantic import ValidationError

from agenta.sdk.agents.tools import (
    CallbackToolSpec,
    CodeToolConfig,
    CodeToolSpec,
)


def test_canonical_config_forbids_unexpected_fields():
    with pytest.raises(ValidationError):
        CodeToolConfig(
            name="calc",
            script="def main(): return 1",
            unexpected=True,
        )


def test_code_spec_serializes_only_runner_fields():
    spec = CodeToolSpec(
        name="calc",
        description="Calculate",
        input_schema={"type": "object", "properties": {}},
        runtime="python",
        code="def main(): return 1",
        env={"TOKEN": "secret"},
        needs_approval=True,
        render={"kind": "component", "component": "Calculator"},
    )
    assert spec.to_wire() == {
        "name": "calc",
        "description": "Calculate",
        "inputSchema": {"type": "object", "properties": {}},
        "kind": "code",
        "runtime": "python",
        "code": "def main(): return 1",
        "env": {"TOKEN": "secret"},
        "needsApproval": True,
        "render": {"kind": "component", "component": "Calculator"},
    }


def test_callback_spec_has_stable_typed_contract():
    spec = CallbackToolSpec(
        name="get_user",
        description="Get user",
        call_ref="tools.composio.github.GET_USER.c1",
    )
    assert spec.to_wire()["kind"] == "callback"
    assert spec.to_wire()["callRef"] == "tools.composio.github.GET_USER.c1"


def test_secret_values_are_hidden_from_repr():
    spec = CodeToolSpec(
        name="private",
        description="private",
        code="...",
        env={"TOKEN": "do-not-print"},
    )
    assert "do-not-print" not in repr(spec)

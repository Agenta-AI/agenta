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
        # needs_approval with no explicit permission -> derived `ask`.
        "permission": "ask",
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


# --- Layer-3 permission default ladder (S3a) -----------------------------------------


def _spec(**kwargs):
    return CallbackToolSpec(
        name="t",
        description="t",
        call_ref="tools.composio.x.Y.c1",
        **kwargs,
    )


def test_permission_explicit_author_value_wins():
    # An explicit author permission wins over any read_only/needs_approval default.
    spec = _spec(read_only=False, permission="allow")
    assert spec.effective_permission() == "allow"
    assert spec.to_wire()["permission"] == "allow"


def test_permission_default_from_read_only_true_is_allow():
    spec = _spec(read_only=True)
    assert spec.effective_permission() == "allow"
    assert spec.to_wire()["permission"] == "allow"


def test_permission_default_from_read_only_false_is_ask():
    spec = _spec(read_only=False)
    assert spec.effective_permission() == "ask"
    assert spec.to_wire()["permission"] == "ask"


def test_permission_needs_approval_beats_read_only_auto_allow():
    # needs_approval (no explicit permission) forces `ask` even when read_only would allow.
    spec = _spec(read_only=True, needs_approval=True)
    assert spec.effective_permission() == "ask"
    assert spec.to_wire()["permission"] == "ask"


def test_permission_absent_when_all_unset():
    # read_only is None and nothing explicit -> no permission on the wire (runner falls back).
    spec = _spec()
    assert spec.effective_permission() is None
    assert "permission" not in spec.to_wire()


def test_permission_accepts_fe_permission_mode_alias():
    # The playground writes `permission_mode` into agenta_metadata; the spec deserializes it.
    spec = CallbackToolSpec.model_validate(
        {
            "name": "t",
            "description": "t",
            "callRef": "tools.composio.x.Y.c1",
            "permission_mode": "deny",
        }
    )
    assert spec.permission == "deny"
    assert spec.to_wire()["permission"] == "deny"
